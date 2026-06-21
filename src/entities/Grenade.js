import * as THREE from 'three'

const RAY = new THREE.Raycaster()
const STEP = new THREE.Vector3()

// A thrown/launched grenade: arcs under gravity. With `impact` it detonates the
// instant it touches the ground or any solid object; otherwise it bounces and
// explodes on its fuse. Calls onExplode(position) when it goes off.
export class Grenade {
  constructor({ world, assets, position, velocity, onExplode, fuse = 1.6, impact = false }) {
    this.world = world
    this.onExplode = onExplode
    this.fuse = fuse
    this.impact = impact
    this.exploded = false
    this.pos = position.clone()
    this.prev = position.clone()
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

  _explode(at) {
    if (this.exploded) return true
    this.exploded = true
    this.onExplode?.((at || this.pos).clone())
    this.dispose()
    return true
  }

  // Returns true when it has exploded (caller removes it).
  update(dt) {
    if (this.exploded) return true
    this.fuse -= dt
    this.prev.copy(this.pos)
    this.vel.y += this.gravity * dt
    this.pos.addScaledVector(this.vel, dt)

    // Impact: detonate on first contact with a solid object along this step.
    if (this.impact && this.world.obstacles?.length) {
      STEP.subVectors(this.pos, this.prev)
      const len = STEP.length()
      if (len > 0.0001) {
        RAY.set(this.prev, STEP.normalize()); RAY.far = len + this.radius
        const hits = RAY.intersectObjects(this.world.obstacles.map((o) => o.mesh), true)
        if (hits.length) return this._explode(hits[0].point)
      }
    }

    // Ground contact: impact grenades blow up; others bounce.
    if (this.pos.y <= this.radius) {
      this.pos.y = this.radius
      if (this.impact) return this._explode()
      this.vel.y *= -0.45
      this.vel.x *= 0.7; this.vel.z *= 0.7
    }
    this.world.clampToArena(this.pos)
    this.group.position.copy(this.pos)
    this.group.rotation.x += dt * 6
    this.group.rotation.y += dt * 4

    if (this.fuse <= 0) return this._explode()
    return false
  }

  dispose() {
    this.world.scene.remove(this.group)
    this.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.() })
  }
}
