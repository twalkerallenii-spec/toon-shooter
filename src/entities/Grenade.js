import * as THREE from 'three'

// A thrown grenade: arcs under gravity, bounces off the ground, and explodes when
// its fuse runs out. Visual is the kit Grenade model (placeholder sphere until it
// loads). Calls onExplode(position) when it goes off.
export class Grenade {
  constructor({ world, assets, position, velocity, onExplode, fuse = 1.6 }) {
    this.world = world
    this.onExplode = onExplode
    this.fuse = fuse
    this.exploded = false
    this.pos = position.clone()
    this.vel = velocity.clone()
    this.gravity = -20
    this.radius = 0.2

    this.group = new THREE.Group()
    this.group.position.copy(this.pos)
    const ph = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0x3a4a2a, roughness: 0.6 })
    )
    ph.castShadow = true
    this.group.add(ph)
    this._ph = ph
    world.scene.add(this.group)

    assets.loadModel('models/guns/Grenade.gltf').then((m) => {
      if (!m || this.exploded) return
      m.scene.traverse((o) => { if (o.isMesh) o.castShadow = true })
      const box = new THREE.Box3().setFromObject(m.scene)
      const size = new THREE.Vector3(); box.getSize(size)
      m.scene.scale.setScalar(0.45 / (Math.max(size.x, size.y, size.z) || 1))
      this.group.remove(ph)
      this.group.add(m.scene)
    })
  }

  // Returns true when it has exploded (caller removes it).
  update(dt) {
    if (this.exploded) return true
    this.fuse -= dt
    this.vel.y += this.gravity * dt
    this.pos.addScaledVector(this.vel, dt)

    // Bounce off the ground.
    if (this.pos.y <= this.radius) {
      this.pos.y = this.radius
      this.vel.y *= -0.45
      this.vel.x *= 0.7; this.vel.z *= 0.7
    }
    this.world.clampToArena(this.pos)
    this.group.position.copy(this.pos)
    this.group.rotation.x += dt * 6
    this.group.rotation.y += dt * 4

    if (this.fuse <= 0) {
      this.exploded = true
      this.onExplode?.(this.pos.clone())
      this.dispose()
      return true
    }
    return false
  }

  dispose() {
    this.world.scene.remove(this.group)
    this.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.() })
  }
}
