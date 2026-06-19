import * as THREE from 'three'
import { CharacterAnimator, normalizeModel } from './CharacterAnimator.js'

const TMP = new THREE.Vector3()
const FORWARD = new THREE.Vector3()
const RIGHT = new THREE.Vector3()

// Third-person player: an orbit-style camera looks over the character's shoulder.
// Movement is relative to the camera yaw. Includes gravity/jump, shooting driven
// from the camera aim, and an animated character model (Toon Shooter Game Kit).
export class Player {
  constructor({ world, input, camera }) {
    this.world = world
    this.input = input
    this.camera = camera

    // Container for the character. A child "yaw pivot" lets the model face its
    // own direction independent of the camera.
    this.group = new THREE.Group()
    this.modelPivot = new THREE.Group()
    this.group.add(this.modelPivot)

    // Placeholder (used until the GLTF model loads).
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3da9fc, roughness: 0.7 })
    this.placeholder = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.0, 6, 12), bodyMat)
    this.placeholder.position.y = 1.0
    this.placeholder.castShadow = true
    this.modelPivot.add(this.placeholder)

    // State
    this.position = this.group.position
    this.velocity = new THREE.Vector3()
    this.yaw = 0       // camera horizontal angle
    this.pitch = 0.25  // camera vertical angle
    this.facing = 0    // model facing angle (smoothed)
    this.onGround = true
    this.targetHeight = 1.8

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

    // Animation
    this.animator = null
    this.shootingTimer = 0 // keeps shoot pose briefly after firing

    world.scene.add(this.group)
  }

  // Install the animated GLTF character (scene + clips) and attach a gun model.
  setModel(scene, clips, gunScene) {
    if (!scene) return
    this.modelPivot.remove(this.placeholder)
    scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false } })
    normalizeModel(scene, this.targetHeight)
    this.modelPivot.add(scene)
    this.model = scene

    if (clips && clips.length) {
      this.animator = new CharacterAnimator(scene, clips)
      this.animator.play('Idle', { fade: 0 })
    }

    // Muzzle point (front-right, gun height) used as the tracer origin so shots
    // visibly come from the player, not the camera.
    this.muzzle = new THREE.Object3D()
    this.muzzle.position.set(0.32, 1.32, 1.0)
    this.modelPivot.add(this.muzzle)

    if (gunScene) this._attachGun(gunScene)
  }

  // Mount the gun in the player's hands at a sensible, fixed size/orientation
  // (parented to the model pivot so it always points where the body faces).
  _attachGun(gunScene) {
    gunScene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false } })

    // Scale the gun to a real-world length (~0.9m) regardless of its native units.
    const box = new THREE.Box3().setFromObject(gunScene)
    const size = new THREE.Vector3(); box.getSize(size)
    const longest = Math.max(size.x, size.y, size.z) || 1
    gunScene.scale.setScalar(0.9 / longest)

    // Orient the barrel forward (+Z). Kit guns model their length along X.
    gunScene.rotation.y = -Math.PI / 2

    // Recenter and place in the right hand, chest height, slightly forward.
    const box2 = new THREE.Box3().setFromObject(gunScene)
    const center = new THREE.Vector3(); box2.getCenter(center)
    gunScene.position.set(0.32 - center.x, 1.3 - center.y, 0.45 - center.z)

    this.modelPivot.add(gunScene)
    this.gun = gunScene
  }

  getMuzzleWorldPosition(out) {
    return this.muzzle
      ? this.muzzle.getWorldPosition(out)
      : out.set(this.position.x, this.position.y + 1.3, this.position.z)
  }

  takeDamage(amount) {
    if (!this.alive) return
    this.hp = Math.max(0, this.hp - amount)
    if (this.hp <= 0) {
      this.alive = false
      this.animator?.play('Death', { once: true, fade: 0.15 })
    } else {
      this.animator?.playOnceThen('HitReact', this._baseClip())
    }
  }

  notifyFired() {
    this.shootingTimer = 0.25
  }

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
    if (this.shootingTimer > 0) this.shootingTimer -= dt
    this._updateAnimation(dt)
  }

  _handleLook() {
    const { dx, dy } = this.input.consumeMouseDelta()
    this.yaw -= dx * this.mouseSensitivity
    this.pitch -= dy * this.mouseSensitivity
    this.pitch = Math.max(-0.4, Math.min(1.2, this.pitch))
  }

  _handleMove(dt) {
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
    this.moving = TMP.lengthSq() > 0
    this.sprinting = sprint && this.moving

    if (this.moving) {
      TMP.normalize()
      // While shooting, face the camera/aim direction; otherwise face movement.
      const target = this.shootingTimer > 0 ? this.yaw : Math.atan2(TMP.x, TMP.z)
      this.facing = lerpAngle(this.facing, target, 0.25)
    } else if (this.shootingTimer > 0) {
      this.facing = lerpAngle(this.facing, this.yaw, 0.25)
    }
    this.modelPivot.rotation.y = this.facing

    this.velocity.x = TMP.x * speed
    this.velocity.z = TMP.z * speed

    if (this.alive && this.onGround && this.input.isDown('Space')) {
      this.velocity.y = this.jumpSpeed
      this.onGround = false
      this.animator?.play('Jump', { once: true, fade: 0.1 })
    }
    this.velocity.y += this.gravity * dt

    this.position.x += this.velocity.x * dt
    this.position.y += this.velocity.y * dt
    this.position.z += this.velocity.z * dt

    if (this.position.y <= this.world.groundY) {
      this.position.y = this.world.groundY
      this.velocity.y = 0
      this.onGround = true
    }

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

  _baseClip() {
    if (!this.animator) return 'Idle'
    if (this.moving) {
      if (this.shootingTimer > 0 && this.animator.has('Run_Shoot')) return 'Run_Shoot'
      if (this.sprinting && this.animator.has('Run')) return 'Run'
      if (this.animator.has('Run')) return 'Run'
      if (this.animator.has('Walk')) return 'Walk'
    }
    if (this.shootingTimer > 0 && this.animator.has('Idle_Shoot')) return 'Idle_Shoot'
    return 'Idle'
  }

  _updateAnimation(dt) {
    if (!this.animator) return
    if (this.alive) {
      // Don't interrupt a one-shot jump/hit react that's mid-air.
      if (this.onGround) this.animator.play(this._baseClip(), { fade: 0.15 })
    }
    this.animator.update(dt)
  }

  _updateCamera() {
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
