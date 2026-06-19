import * as THREE from 'three'
import { Enemy } from '../entities/Enemy.js'

// Wave-based spawner. Each wave spawns more/tougher enemies. When all are dead,
// a short intermission then the next wave begins.
export class Spawner {
  constructor({ world, assets }) {
    this.world = world
    this.assets = assets
    this.enemies = []
    this.wave = 0
    this.intermission = 0
    this.spawnQueue = 0
    this.spawnTimer = 0
    this.pending = 0 // clones in-flight (async load) not yet added
    this.enemyModelPath = null // set by Game after preloading
    this.onWaveStart = null
    this.onKill = null
    this._startNextWave()
  }

  get aliveCount() {
    return this.enemies.filter((e) => e.alive).length
  }

  _startNextWave() {
    this.wave += 1
    const count = 3 + Math.floor(this.wave * 1.5)
    this.spawnQueue = count
    this.spawnTimer = 0
    this.onWaveStart?.(this.wave)
  }

  async _spawnOne() {
    const ang = Math.random() * Math.PI * 2
    const dist = this.world.arenaRadius - 4
    const pos = new THREE.Vector3(Math.cos(ang) * dist, 0, Math.sin(ang) * dist)
    const hp = 60 + this.wave * 12
    const speed = 3 + Math.min(4, this.wave * 0.25)
    const damage = 7 + Math.floor(this.wave * 0.6)
    // Fresh skeleton-safe clone per enemy (async load is cached after first).
    this.pending += 1
    const model = this.enemyModelPath ? await this.assets.loadModel(this.enemyModelPath) : null
    this.enemies.push(new Enemy({ world: this.world, position: pos, hp, speed, damage, model }))
    this.pending -= 1
  }

  update(dt, player, camera) {
    if (this.spawnQueue > 0) {
      this.spawnTimer -= dt
      if (this.spawnTimer <= 0) {
        this._spawnOne()
        this.spawnQueue -= 1
        this.spawnTimer = 0.6
      }
    }

    // Update enemies; update() returns true once an enemy is finished (death
    // animation complete) and ready for removal.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]
      const wasAlive = e.alive
      const finished = e.update(dt, player, camera)
      if (wasAlive && !e.alive) this.onKill?.() // counts the kill at death moment
      if (finished) {
        e.dispose()
        this.enemies.splice(i, 1)
      }
    }
    this._separate()

    if (this.spawnQueue === 0 && this.pending === 0 && this.aliveCount === 0) {
      if (this.intermission <= 0) this.intermission = 2.5
      this.intermission -= dt
      if (this.intermission <= 0) this._startNextWave()
    }
  }

  _separate() {
    const list = this.enemies.filter((e) => e.alive)
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].group.position
        const b = list[j].group.position
        const dx = b.x - a.x, dz = b.z - a.z
        const d = Math.hypot(dx, dz)
        const minD = 1.4
        if (d < minD && d > 0.0001) {
          const k = (minD - d) / d / 2
          a.x -= dx * k; a.z -= dz * k
          b.x += dx * k; b.z += dz * k
        }
      }
    }
  }
}
