import * as THREE from 'three'
import { Input } from './Input.js'
import { HUD } from './HUD.js'
import { AssetLoader } from './AssetLoader.js'
import { World } from '../systems/World.js'
import { Weapons } from '../systems/Weapons.js'
import { Spawner } from '../systems/Spawner.js'
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
    this.player = new Player({ world: this.world, input: this.input, camera: this.camera })
    this.weapons = new Weapons({ world: this.world })
    this.spawner = new Spawner({ world: this.world, assets: this.assets })
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
    // Toon Shooter Game Kit assets (glTF with embedded buffers).
    const [soldier, gun, ...props] = await Promise.all([
      this.assets.loadModel('models/characters/Character_Soldier.gltf'),
      this.assets.loadModel('models/guns/AK.gltf'),
      this.assets.loadModel('models/env/Crate.gltf'),
      this.assets.loadModel('models/env/Barrier_Large.gltf'),
      this.assets.loadModel('models/env/CardboardBoxes_1.gltf'),
      this.assets.loadModel('models/env/Container_Small.gltf'),
      this.assets.loadModel('models/env/ExplodingBarrel.gltf'),
      this.assets.loadModel('models/env/SackTrench.gltf'),
    ])

    if (soldier) this.player.setModel(soldier.scene, soldier.animations, gun ? gun.scene : null)
    this.world.addPropModels(props.filter(Boolean))

    // Enemies are spawned over time, so the spawner clones this per enemy.
    this.spawner.enemyModelPath = 'models/characters/Character_Enemy.gltf'
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
    if (this.input.mouse.down && this.player.alive) {
      const muzzle = this.player.getMuzzleWorldPosition(this._muzzle)
      this.weapons.tryFire(this.player.getAimRay(), this.spawner.enemies, muzzle)
    }

    this.player.update(dt)
    this.weapons.update(dt)
    this.spawner.update(dt, this.player, this.camera)

    this.hud.setHp(this.player.hp, this.player.maxHp)
    this.hud.setAmmo(this.weapons.ammo, this.weapons.magazine)

    if (!this.player.alive && this.state === STATE.PLAYING) {
      this.gameOver()
    }

    this.renderer.render(this.world.scene, this.camera)
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
