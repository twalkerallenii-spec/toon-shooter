import * as THREE from 'three'

// Battle-royale safe zone: a circle that shrinks in phases. Standing outside
// ("the storm") deals damage over time. Renders a translucent cylinder wall at
// the boundary; update() returns whether the player is currently outside.
export class Zone {
  constructor(world) {
    this.world = world
    this.cx = 0; this.cz = 0
    this.maxR = world.arenaRadius
    this.radius = this.maxR
    this.targetR = this.maxR
    this.minR = 6
    this.shrinkRate = 3
    this.damage = 7 // damage per second outside
    this.phaseTimer = 8 // grace before first shrink
    this.shrinking = false

    this._baseR = this.radius
    const geo = new THREE.CylinderGeometry(this._baseR, this._baseR, 80, 64, 1, true)
    const mat = new THREE.MeshBasicMaterial({
      color: 0x39c6ff, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false,
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

    const d = Math.hypot(player.position.x - this.cx, player.position.z - this.cz)
    const outside = d > this.radius
    if (outside && player.alive) player.takeDamage(this.damage * dt)
    return outside
  }

  dispose() {
    this.world.scene.remove(this.mesh)
    this.mesh.geometry.dispose(); this.mesh.material.dispose()
  }
}
