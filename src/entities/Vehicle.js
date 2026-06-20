import * as THREE from 'three'

const TMP = new THREE.Vector3()

// A drivable arcade car. Flat-ground physics: throttle accelerates along the
// heading, steering turns (scaled by speed), friction slows it. Clamped to the
// arena and pushed out of solid obstacles. Driven only while occupied.
export class Vehicle {
  constructor({ world, x = 0, z = 0, heading = 0 }) {
    this.world = world
    this.position = new THREE.Vector3(x, 0, z)
    this.heading = heading
    this.speed = 0
    this.occupied = false

    // Tuning
    this.maxSpeed = 30
    this.maxReverse = 11
    this.accel = 20
    this.brake = 34
    this.friction = 8
    this.steerRate = 1.8 // rad/s at speed
    this.radius = 1.8    // collision radius

    this.group = new THREE.Group()
    this.group.position.copy(this.position)
    this.group.rotation.y = heading

    // Placeholder box until the model loads.
    this.placeholder = new THREE.Mesh(
      new THREE.BoxGeometry(2, 1, 4),
      new THREE.MeshStandardMaterial({ color: 0x884444, roughness: 0.7 })
    )
    this.placeholder.position.y = 0.6
    this.placeholder.castShadow = true
    this.group.add(this.placeholder)

    world.scene.add(this.group)
  }

  setModel(scene) {
    if (!scene) return
    this.group.remove(this.placeholder)
    scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false } })
    // Normalize to a ~4.4m-long car, feet on the ground, centered.
    const box = new THREE.Box3().setFromObject(scene)
    const size = new THREE.Vector3(); box.getSize(size)
    const longest = Math.max(size.x, size.z) || 1
    scene.scale.setScalar(4.4 / longest)
    const box2 = new THREE.Box3().setFromObject(scene)
    const c = new THREE.Vector3(); box2.getCenter(c)
    scene.position.set(-c.x, -box2.min.y, -c.z)
    // The model's long axis may be along X; rotate so it faces +Z (forward).
    if (size.x > size.z) scene.rotation.y = Math.PI / 2
    this.model = scene
    this.group.add(scene)
  }

  forward(out) { return out.set(Math.sin(this.heading), 0, Math.cos(this.heading)) }

  // controls = { throttle: -1..1, steer: -1..1 }
  update(dt, controls = { throttle: 0, steer: 0 }) {
    const thr = this.occupied ? controls.throttle : 0
    const steer = this.occupied ? controls.steer : 0

    // Longitudinal speed.
    if (thr > 0) this.speed += this.accel * thr * dt
    else if (thr < 0) this.speed += this.brake * thr * dt // brake / reverse
    else {
      // Coast: friction toward 0.
      const f = this.friction * dt
      if (this.speed > 0) this.speed = Math.max(0, this.speed - f)
      else if (this.speed < 0) this.speed = Math.min(0, this.speed + f)
    }
    this.speed = Math.max(-this.maxReverse, Math.min(this.maxSpeed, this.speed))

    // Steering only matters when moving; reverse flips it.
    if (Math.abs(this.speed) > 0.2) {
      const dir = this.speed >= 0 ? 1 : -1
      this.heading -= steer * this.steerRate * dt * dir * Math.min(1, Math.abs(this.speed) / 8 + 0.3)
    }

    // Integrate.
    this.forward(TMP)
    this.position.addScaledVector(TMP, this.speed * dt)

    // Obstacle push-out (circle vs circle).
    for (const o of this.world.obstacles) {
      const dx = this.position.x - o.mesh.position.x
      const dz = this.position.z - o.mesh.position.z
      const d = Math.hypot(dx, dz)
      const minD = o.radius + this.radius
      if (d < minD && d > 0.001) {
        const k = (minD - d) / d
        this.position.x += dx * k
        this.position.z += dz * k
        this.speed *= 0.6 // lose momentum on impact
      }
    }
    this.world.clampToArena(this.position)

    this.group.position.copy(this.position)
    this.group.rotation.y = this.heading
    // A little body roll while turning for flavor.
    if (this.model) this.model.rotation.z = -steer * Math.min(1, Math.abs(this.speed) / this.maxSpeed) * 0.12
  }

  dispose() {
    this.world.scene.remove(this.group)
    this.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.() })
  }
}
