import * as THREE from 'three'

// Battle-royale safe zone: a circle that shrinks in phases. Standing outside
// ("the storm") deals damage over time. Renders a translucent cylinder wall at
// the boundary; update() returns whether the player is currently outside.
export class Zone {
  constructor(world, particles = null) {
    this.world = world
    this.particles = particles
    this.cx = 0; this.cz = 0
    this.maxR = world.arenaRadius
    this.radius = this.maxR
    this.targetR = this.maxR
    this.minR = 6
    this.shrinkRate = 3
    this.damage = 7 // damage per second outside
    this.phaseTimer = 8 // grace before first shrink
    this.shrinking = false
    this._fireTimer = 0
    this._ringTimer = 0

    this._baseR = this.radius
    const geo = new THREE.CylinderGeometry(this._baseR, this._baseR, 80, 64, 1, true)
    const mat = new THREE.MeshBasicMaterial({
      color: 0x9b30ff, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false,
    })
    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.position.set(this.cx, 40, this.cz)
    world.scene.add(this.mesh)
  }

  update(dt, player) {
    if (this.shrinking) {
      this.radius = Math.max(this.targetR, this.radius - this.shrinkRate * dt)
      if (this.radius <= this.targetR + 0.02) { this.shrinking = false; this.phaseTimer = 7 }
    } else if (this.targetR > this.minR) {
      this.phaseTimer -= dt
      if (this.phaseTimer <= 0) { this.targetR = Math.max(this.minR, this.targetR * 0.6); this.shrinking = true }
    }
    const s = this.radius / this._baseR
    this.mesh.scale.set(s, 1, s)

    // Purple flames creeping along the storm wall near the player.
    this._ringTimer -= dt
    if (this.particles && this._ringTimer <= 0) {
      this._ringTimer = 0.1
      const baseAng = Math.atan2(player.position.z - this.cz, player.position.x - this.cx)
      for (let i = 0; i < 3; i++) {
        const a = baseAng + (Math.random() - 0.5) * 1.6
        const px = this.cx + Math.cos(a) * this.radius
        const pz = this.cz + Math.sin(a) * this.radius
        this.particles.emit({ x: px, y: 0.5, z: pz }, 2,
          { color: [0.6, 0.12, 1], speed: 1.5, spread: 1, size: 1.7, life: 0.7, gravity: 5, drag: 1, up: 3 })
      }
    }

    const d = Math.hypot(player.position.x - this.cx, player.position.z - this.cz)
    const outside = d > this.radius
    if (outside && player.alive) {
      player.takeDamage(this.damage * dt)
      // Purple fire licking up around the player while in the storm.
      this._fireTimer -= dt
      if (this.particles && this._fireTimer <= 0) {
        this._fireTimer = 0.05
        this.particles.emit(
          { x: player.position.x + (Math.random() - 0.5) * 1.2, y: 0.3, z: player.position.z + (Math.random() - 0.5) * 1.2 },
          4, { color: [0.75, 0.1, 1], speed: 2, spread: 1.5, size: 1.2, life: 0.5, gravity: 7, drag: 2, up: 4 })
      }
    }
    return outside
  }

  // Short HUD status: countdown to the next shrink, or current phase.
  statusText() {
    if (this.targetR <= this.minR && !this.shrinking) return '🌀 Final ring'
    if (this.shrinking) return '🌀 Storm closing…'
    const s = Math.max(0, Math.ceil(this.phaseTimer))
    return `⏱ Storm shrinks in 0:${String(s).padStart(2, '0')}`
  }

  dispose() {
    this.world.scene.remove(this.mesh)
    this.mesh.geometry.dispose(); this.mesh.material.dispose()
  }
}
