import * as THREE from 'three'
import { Input } from './Input.js'
import { HUD } from './HUD.js'
import { AssetLoader } from './AssetLoader.js'
import { World } from '../systems/World.js'
import { Weapons } from '../systems/Weapons.js'
import { Spawner } from '../systems/Spawner.js'
import { Particles } from '../systems/Particles.js'
import { Player } from '../entities/Player.js'

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
    this.camera.position.set(0, 6, 14)
    this.camera.lookAt(0, 1, 0)
  }

  _resetGameObjects() {
    // Fresh world each run so old enemies/effects are gone.
    this._buildWorld()
    this.particles = new Particles(this.world.scene)
    this.player = new Player({ world: this.world, input: this.input, camera: this.camera })
    this.weapons = new Weapons({ world: this.world, particles: this.particles })
    this.spawner = new Spawner({ world: this.world, assets: this.assets, weapons: this.weapons })
    this.score = 0

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

    this.hud.setHp(this.player.hp, this.player.maxHp)
    this.hud.setScore(0)
    this.hud.setWave(1)
    this.hud.setAmmo(this.weapons.ammo, this.weapons.magazine)
    this.hud.setReloading(false)

    // Try to load real toon models if present (non-blocking).
    this._loadOptionalModels()
  }

  async _loadOptionalModels() {
    // Player character (no gun mounted — held weapon removed per design).
    const soldier = await this.assets.loadModel('models/characters/Character_Soldier.gltf')
    if (soldier) this.player.setModel(soldier.scene, soldier.animations, null)

    // Enemies are spawned over time, so the spawner clones this per enemy.
    this.spawner.enemyModelPath = 'models/characters/Character_Enemy.gltf'

    // Build the designed arena from kit environment props.
    const { LevelBuilder } = await import('../systems/LevelBuilder.js')
    await new LevelBuilder({ world: this.world, assets: this.assets }).build()
  }

  start() {
    this._resetGameObjects()
    this.state = STATE.PLAYING
    this.hud.hideOverlay()
    this.hud.show()
    this.input.requestLock()
    this.clock.getDelta() // reset dt
    this._loop()
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

    // Shooting (hold to fire; Weapons enforces fire rate).
    let firedThisFrame = false
    if (this.input.mouse.down && this.player.alive) {
      const muzzle = this.player.getMuzzleWorldPosition(this._muzzle)
      const res = this.weapons.tryFire(this.player.getAimRay(), this.spawner.enemies, muzzle)
      if (res.fired) {
        firedThisFrame = true
        if (res.killed) this.hud.hitMarker(true)
        else if (res.hit) this.hud.hitMarker(false)
        if (res.barrel) this.explode(res.barrel)
      }
    }

    this.player.update(dt)
    this.particles.update(dt)

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
