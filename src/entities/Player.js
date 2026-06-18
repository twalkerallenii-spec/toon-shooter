import * as THREE from 'three'

const TMP = new THREE.Vector3()
const FORWARD = new THREE.Vector3()
const RIGHT = new THREE.Vector3()

// Third-person player: an orbit-style camera looks over the character's shoulder.
// Movement is relative to the camera yaw. Includes gravity/jump and shooting
// driven from where the camera is aiming (screen-center raycast).
export class Player {
  constructor({ world, input, camera }) {
    this.world = world
    this.input = input
    this.camera = camera

    // Placeholder character mesh (replaced by a GLTF toon model via setModel()).
    this.group = new THREE.Group()
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3da9fc, roughness: 0.7 })
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.0, 6, 12), bodyMat)
    body.position.y = 1.0
    body.castShadow = true
    this.group.add(body)
    // Little "nose" so facing direction is visible on the placeholder.
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.25, 0.4),
      new THREE.MeshStandardMaterial({ color: 0xffcb3d })
    )
    nose.position.set(0, 1.3, 0.55)
    this.group.add(nose)
    this.placeholder = body

    // State
    this.position = this.group.position
    this.velocity = new THREE.Vector3()
    this.yaw = 0       // facing / camera horizontal angle
    this.pitch = 0.25  // camera vertical angle
    this.onGround = true
    this.height = 1.7

    // Stats
    this.maxHp = 100
    this.hp = this.maxHp
    this.alive = true

    // Movement tuning
    this.walkSpeed = 7
    this.sprintSpeed = 12
    this.jumpSpeed = 8
    this.gravity = -22
    this.mouseSensitivity = 0.0022

    // Camera rig
    this.camDistance = 6
    this.camHeight = 2.2

    world.scene.add(this.group)
  }

  // Swap the placeholder for a loaded GLTF model (keeps the same transform group).
  setModel(modelScene) {
    if (!modelScene) return
    this.group.remove(this.placeholder)
    modelScene.traverse((o) => { if (o.isMesh) o.castShadow = true })
    this.group.add(modelScene)
    this.model = modelScene
  }

  takeDamage(amount) {
    if (!this.alive) return
    this.hp = Math.max(0, this.hp - amount)
    if (this.hp <= 0) {
      this.alive = false
    }
  }

  // Returns the world-space aim ray (origin + normalized direction) from the
  // camera through screen center — used by the shooting system.
  getAimRay() {
    const origin = new THREE.Vector3()
    this.camera.getWorldPosition(origin)
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    return { origin, dir }
  }

  update(dt) {
    if (this.alive) this._handleLook()
    this._handleMove(dt)
    this._updateCamera()
  }

  _handleLook() {
    const { dx, dy } = this.input.consumeMouseDelta()
    this.yaw -= dx * this.mouseSensitivity
    this.pitch -= dy * this.mouseSensitivity
    // Clamp pitch so the camera can't flip over.
    this.pitch = Math.max(-0.4, Math.min(1.2, this.pitch))
  }

  _handleMove(dt) {
    // Camera-relative basis on the ground plane.
    FORWARD.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))
    RIGHT.set(FORWARD.z, 0, -FORWARD.x)

    let ix = 0, iz = 0
    if (this.alive) {
      if (this.input.isDown('KeyW')) iz += 1
      if (this.input.isDown('KeyS')) iz -= 1
      if (this.input.isDown('KeyD')) ix += 1
      if (this.input.isDown('KeyA')) ix -= 1
    }

    const sprint = this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight')
    const speed = sprint ? this.sprintSpeed : this.walkSpeed

    TMP.set(0, 0, 0)
    TMP.addScaledVector(FORWARD, iz)
    TMP.addScaledVector(RIGHT, ix)
    if (TMP.lengthSq() > 0) {
      TMP.normalize()
      // Face the movement direction (character turns toward where it walks).
      const targetAngle = Math.atan2(TMP.x, TMP.z)
      this.group.rotation.y = lerpAngle(this.group.rotation.y, targetAngle, 0.2)
    }

    this.velocity.x = TMP.x * speed
    this.velocity.z = TMP.z * speed

    // Jump + gravity
    if (this.alive && this.onGround && this.input.isDown('Space')) {
      this.velocity.y = this.jumpSpeed
      this.onGround = false
    }
    this.velocity.y += this.gravity * dt

    // Integrate
    this.position.x += this.velocity.x * dt
    this.position.y += this.velocity.y * dt
    this.position.z += this.velocity.z * dt

    // Ground collision
    if (this.position.y <= this.world.groundY) {
      this.position.y = this.world.groundY
      this.velocity.y = 0
      this.onGround = true
    }

    // Obstacle collision (simple circle push-out)
    for (const o of this.world.obstacles) {
      const dx = this.position.x - o.mesh.position.x
      const dz = this.position.z - o.mesh.position.z
      const d = Math.hypot(dx, dz)
      const minD = o.radius + 0.6
      if (d < minD && d > 0.0001) {
        const k = (minD - d) / d
        this.position.x += dx * k
        this.position.z += dz * k
      }
    }

    this.world.clampToArena(this.position)
  }

  _updateCamera() {
    // Orbit camera around the player based on yaw/pitch.
    const cx = Math.sin(this.yaw) * Math.cos(this.pitch)
    const cy = Math.sin(this.pitch)
    const cz = Math.cos(this.yaw) * Math.cos(this.pitch)

    const target = TMP.set(
      this.position.x,
      this.position.y + this.camHeight,
      this.position.z
    )

    this.camera.position.set(
      target.x - cx * this.camDistance,
      target.y + cy * this.camDistance,
      target.z - cz * this.camDistance
    )
    // Keep camera above ground.
    if (this.camera.position.y < 0.6) this.camera.position.y = 0.6
    this.camera.lookAt(target)
  }
}

function lerpAngle(a, b, t) {
  let diff = b - a
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return a + diff * t
}
