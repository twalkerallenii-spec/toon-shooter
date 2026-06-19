import * as THREE from 'three'
import { Input } from './Input.js'
import { HUD } from './HUD.js'
import { AssetLoader } from './AssetLoader.js'
import { World } from '../systems/World.js'
import { Weapons } from '../systems/Weapons.js'
import { Spawner } from '../systems/Spawner.js'
import { Particles } from '../systems/Particles.js'
import { Player } from '../entities/Player.js'
import { Net } from '../net/Net.js'
import { RemotePlayer } from '../entities/RemotePlayer.js'

// Game states
const STATE = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', DEAD: 'dead' }

export class Game {
  constructor(canvas) {
    this.canvas = canvas
    this.state = STATE.MENU
    this.score = 0

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
    this.score = 0
    this.remotePlayers = new Map() // id -> RemotePlayer (multiplayer)

    // HUD hooks
    this.weapons.onFire = () => {
      this.hud.setAmmo(this.weapons.ammo, this.weapons.magazine)
      this.player.notifyFired() // drives the shoot animation + aim facing
    }
    this.weapons.onReloadStart = () => this.hud.setReloading(true)
    this.weapons.onReloadEnd = () => {
      this.hud.setReloading(false)
      this.hud.setAmmo(this.weapons.ammo, this.weapons.magazine)
    }
    this.spawner.onWaveStart = (w) => this.hud.setWave(w)
    this.spawner.onKill = () => {
      this.score += 10
      this.hud.setScore(this.score)
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

    // Build the designed arena from kit environment props.
    const { LevelBuilder } = await import('../systems/LevelBuilder.js')
    await new LevelBuilder({ world: this.world, assets: this.assets }).build()
  }

  // Swap the FPS viewmodel to the given weapon def (cached load -> instant).
  _setWeaponViewmodel(def) {
    this.assets.loadModel(`models/guns/${def.model}.gltf`).then((m) => {
      if (m && this.weapons.def === def) this.player.setViewmodel(m.scene)
    })
  }

  start() {
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
    const status = document.getElementById('mp-status')
    const name = (document.getElementById('mp-name').value || '').trim() || `Player${Math.floor(Math.random() * 1000)}`
    const room = (document.getElementById('mp-room').value || 'lobby').trim()
    const url = (document.getElementById('mp-server').value || 'ws://localhost:8080').trim()
    status.textContent = 'Connecting…'

    this._disconnect()
    this._resetGameObjects()

    this.net = new Net({
      url, name, room,
      handlers: {
        onWelcome: (id, peers) => {
          status.textContent = ''
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
        onHit: (fromId, dmg) => this.player.takeDamage(dmg),
        onError: () => { status.textContent = 'Connection failed. Is the server running?' },
        onClose: () => { if (this.state === STATE.PLAYING) status.textContent = 'Disconnected.' },
      },
    })
  }

  _addRemote(id, name, state) {
    if (this.remotePlayers.has(id)) return
    const rp = new RemotePlayer({ world: this.world, assets: this.assets, name })
    if (state) rp.setState(state)
    this.remotePlayers.set(id, rp)
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
      const res = this.weapons.tryFire(this.player.getAimRay(), this.spawner.enemies, muzzle, ads)
      if (res.fired) {
        firedThisFrame = true
        if (res.killed) this.hud.hitMarker(true)
        else if (res.hit) this.hud.hitMarker(false)
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
    this.spawner.update(dt, this.player, this.camera)

    this.hud.setHp(this.player.hp, this.player.maxHp)
    this.hud.setAmmo(this.weapons.ammo, this.weapons.magazine)

    if (!this.player.alive && this.state === STATE.PLAYING) {
      this.gameOver()
    }

    this.renderer.render(this.world.scene, this.camera)
  }

  // Explode a barrel: particle FX, area damage to enemies + player, and chain
  // reactions to nearby barrels.
  explode(barrel, depth = 0) {
    if (!barrel.alive) return
    this.world.removeBarrel(barrel)

    const pos = new THREE.Vector3(barrel.x, 1.0, barrel.z)
    // Fireball + sparks + smoke.
    this.particles.emit(pos, 64, { color: [1, 0.55, 0.12], speed: 15, spread: 11, size: 2.4, life: 0.5, gravity: -2, drag: 3, up: 4 })
    this.particles.emit(pos, 28, { color: [1, 0.92, 0.45], speed: 22, spread: 14, size: 1.0, life: 0.32, gravity: -2, drag: 4 })
    this.particles.emit(pos, 40, { color: [0.18, 0.18, 0.18], speed: 6, spread: 5, size: 3.6, life: 1.2, gravity: 1.4, drag: 1.4, up: 3 })
    this.weapons.impact(pos, 0xffa030) // bright flash sphere

    const R = 9 // blast radius
    for (const e of this.spawner.enemies) {
      if (!e.alive) continue
      const d = Math.hypot(e.group.position.x - pos.x, e.group.position.z - pos.z)
      if (d < R) {
        const killed = e.takeHit(140 * (1 - d / R))
        if (killed) { this.score += 10; this.hud.setScore(this.score) }
      }
    }
    const pd = Math.hypot(this.player.position.x - pos.x, this.player.position.z - pos.z)
    if (pd < R && this.player.alive) this.player.takeDamage(50 * (1 - pd / R))

    // Chain nearby barrels (slight depth cap to avoid runaway recursion).
    if (depth < 6) {
      for (const b of this.world.barrels) {
        if (b.alive) {
          const d = Math.hypot(b.x - pos.x, b.z - pos.z)
          if (d < R + b.radius) this.explode(b, depth + 1)
        }
      }
    }
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
