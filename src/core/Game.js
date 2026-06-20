import * as THREE from 'three'
import { Input } from './Input.js'
import { HUD } from './HUD.js'
import { MobileControls } from './MobileControls.js'
import { AssetLoader } from './AssetLoader.js'
import { World } from '../systems/World.js'
import { Weapons } from '../systems/Weapons.js'
import { Spawner } from '../systems/Spawner.js'
import { Particles } from '../systems/Particles.js'
import { Audio } from '../systems/Audio.js'
import { Pickups } from '../systems/Pickups.js'
import { Zone } from '../systems/Zone.js'
import { Flags } from '../systems/Flags.js'
import { Player } from '../entities/Player.js'
import { Vehicle } from '../entities/Vehicle.js'
import { Grenade } from '../entities/Grenade.js'
import { Net } from '../net/Net.js'
import { RemotePlayer } from '../entities/RemotePlayer.js'

// Game states
const STATE = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', DEAD: 'dead' }

export class Game {
  constructor(canvas) {
    this.canvas = canvas
    this.state = STATE.MENU
    this.score = 0
    this.selectedMap = 'arena'

    // Persisted settings.
    this.settings = { sens: 1, invertY: false }
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem('ts_settings') || '{}')) } catch {}

    // Minimap canvas.
    this.minimap = document.getElementById('minimap')
    this.minimapCtx = this.minimap?.getContext('2d')

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.camera = new THREE.PerspectiveCamera(
      72, window.innerWidth / window.innerHeight, 0.1, 500
    )

    this.clock = new THREE.Clock()
    this._muzzle = new THREE.Vector3() // reused each frame for the tracer origin
    this.audio = new Audio()
    this._grenadeCd = 0
    this._prevHp = 100
    this.input = new Input(canvas)
    this.hud = new HUD()
    this.assets = new AssetLoader()

    // Touch devices: on-screen controls + no pointer lock.
    if (this.input.isTouch) {
      document.body.classList.add('touch')
      this.mobile = new MobileControls(this.input)
    }

    this._wireUI()
    this._onResize = () => this._resize()
    window.addEventListener('resize', this._onResize)

    // Render the menu background once.
    this._buildWorld()
    this._renderOnce()
  }

  _wireUI() {
    this.hud.el.startBtn.addEventListener('click', () => {
      if (this.state === STATE.MENU || this.state === STATE.DEAD) this.start()
      else if (this.state === STATE.PAUSED) this.resume()
    })

    // Multiplayer: server URL precedence = ?server= > saved > empty.
    // Remembered in localStorage so you don't retype your Render URL.
    const params = new URLSearchParams(location.search)
    const serverInput = document.getElementById('mp-server')
    const DEFAULT_SERVER = 'wss://toon-shooter-server.onrender.com'
    const savedServer = localStorage.getItem('ts_server') || ''
    serverInput.value = params.get('server') || savedServer || DEFAULT_SERVER
    serverInput.addEventListener('change', () => localStorage.setItem('ts_server', serverInput.value.trim()))
    document.getElementById('online-btn').addEventListener('click', () => {
      if (this.state === STATE.PLAYING) return
      localStorage.setItem('ts_server', serverInput.value.trim())
      this.startOnline()
    })

    // Solo Battle Royale.
    document.getElementById('br-btn').addEventListener('click', () => {
      if (this.state === STATE.MENU || this.state === STATE.DEAD) this.start(true)
    })

    // Map voting (online): toggle panel + cast vote.
    this.hud.el.voteToggle.addEventListener('click', () => this.hud.toggleVotePanel())
    this.hud.el.votePanel.querySelectorAll('.vote-opt').forEach((b) => {
      b.addEventListener('click', () => this.net?.sendVote(b.dataset.map))
    })

    // Map selector buttons.
    document.querySelectorAll('.map-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedMap = btn.dataset.map
        document.querySelectorAll('.map-btn').forEach((b) => b.classList.toggle('active', b === btn))
      })
    })

    // Mode selector buttons (co-op / deathmatch).
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b === btn))
      })
    })

    // Settings (sensitivity + invert-Y), persisted to localStorage.
    const sens = document.getElementById('set-sens')
    const invert = document.getElementById('set-invert')
    sens.value = this.settings.sens
    invert.checked = this.settings.invertY
    const saveSettings = () => {
      this.settings.sens = parseFloat(sens.value)
      this.settings.invertY = invert.checked
      localStorage.setItem('ts_settings', JSON.stringify(this.settings))
      this._applySettings()
    }
    sens.addEventListener('input', saveSettings)
    invert.addEventListener('change', saveSettings)

    this.input.onLockChange = (locked) => {
      // Losing the pointer lock mid-game = pause (desktop only).
      if (!this.input.isTouch && !locked && this.state === STATE.PLAYING) this.pause()
    }

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR' && this.state === STATE.PLAYING) this.weapons.startReload()
      if (e.code === 'Tab') { e.preventDefault(); if (this.state === STATE.PLAYING) this.hud.showScoreboard(this._scoreboardRows()) }
    })
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') this.hud.hideScoreboard()
    })

    // Mobile RANK button (toggle).
    const rankBtn = document.getElementById('rank-btn')
    rankBtn.addEventListener('click', () => {
      if (this.hud.el.scoreboard.classList.contains('hidden')) this.hud.showScoreboard(this._scoreboardRows())
      else this.hud.hideScoreboard()
    })

    // Victory screen -> back to menu.
    document.getElementById('victory-btn').addEventListener('click', () => {
      this.hud.hideVictory()
      this.state = STATE.MENU
      this.hud.hide()
      this.hud.showOverlay('Survive the waves, or take the win. Click to lock your mouse and shoot.', 'PLAY')
    })
  }

  _buildWorld() {
    const big = !!this.brMode // Battle Royale gets a big chunked city with backdrop
    this.world = new World({ radius: big ? 150 : 75, backdrop: big })
    this.camera.fov = 72 // reset base FOV (ADS may have left it zoomed)
    this.camera.updateProjectionMatrix()
    this.camera.position.set(0, 1.6, 0)
  }

  _resetGameObjects() {
    // Fresh world each run so old enemies/effects are gone.
    this._buildWorld()
    // The camera persists across matches; clear any old viewmodel/muzzle children
    // so they don't accumulate (this caused a leftover "ghost" gun).
    this.camera.clear()
    // Camera must be in the scene graph so the FPS viewmodel (its child) renders.
    this.world.scene.add(this.camera)
    this.particles = new Particles(this.world.scene)
    this.player = new Player({ world: this.world, input: this.input, camera: this.camera })
    this.weapons = new Weapons({ world: this.world, particles: this.particles })
    this.spawner = new Spawner({ world: this.world, assets: this.assets, weapons: this.weapons })
    this.pickups = new Pickups({ world: this.world, assets: this.assets, audio: this.audio })
    this.grenades = []
    this.zone = this.brMode ? new Zone(this.world, this.particles) : null
    this.cars = []
    this.driving = null
    this._ePrev = false
    this.ctfMode = this.onlineMode === 'ctf'
    this.flags = this.ctfMode ? new Flags(this.world) : null
    this.ctf = null
    this.score = 0
    this.enemyKills = 0
    this._wonBR = false
    this._prevHp = this.player.maxHp
    this._deadHandled = false
    this._lastAttacker = null
    this.remotePlayers = new Map() // id -> RemotePlayer (multiplayer)
    this.player.onJumpPad = () => this.audio.jumpPad()
    this.hud.clearKillFeed()
    this.hud.setStorm(false)
    this.hud.setStormTimer(null)
    this.hud.setCarPrompt(null)
    this.hud.hideScoreboard()
    this.hud.hideVictory()
    this.hud.setTeamScores(0, 0, false)
    this.hud.setObjective('')
    this._applySettings()

    // HUD hooks
    this.weapons.onFire = () => {
      this.hud.setAmmo(this.weapons.ammo, this.weapons.magazine)
      this.player.notifyFired() // drives the shoot animation + aim facing
      this.audio.shoot(this.weapons.def.key)
    }
    this.weapons.onReloadStart = () => { this.hud.setReloading(true); this.audio.reload() }
    this.weapons.onReloadEnd = () => {
      this.hud.setReloading(false)
      this.hud.setAmmo(this.weapons.ammo, this.weapons.magazine)
    }
    this.spawner.onWaveStart = (w) => this.hud.setWave(w)
    this.spawner.onKill = (pos) => {
      this.score += 10
      this.enemyKills = (this.enemyKills || 0) + 1
      this.hud.setScore(this.score)
      if (pos) this.pickups.rollDrop(pos.x, pos.z)
    }
    this.weapons.onSwitch = (def, i) => {
      this._setWeaponViewmodel(def)
      this.player.setWeapon(def)
      this.hud.setWeapon(def, i)
      this.hud.setAmmo(this.weapons.ammo, this.weapons.magazine)
      this.hud.setReloading(false)
    }

    this.hud.setHp(this.player.hp, this.player.maxHp)
    this.hud.setScore(0)
    this.hud.setWave(1)
    this.hud.initWeapons(this.weapons.defs)
    this.hud.setWeapon(this.weapons.def, this.weapons.index)
    this.hud.setAmmo(this.weapons.ammo, this.weapons.magazine)
    this.hud.setReloading(false)

    // Try to load real toon models if present (non-blocking).
    this._loadOptionalModels()
  }

  async _loadOptionalModels() {
    // Preload every weapon model so switching is instant, then mount the current.
    await Promise.all(this.weapons.defs.map((d) =>
      this.assets.loadModel(`models/guns/${d.model}.gltf`)))
    this._setWeaponViewmodel(this.weapons.def)
    this.player.setWeapon(this.weapons.def)

    // Enemies are spawned over time, so the spawner clones this per enemy.
    this.spawner.enemyModelPath = 'models/characters/Character_Enemy.gltf'

    // Build the map: Battle Royale uses the big open "royale" island.
    const { LevelBuilder } = await import('../systems/LevelBuilder.js')
    const mapKey = this.brMode ? 'royale' : this.selectedMap
    await new LevelBuilder({ world: this.world, assets: this.assets }).build(mapKey)

    // Spawn drivable cars at the level's open car-spawn points.
    await this._spawnCars()
  }

  async _spawnCars() {
    const spots = this.world.carSpawns
    if (!spots || !spots.length) return
    // Mix of the upload's .dae cars and the city pack's redCar.glb.
    const paths = ['models/cars/Models/Car 1.dae', 'models/city/redCar.glb', 'models/cars/Models/Car 2.dae']
    const MAX = Math.min(spots.length, 14) // cap cars for performance
    for (let i = 0; i < MAX; i++) {
      const s = spots[Math.floor((i / MAX) * spots.length)]
      const car = new Vehicle({ world: this.world, x: s.x, z: s.z, heading: (i * 1.3) % (Math.PI * 2) })
      this.cars.push(car)
      const path = paths[i % paths.length]
      const loaded = path.endsWith('.glb')
        ? this.assets.loadModel(path).then((m) => m && m.scene)
        : this.assets.loadCollada(path)
      loaded.then((scene) => { if (scene) car.setModel(scene) })
    }
  }

  // Enter the nearest car, or exit the one being driven (toggled by E).
  _toggleCar() {
    if (this.driving) {
      const car = this.driving
      this.driving = null
      car.occupied = false
      const sx = Math.cos(car.heading), sz = -Math.sin(car.heading)
      this.player.position.set(car.position.x + sx * 2.8, 0, car.position.z + sz * 2.8)
      this.player.velocity.set(0, 0, 0)
      if (this.player.gun) this.player.gun.visible = true
      return
    }
    let best = null, bd = 3.6
    for (const car of this.cars) {
      const d = Math.hypot(this.player.position.x - car.position.x, this.player.position.z - car.position.z)
      if (d < bd) { bd = d; best = car }
    }
    if (best) {
      this.driving = best
      best.occupied = true
      if (this.player.gun) this.player.gun.visible = false
    }
  }

  _driveUpdate(dt) {
    const car = this.driving
    this.input.consumeMouseDelta() // discard look-deltas so FPS cam doesn't snap on exit
    let throttle = 0, steer = 0
    if (this.input.isDown('KeyW')) throttle += 1
    if (this.input.isDown('KeyS')) throttle -= 1
    if (this.input.isDown('KeyD')) steer += 1
    if (this.input.isDown('KeyA')) steer -= 1
    throttle += this.input.touchMove.y || 0
    steer += this.input.touchMove.x || 0
    throttle = Math.max(-1, Math.min(1, throttle))
    steer = Math.max(-1, Math.min(1, steer))
    car.update(dt, { throttle, steer })
    // The player rides along (keeps storm damage, score, networking working).
    this.player.position.set(car.position.x, 0, car.position.z)
    this.player.velocity.set(0, 0, 0)
    this.player.onGround = true
    this._driveCamera(dt, car)
  }

  // Third-person chase camera behind the car.
  _driveCamera(dt, car) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading)
    this._camTarget = this._camTarget || new THREE.Vector3()
    this._camTarget.set(car.position.x - fx * 9, 6.5, car.position.z - fz * 9)
    this.camera.position.lerp(this._camTarget, Math.min(1, dt * 6))
    this.camera.lookAt(car.position.x + fx * 4, 2, car.position.z + fz * 4)
  }

  // Swap the FPS viewmodel to the given weapon def (cached load -> instant).
  _setWeaponViewmodel(def) {
    this.assets.loadModel(`models/guns/${def.model}.gltf`).then((m) => {
      if (m && this.weapons.def === def) this.player.setViewmodel(m.scene)
    })
  }

  start(br = false) {
    this.audio.resume()
    this.onlineMode = null // solo = co-op waves
    this.brMode = !!br      // solo battle royale = storm survival + enemies
    this._disconnect() // solo play: drop any prior connection
    this.hud.showVoteToggle(false)
    this._resetGameObjects()
    this.state = STATE.PLAYING
    this.hud.hideOverlay()
    this.hud.show()
    if (!this.input.isTouch) this.input.requestLock()
    this.clock.getDelta() // reset dt
    this._loop()
  }

  // Connect to the relay server, then start once joined.
  startOnline() {
    this.audio.resume()
    const status = document.getElementById('mp-status')
    const name = (document.getElementById('mp-name').value || '').trim() || `Player${Math.floor(Math.random() * 1000)}`
    const room = (document.getElementById('mp-room').value || 'lobby').trim()
    const url = (document.getElementById('mp-server').value || 'wss://toon-shooter-server.onrender.com').trim()
    this.onlineMode = document.querySelector('.mode-btn.active')?.dataset.mode || 'coop'
    this.brMode = this.onlineMode === 'br'
    status.textContent = 'Connecting…'

    this._disconnect()
    this._resetGameObjects()

    this.net = new Net({
      url, name, room, mode: this.onlineMode,
      handlers: {
        onWelcome: (id, peers, team) => {
          status.textContent = ''
          this.myTeam = team
          this.peerNames.set(id, this._selfName)
          this.kills = 0; this.deaths = 0
          this.hud.setScore('0/0')
          // Scoreboard: id -> { name, kills, deaths, team }
          this.board = new Map()
          this.board.set(id, { name: this._selfName, kills: 0, deaths: 0, team })
          for (const peer of peers) {
            this._addRemote(peer.id, peer.name, peer.p, peer.team)
            this.board.set(peer.id, { name: peer.name, kills: 0, deaths: 0, team: peer.team })
          }
          this.state = STATE.PLAYING
          this.hud.hideOverlay()
          this.hud.show()
          this.hud.showVoteToggle(true)
          if (this.ctfMode) { this._needBaseSpawn = true; this.hud.setTeamScores(0, 0, true) }
          if (!this.input.isTouch) this.input.requestLock()
          this.clock.getDelta()
          this._loop()
        },
        onPeerJoin: (id, pname, team) => {
          this._addRemote(id, pname, null, team)
          this.board?.set(id, { name: pname, kills: 0, deaths: 0, team })
        },
        onPeerLeave: (id) => {
          this.remotePlayers.get(id)?.dispose()
          this.remotePlayers.delete(id)
          this.board?.delete(id)
        },
        onState: (id, p) => this.remotePlayers.get(id)?.setState(p),
        onShoot: (id, from, to) => {
          if (from && to) this.weapons.beam(
            new THREE.Vector3(from[0], from[1], from[2]),
            new THREE.Vector3(to[0], to[1], to[2]), 0x9ad0ff, 0.06)
        },
        onHit: (fromId, dmg) => {
          if (!this.player.alive) return
          this._lastAttacker = fromId
          this.player.takeDamage(dmg)
        },
        onKilled: (byId, victimId) => this._onKilled(byId, victimId),
        onVotes: (tally) => this.hud.setVotes(tally),
        onMapChange: (map) => this._applyMapChange(map),
        onCtf: (ctf) => {
          this.ctf = ctf
          this.flags?.setState(ctf)
          this.hud.setTeamScores(ctf.scores.red, ctf.scores.blue, this.ctfMode)
        },
        onWin: (msg) => this._onWin(msg),
        onError: () => { status.textContent = 'Connection failed. Is the server running?' },
        onClose: () => { if (this.state === STATE.PLAYING) status.textContent = 'Disconnected.' },
      },
    })
    this.peerNames = new Map([[this.net?.id, name]]) // updated on welcome
    this._selfName = name
  }

  _addRemote(id, name, state, team) {
    if (this.remotePlayers.has(id)) return
    const rp = new RemotePlayer({ world: this.world, assets: this.assets, name, id, fx: this.particles })
    rp.team = team
    if (state) rp.setState(state)
    rp.setTeamColor(this._relationTo(team))
    this.remotePlayers.set(id, rp)
    this.peerNames?.set(id, name)
  }

  // ally / enemy / null — teams matter in Team Deathmatch and CTF.
  _relationTo(team) {
    if ((this.onlineMode !== 'team' && this.onlineMode !== 'ctf') || !team || !this.myTeam) return null
    return team === this.myTeam ? 'ally' : 'enemy'
  }

  _handleMpDeath() {
    if (this._deadHandled) return
    this._deadHandled = true
    this.net.sendKilled(this._lastAttacker ?? null)
    this.kills = this.kills || 0
    this.deaths = (this.deaths || 0) + 1
    this.hud.setScore(`${this.kills}/${this.deaths}`)
    // CTF: drop the enemy flag where you died.
    if (this.ctfMode && this.ctf && this.myTeam) {
      const enemyColor = this.myTeam === 'red' ? 'blue' : 'red'
      if (this.ctf.flags[enemyColor]?.holder === this.net.id) {
        this.net.sendFlagDrop(enemyColor, this.player.position.x, this.player.position.z)
      }
    }
    // Battle royale = no respawn; you're eliminated.
    if (this.brMode) {
      this.state = STATE.DEAD
      if (!this.input.isTouch) this.input.exitLock()
      this.hud.showOverlay(`Eliminated. Kills: ${this.kills}.`, 'PLAY AGAIN')
      return
    }
    setTimeout(() => this._respawn(), 1800)
  }

  _respawn() {
    // CTF/team: respawn at your base; otherwise a random edge.
    const base = (this.ctfMode || this.onlineMode === 'team') && this.world.bases.find((b) => b.team === this.myTeam)
    if (base) {
      this.player.position.set(base.x + (Math.random() - 0.5) * 6, 0, base.z + (Math.random() - 0.5) * 6)
    } else {
      const a = Math.random() * Math.PI * 2
      const r = this.world.arenaRadius - 6
      this.player.position.set(Math.cos(a) * r, 0, Math.sin(a) * r)
    }
    this.player.velocity.set(0, 0, 0)
    this.player.hp = this.player.maxHp
    this.player.alive = true
    this._prevHp = this.player.hp
    this._deadHandled = false
    this._lastAttacker = null
  }

  // A vote finished: rebuild the world on the winning map without dropping the
  // network connection; re-add the known peers.
  _applyMapChange(map) {
    this.selectedMap = map
    this.hud.hideVotePanel()
    this.hud.addKillFeed(`Map vote → ${map}`)
    const peers = [...this.remotePlayers.values()].map((rp) => ({ id: rp.id, name: rp.name, team: rp.team }))
    this._resetGameObjects() // rebuilds world/camera/player; leaves this.net intact
    for (const p of peers) this._addRemote(p.id, p.name, null, p.team)
    this.hud.showVoteToggle(true)
    if (this.state === STATE.PLAYING && !this.input.isTouch) this.input.requestLock()
  }

  // Show the victory/defeat screen and stop play.
  _winMatch(title, sub, win = true) {
    this.state = STATE.DEAD
    if (!this.input.isTouch) this.input.exitLock()
    this.hud.showVictory(title, sub, win)
  }

  _onWin(msg) {
    if (msg.reason === 'ctf') {
      const won = msg.team === this.myTeam
      this._winMatch(won ? 'VICTORY' : 'DEFEAT', `${String(msg.team).toUpperCase()} team wins the flag battle!`, won)
    } else if (msg.reason === 'br') {
      const won = msg.id === this.net?.id
      this._winMatch(won ? '#1 VICTORY ROYALE' : 'Match Over', won ? "You're the last one standing." : 'Better luck next drop.', won)
    }
  }

  _doBaseSpawn() {
    const b = this.world.bases.find((bb) => bb.team === this.myTeam)
    if (b) { this.player.position.set(b.x, 0, b.z); this.player.velocity.set(0, 0, 0) }
  }

  _flagCtx() {
    return { localId: this.net?.id, localPos: this.player.position, remotePlayers: this.remotePlayers }
  }

  // Capture-the-Flag interactions (run each frame in CTF). Server is authoritative;
  // we just send intents based on proximity and render flags.
  _updateCtf(dt) {
    if (this._needBaseSpawn && this.world.bases.length) { this._doBaseSpawn(); this._needBaseSpawn = false }
    const id = this.net?.id
    if (this.ctf && this.myTeam && id != null) {
      const myColor = this.myTeam, enemyColor = myColor === 'red' ? 'blue' : 'red'
      const ef = this.ctf.flags[enemyColor], mf = this.ctf.flags[myColor]
      const p = this.player.position
      const homePos = (team) => { const b = this.world.bases.find((bb) => bb.team === team); return b ? { x: b.x, z: b.z } : { x: 0, z: 0 } }
      const carrying = ef.holder === id

      if (this.player.alive && !carrying && ef.state !== 'carried') {
        const fp = ef.state === 'dropped' ? ef : homePos(enemyColor)
        if (Math.hypot(p.x - fp.x, p.z - fp.z) < 3) this.net.sendFlagTake(enemyColor)
      }
      if (this.player.alive && carrying && mf.state === 'home') {
        const b = homePos(myColor)
        if (Math.hypot(p.x - b.x, p.z - b.z) < 5.5) this.net.sendFlagCapture(enemyColor)
      }
      if (this.player.alive && mf.state === 'dropped' && Math.hypot(p.x - mf.x, p.z - mf.z) < 3) {
        this.net.sendFlagReturn(myColor)
      }

      // Objective hint.
      let msg = 'Grab the enemy flag →'
      if (carrying) msg = '🚩 You have the enemy flag — run it to your base!'
      else if (mf.state !== 'home') msg = '⚠ Your flag was taken — get it back!'
      this.hud.setObjective(msg)
    }
    this.flags?.update(dt, this._flagCtx())
  }

  _onKilled(byId, victimId) {
    const killer = byId != null ? (this.peerNames?.get(byId) || `Player${byId}`) : 'the world'
    const victim = victimId === this.net?.id ? this._selfName : (this.peerNames?.get(victimId) || `Player${victimId}`)
    this.hud.addKillFeed(`${killer} ▸ ${victim}`)
    // Scoreboard tallies (consistent on every client — all receive 'killed').
    if (this.board) {
      if (byId != null && byId !== victimId && this.board.has(byId)) this.board.get(byId).kills++
      if (this.board.has(victimId)) this.board.get(victimId).deaths++
    }
    if (byId === this.net?.id && victimId !== this.net?.id) {
      this.kills = (this.kills || 0) + 1
      this.deaths = this.deaths || 0
      this.hud.setScore(`${this.kills}/${this.deaths}`)
    }
  }

  // Build sorted scoreboard rows (online: from this.board; solo: just you).
  _scoreboardRows() {
    if (this.board && this.net) {
      return [...this.board.entries()]
        .map(([id, r]) => ({ ...r, you: id === this.net.id }))
        .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
    }
    return [{ name: this._selfName || 'You', kills: this.enemyKills || 0, deaths: this.player?.alive ? 0 : 1, you: true }]
  }

  _disconnect() {
    if (this.net) { this.net.close(); this.net = null }
    if (this.remotePlayers) {
      for (const rp of this.remotePlayers.values()) rp.dispose()
      this.remotePlayers.clear()
    }
  }

  pause() {
    if (this.state !== STATE.PLAYING) return
    this.state = STATE.PAUSED
    this.hud.showOverlay('Paused — click Resume to keep fighting.', 'RESUME')
  }

  resume() {
    if (this.state !== STATE.PAUSED) return
    this.state = STATE.PLAYING
    this.hud.hideOverlay()
    if (!this.input.isTouch) this.input.requestLock()
    this.clock.getDelta()
    this._loop()
  }

  gameOver() {
    this.state = STATE.DEAD
    this.input.exitLock()
    this.hud.showOverlay(
      `You fell on wave ${this.spawner.wave}. Final score: ${this.score}.`,
      'PLAY AGAIN'
    )
  }

  _loop() {
    if (this.state !== STATE.PLAYING) return
    requestAnimationFrame(() => this._loop())

    const dt = Math.min(0.05, this.clock.getDelta())

    // Enter / exit a car with E (edge-triggered).
    const eDown = this.input.isDown('KeyE')
    if (eDown && !this._ePrev) this._toggleCar()
    this._ePrev = eDown

    // Weapon switching: number keys + mouse wheel.
    for (let i = 0; i < this.weapons.defs.length; i++) {
      if (this.input.isDown(`Digit${i + 1}`)) this.weapons.switchTo(i)
    }
    const wheel = this.input.consumeWheel()
    if (wheel) this.weapons.cycle(wheel)

    // Reload (R).
    if (this.input.isDown('KeyR')) this.weapons.startReload()

    // Grenade (G) — not while driving.
    this._grenadeCd = Math.max(0, this._grenadeCd - dt)
    if (this.input.isDown('KeyG') && !this.driving) this.throwGrenade()

    // Aim-down-sights (right mouse) — not while driving.
    const ads = this.input.mouse.right && this.player.alive && !this.driving
    this.player.setADS(ads)
    this.hud.setAds(this.player.adsAmount > 0.5)

    // Shooting: auto weapons fire while held; semi-auto fire once per click.
    let firedThisFrame = false
    const click = this.input.consumeClick()
    const wantFire = (this.weapons.auto ? this.input.mouse.down : click) && !this.driving
    if (wantFire && this.player.alive) {
      const muzzle = this.player.getMuzzleWorldPosition(this._muzzle)
      const remotes = this.net ? [...this.remotePlayers.values()] : []
      const res = this.weapons.tryFire(this.player.getAimRay(), this.spawner.enemies, muzzle, ads, remotes)
      if (res.fired) {
        firedThisFrame = true
        if (res.killed) { this.hud.hitMarker(true); this.audio.kill() }
        else if (res.hit) { this.hud.hitMarker(false); this.audio.hit() }
        if (res.playerHit != null && this.net) {
          // Friendly fire off: don't damage teammates in Team Deathmatch.
          const victim = this.remotePlayers.get(res.playerHit)
          const friendly = this._relationTo(victim?.team) === 'ally'
          if (!friendly) {
            this.net.sendHit(res.playerHit, this.weapons.def.damage)
            this.hud.hitMarker(false); this.audio.hit()
          }
        }
        if (res.barrel) this.explode(res.barrel)
        // Grenade launcher: fire an explosive shell along the aim.
        if (res.projectile === 'grenade') {
          const v = res.dir.clone().multiplyScalar(42); v.y += 2
          this.grenades.push(new Grenade({
            world: this.world, assets: this.assets, position: res.origin.clone(), velocity: v, fuse: 1.4,
            onExplode: (p) => this.explodeAt(p, { radius: 8, damage: 120 }),
          }))
        }
        // Broadcast the shot so other players see a tracer.
        if (this.net) {
          const aim = this.player.getAimRay()
          const to = aim.origin.clone().addScaledVector(aim.dir, 60)
          this.net.sendShoot([muzzle.x, muzzle.y, muzzle.z], [to.x, to.y, to.z])
        }
      }
    }

    if (this.driving) this._driveUpdate(dt)
    else this.player.update(dt)
    // Idle cars still settle (friction); the driven one is updated in _driveUpdate.
    for (const car of this.cars) if (car !== this.driving) car.update(dt)

    // Car prompt.
    if (this.cars.length) {
      if (this.driving) this.hud.setCarPrompt('Press E to exit')
      else {
        let near = false
        for (const car of this.cars) {
          if (Math.hypot(this.player.position.x - car.position.x, this.player.position.z - car.position.z) < 3.6) { near = true; break }
        }
        this.hud.setCarPrompt(near ? 'Press E to drive' : null)
      }
    }

    this.particles.update(dt)
    this.pickups.update(dt, this.player, this.weapons)

    // Grenades.
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      if (this.grenades[i].update(dt)) this.grenades.splice(i, 1)
    }

    // Hurt sound when HP drops.
    if (this.player.hp < this._prevHp) this.audio.hurt()
    this._prevHp = this.player.hp

    // Multiplayer: broadcast local state + interpolate remote players.
    if (this.net) {
      this.net.sendState({
        x: this.player.position.x, y: this.player.position.y, z: this.player.position.z,
        yaw: this.player.yaw, pitch: this.player.pitch, hp: this.player.hp,
        wpn: this.weapons.index, moving: this.player.moving,
      }, performance.now())
      for (const rp of this.remotePlayers.values()) rp.update(dt, this.camera)
    }

    // Fortnite-style dynamic reticle: bloom out when moving/firing/airborne.
    let spread = 0
    if (this.player.moving) spread += this.player.sprinting ? 16 : 9
    if (!this.player.onGround) spread += 10
    if (firedThisFrame || this.weapons.reloading) spread += 12
    this.hud.setCrosshairSpread(spread)
    this.weapons.update(dt)
    // Enemies: on in solo (incl. solo BR storm) and online co-op; off in PvP modes.
    const pvpMode = this.onlineMode === 'dm' || this.onlineMode === 'team' || this.onlineMode === 'br' || this.onlineMode === 'ctf'
    if (!pvpMode) this.spawner.update(dt, this.player, this.camera)
    if (this.ctfMode) this._updateCtf(dt)
    if (this.zone) {
      this.hud.setStorm(this.zone.update(dt, this.player))
      this.hud.setStormTimer(this.zone.statusText())
      // Solo Battle Royale: survive until the storm fully closes -> Victory Royale.
      if (!this.net && this.player.alive && !this._wonBR && this.zone.radius <= this.zone.minR + 0.3) {
        this._wonBR = true
        this._winMatch('#1 VICTORY ROYALE', `You outlasted the storm. Kills: ${this.enemyKills || 0}.`)
      }
    }

    this.hud.setHp(this.player.hp, this.player.maxHp)
    this.hud.setAmmo(this.weapons.ammo, this.weapons.magazine)

    if (!this.player.alive && this.state === STATE.PLAYING) {
      if (this.net) this._handleMpDeath()
      else this.gameOver()
    }

    this._drawMinimap()
    this.renderer.render(this.world.scene, this.camera)
  }

  // Explode a barrel (FX + area damage + chain reactions).
  explode(barrel, depth = 0) {
    if (!barrel.alive) return
    this.world.removeBarrel(barrel)
    this.explodeAt(new THREE.Vector3(barrel.x, 1.0, barrel.z), { radius: 9, damage: 140, depth })
  }

  // Generic explosion at a point — used by barrels and grenades.
  explodeAt(pos, { radius = 8, damage = 120, depth = 0 } = {}) {
    this.particles.emit(pos, 64, { color: [1, 0.55, 0.12], speed: 15, spread: 11, size: 2.4, life: 0.5, gravity: -2, drag: 3, up: 4 })
    this.particles.emit(pos, 28, { color: [1, 0.92, 0.45], speed: 22, spread: 14, size: 1.0, life: 0.32, gravity: -2, drag: 4 })
    this.particles.emit(pos, 40, { color: [0.18, 0.18, 0.18], speed: 6, spread: 5, size: 3.6, life: 1.2, gravity: 1.4, drag: 1.4, up: 3 })
    this.weapons.impact(pos, 0xffa030)
    this.audio.explosion()

    for (const e of this.spawner.enemies) {
      if (!e.alive) continue
      const d = Math.hypot(e.group.position.x - pos.x, e.group.position.z - pos.z)
      if (d < radius) {
        const killed = e.takeHit(damage * (1 - d / radius))
        if (killed) {
          this.score += 10; this.hud.setScore(this.score)
          this.pickups.rollDrop(e.group.position.x, e.group.position.z)
        }
      }
    }
    const pd = Math.hypot(this.player.position.x - pos.x, this.player.position.z - pos.z)
    if (pd < radius && this.player.alive) this.player.takeDamage((damage * 0.36) * (1 - pd / radius))

    // Chain nearby barrels.
    if (depth < 6) {
      for (const b of this.world.barrels) {
        if (b.alive) {
          const d = Math.hypot(b.x - pos.x, b.z - pos.z)
          if (d < radius + b.radius) this.explode(b, depth + 1)
        }
      }
    }
  }

  throwGrenade() {
    if (this._grenadeCd > 0 || !this.player.alive) return
    this._grenadeCd = 1.0
    const aim = this.player.getAimRay()
    const start = aim.origin.clone().addScaledVector(aim.dir, 0.8)
    const vel = aim.dir.clone().multiplyScalar(20)
    vel.y += 4 // slight lob
    this.grenades.push(new Grenade({
      world: this.world, assets: this.assets, position: start, velocity: vel,
      onExplode: (p) => this.explodeAt(p, { radius: 7, damage: 110 }),
    }))
  }

  _applySettings() {
    if (!this.player) return
    this.player.mouseSensitivity = 0.0022 * this.settings.sens
    this.player.invertY = this.settings.invertY
  }

  // Top-down radar: player (heading), enemies, remote players, pickups.
  _drawMinimap() {
    const ctx = this.minimapCtx
    if (!ctx) return
    const W = this.minimap.width, H = this.minimap.height
    const cx = W / 2, cy = H / 2
    const HALF = this.world.arenaRadius
    const R = (W / 2) - 10
    const sx = (x) => cx + (x / HALF) * R
    const sz = (z) => cy + (z / HALF) * R

    ctx.clearRect(0, 0, W, H)
    // Arena bounds.
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.lineWidth = 2
    ctx.strokeRect(sx(-HALF), sz(-HALF), R * 2, R * 2)

    // Battle-royale safe zone circle.
    if (this.zone) {
      ctx.strokeStyle = '#39c6ff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(sx(this.zone.cx), sz(this.zone.cz), (this.zone.radius / HALF) * R, 0, Math.PI * 2)
      ctx.stroke()
    }

    const dot = (x, z, color, r = 3) => {
      ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(sx(x), sz(z), r, 0, Math.PI * 2); ctx.fill()
    }
    for (const it of this.pickups.items) dot(it.x, it.z, it.type === 'health' ? '#4ade80' : '#ffcb3d', 2.5)
    for (const e of this.spawner.enemies) if (e.alive) dot(e.group.position.x, e.group.position.z, '#ff5555')
    if (this.net) for (const rp of this.remotePlayers.values()) dot(rp.group.position.x, rp.group.position.z, '#5ab0ff')

    // Player as a heading triangle.
    const px = sx(this.player.position.x), py = sz(this.player.position.z)
    const a = -this.player.yaw // screen z+ is down
    ctx.save(); ctx.translate(px, py); ctx.rotate(a)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill()
    ctx.restore()
  }

  _renderOnce() {
    this.renderer.render(this.world.scene, this.camera)
  }

  _resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }
}

export { STATE }
