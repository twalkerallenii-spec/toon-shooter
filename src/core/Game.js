import * as THREE from 'three'
import { Input } from './Input.js'
import { HUD } from './HUD.js'
import { AssetLoader } from './AssetLoader.js'
import { World } from '../systems/World.js'
import { Weapons } from '../systems/Weapons.js'
import { Spawner } from '../systems/Spawner.js'
import { Particles } from '../systems/Particles.js'
import { Audio } from '../systems/Audio.js'
import { Pickups } from '../systems/Pickups.js'
import { Player } from '../entities/Player.js'
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

    // Multiplayer: prefill server from ?server= and wire the PLAY ONLINE button.
    const params = new URLSearchParams(location.search)
    const serverInput = document.getElementById('mp-server')
    if (params.get('server')) serverInput.value = params.get('server')
    document.getElementById('online-btn').addEventListener('click', () => {
      if (this.state === STATE.PLAYING) return
      this.startOnline()
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

    this.input.onLockChange = (locked) => {
      // Losing the pointer lock mid-game = pause.
      if (!locked && this.state === STATE.PLAYING) this.pause()
    }

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR' && this.state === STATE.PLAYING) this.weapons.startReload()
    })
  }

  _buildWorld() {
    this.world = new World()
    this.camera.fov = 72 // reset base FOV (ADS may have left it zoomed)
    this.camera.updateProjectionMatrix()
    this.camera.position.set(0, 1.6, 0)
  }

  _resetGameObjects() {
    // Fresh world each run so old enemies/effects are gone.
    this._buildWorld()
    // Camera must be in the scene graph so the FPS viewmodel (its child) renders.
    this.world.scene.add(this.camera)
    this.particles = new Particles(this.world.scene)
    this.player = new Player({ world: this.world, input: this.input, camera: this.camera })
    this.weapons = new Weapons({ world: this.world, particles: this.particles })
    this.spawner = new Spawner({ world: this.world, assets: this.assets, weapons: this.weapons })
    this.pickups = new Pickups({ world: this.world, assets: this.assets, audio: this.audio })
    this.grenades = []
    this.score = 0
    this._prevHp = this.player.maxHp
    this._deadHandled = false
    this._lastAttacker = null
    this.remotePlayers = new Map() // id -> RemotePlayer (multiplayer)
    this.player.onJumpPad = () => this.audio.jumpPad()
    this.hud.clearKillFeed()

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

    // Build the selected map from kit environment props.
    const { LevelBuilder } = await import('../systems/LevelBuilder.js')
    await new LevelBuilder({ world: this.world, assets: this.assets }).build(this.selectedMap)
  }

  // Swap the FPS viewmodel to the given weapon def (cached load -> instant).
  _setWeaponViewmodel(def) {
    this.assets.loadModel(`models/guns/${def.model}.gltf`).then((m) => {
      if (m && this.weapons.def === def) this.player.setViewmodel(m.scene)
    })
  }

  start() {
    this.audio.resume()
    this.onlineMode = null // solo = co-op waves
    this._disconnect() // solo play: drop any prior connection
    this._resetGameObjects()
    this.state = STATE.PLAYING
    this.hud.hideOverlay()
    this.hud.show()
    this.input.requestLock()
    this.clock.getDelta() // reset dt
    this._loop()
  }

  // Connect to the relay server, then start once joined.
  startOnline() {
    this.audio.resume()
    const status = document.getElementById('mp-status')
    const name = (document.getElementById('mp-name').value || '').trim() || `Player${Math.floor(Math.random() * 1000)}`
    const room = (document.getElementById('mp-room').value || 'lobby').trim()
    const url = (document.getElementById('mp-server').value || 'ws://localhost:8080').trim()
    this.onlineMode = document.querySelector('.mode-btn.active')?.dataset.mode || 'coop'
    status.textContent = 'Connecting…'

    this._disconnect()
    this._resetGameObjects()

    this.net = new Net({
      url, name, room,
      handlers: {
        onWelcome: (id, peers) => {
          status.textContent = ''
          this.peerNames.set(id, this._selfName)
          this.kills = 0; this.deaths = 0
          this.hud.setScore('0/0')
          for (const peer of peers) this._addRemote(peer.id, peer.name, peer.p)
          this.state = STATE.PLAYING
          this.hud.hideOverlay()
          this.hud.show()
          this.input.requestLock()
          this.clock.getDelta()
          this._loop()
        },
        onPeerJoin: (id, pname) => this._addRemote(id, pname),
        onPeerLeave: (id) => {
          this.remotePlayers.get(id)?.dispose()
          this.remotePlayers.delete(id)
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
        onError: () => { status.textContent = 'Connection failed. Is the server running?' },
        onClose: () => { if (this.state === STATE.PLAYING) status.textContent = 'Disconnected.' },
      },
    })
    this.peerNames = new Map([[this.net?.id, name]]) // updated on welcome
    this._selfName = name
  }

  _addRemote(id, name, state) {
    if (this.remotePlayers.has(id)) return
    const rp = new RemotePlayer({ world: this.world, assets: this.assets, name, id })
    if (state) rp.setState(state)
    this.remotePlayers.set(id, rp)
    this.peerNames?.set(id, name)
  }

  _handleMpDeath() {
    if (this._deadHandled) return
    this._deadHandled = true
    this.net.sendKilled(this._lastAttacker ?? null)
    this.kills = this.kills || 0
    this.deaths = (this.deaths || 0) + 1
    this.hud.setScore(`${this.kills}/${this.deaths}`)
    setTimeout(() => this._respawn(), 1800)
  }

  _respawn() {
    const a = Math.random() * Math.PI * 2
    const r = this.world.arenaRadius - 6
    this.player.position.set(Math.cos(a) * r, 0, Math.sin(a) * r)
    this.player.velocity.set(0, 0, 0)
    this.player.hp = this.player.maxHp
    this.player.alive = true
    this._prevHp = this.player.hp
    this._deadHandled = false
    this._lastAttacker = null
  }

  _onKilled(byId, victimId) {
    const killer = byId != null ? (this.peerNames?.get(byId) || `Player${byId}`) : 'the world'
    const victim = victimId === this.net?.id ? this._selfName : (this.peerNames?.get(victimId) || `Player${victimId}`)
    this.hud.addKillFeed(`${killer} ▸ ${victim}`)
    if (byId === this.net?.id && victimId !== this.net?.id) {
      this.kills = (this.kills || 0) + 1
      this.deaths = this.deaths || 0
      this.hud.setScore(`${this.kills}/${this.deaths}`)
    }
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
    this.input.requestLock()
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

    // Weapon switching: number keys + mouse wheel.
    for (let i = 0; i < this.weapons.defs.length; i++) {
      if (this.input.isDown(`Digit${i + 1}`)) this.weapons.switchTo(i)
    }
    const wheel = this.input.consumeWheel()
    if (wheel) this.weapons.cycle(wheel)

    // Reload (R).
    if (this.input.isDown('KeyR')) this.weapons.startReload()

    // Grenade (G).
    this._grenadeCd = Math.max(0, this._grenadeCd - dt)
    if (this.input.isDown('KeyG')) this.throwGrenade()

    // Aim-down-sights (right mouse).
    const ads = this.input.mouse.right && this.player.alive
    this.player.setADS(ads)
    this.hud.setAds(this.player.adsAmount > 0.5)

    // Shooting: auto weapons fire while held; semi-auto fire once per click.
    let firedThisFrame = false
    const click = this.input.consumeClick()
    const wantFire = this.weapons.auto ? this.input.mouse.down : click
    if (wantFire && this.player.alive) {
      const muzzle = this.player.getMuzzleWorldPosition(this._muzzle)
      const remotes = this.net ? [...this.remotePlayers.values()] : []
      const res = this.weapons.tryFire(this.player.getAimRay(), this.spawner.enemies, muzzle, ads, remotes)
      if (res.fired) {
        firedThisFrame = true
        if (res.killed) { this.hud.hitMarker(true); this.audio.kill() }
        else if (res.hit) { this.hud.hitMarker(false); this.audio.hit() }
        if (res.playerHit != null && this.net) {
          this.net.sendHit(res.playerHit, this.weapons.def.damage)
          this.hud.hitMarker(false); this.audio.hit()
        }
        if (res.barrel) this.explode(res.barrel)
        // Broadcast the shot so other players see a tracer.
        if (this.net) {
          const aim = this.player.getAimRay()
          const to = aim.origin.clone().addScaledVector(aim.dir, 60)
          this.net.sendShoot([muzzle.x, muzzle.y, muzzle.z], [to.x, to.y, to.z])
        }
      }
    }

    this.player.update(dt)
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
    if (this.onlineMode !== 'dm') this.spawner.update(dt, this.player, this.camera)

    this.hud.setHp(this.player.hp, this.player.maxHp)
    this.hud.setAmmo(this.weapons.ammo, this.weapons.magazine)

    if (!this.player.alive && this.state === STATE.PLAYING) {
      if (this.net) this._handleMpDeath()
      else this.gameOver()
    }

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
