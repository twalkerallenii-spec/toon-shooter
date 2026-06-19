import * as THREE from 'three'

const TMP = new THREE.Vector3()
const FORWARD = new THREE.Vector3()
const RIGHT = new THREE.Vector3()

// First-person player: eye-level camera with mouse look, a gun viewmodel mounted
// to the camera (with bob + recoil), gravity/jump, and movement relative to where
// you look. The character body isn't rendered — you only see the gun.
export class Player {
  constructor({ world, input, camera }) {
    this.world = world
    this.input = input
    this.camera = camera
    this.camera.rotation.order = 'YXZ'

    this.group = new THREE.Group() // holds the (hidden) feet position
    world.scene.add(this.group)

    // State
    this.position = this.group.position
    this.velocity = new THREE.Vector3()
    this.yaw = 0
    this.pitch = 0
    this.onGround = true
    this.eyeHeight = 1.62

    // Stats
    this.maxHp = 100
    this.hp = this.maxHp
    this.alive = true

    // Movement tuning
    this.walkSpeed = 7
    this.sprintSpeed = 12
    this.jumpSpeed = 9.5 // enough to hop onto crates/sandbags
    this.gravity = -22
    this.mouseSensitivity = 0.0022

    // View feel
    this.moving = false
    this.sprinting = false
    this.bobT = 0
    this.recoil = 0
    this.shootingTimer = 0

    // Aim-down-sights
    this.adsActive = false
    this.adsAmount = 0          // 0 = hip, 1 = fully aimed (smoothed)
    this.baseFov = camera.fov
    this.adsTargetFov = 50
    this.weaponRecoil = 0.05

    // Viewmodel positions (camera space): hip vs aimed.
    this.gunHip = new THREE.Vector3(0.2, -0.18, -0.55)
    this.gunAds = new THREE.Vector3(0.0, -0.115, -0.42)
    this.gunBase = this.gunHip.clone()

    // Muzzle anchor (gun tip) + flash, in camera space so they track the view.
    this.muzzle = new THREE.Object3D()
    this.muzzle.position.set(0.2, -0.1, -1.0)
    this.camera.add(this.muzzle)

    this.flashTimer = 0
    this.muzzleFlash = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending })
    )
    this.muzzleFlash.renderOrder = 30
    this.muzzleFlash.visible = false
    this.muzzle.add(this.muzzleFlash)
  }

  // Update per-weapon view params (ADS zoom + recoil strength).
  setWeapon(def) {
    if (!def) return
    this.adsTargetFov = def.adsFov ?? 50
    this.weaponRecoil = def.recoil ?? 0.05
  }

  setADS(active) { this.adsActive = active }

  // Mount a kit gun as the first-person viewmodel (parented to the camera).
  // Replaces any current viewmodel (used for weapon switching).
  setViewmodel(gunScene) {
    if (!gunScene) return
    if (this.gun) { this.camera.remove(this.gun); this.gun = null }
    // Draw the viewmodel on top so it never clips into world geometry.
    gunScene.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = false
        o.renderOrder = 20
        if (o.material) { o.material.depthTest = false; o.material.depthWrite = false }
      }
    })

    // Scale to a viewmodel length and aim the barrel down camera-forward (-Z).
    const box = new THREE.Box3().setFromObject(gunScene)
    const size = new THREE.Vector3(); box.getSize(size)
    const longest = Math.max(size.x, size.y, size.z) || 1
    gunScene.scale.setScalar(0.55 / longest)
    gunScene.rotation.y = -Math.PI / 2 // kit guns run along X -> point barrel along -Z (forward)

    const box2 = new THREE.Box3().setFromObject(gunScene)
    const center = new THREE.Vector3(); box2.getCenter(center)
    // Recenter to origin, then place via gunBase each frame.
    gunScene.position.set(-center.x, -center.y, -center.z)
    this.gunOffset = gunScene.position.clone()

    this.gun = new THREE.Group()
    this.gun.add(gunScene)
    this.gun.position.copy(this.gunBase)
    this.camera.add(this.gun)
  }

  // No body model in FPS; kept for API compatibility (ignored).
  setModel() {}

  getMuzzleWorldPosition(out) {
    return this.muzzle.getWorldPosition(out)
  }

  getAimRay() {
    const origin = new THREE.Vector3()
    this.camera.getWorldPosition(origin)
    const dir = new THREE.Vector3()
    this.camera.getWorldDirection(dir)
    return { origin, dir }
  }

  takeDamage(amount) {
    if (!this.alive) return
    this.hp = Math.max(0, this.hp - amount)
    if (this.hp <= 0) this.alive = false
  }

  notifyFired() {
    this.shootingTimer = 0.15
    this.recoil = Math.min(this.recoil + this.weaponRecoil, 0.22) // accumulate kick
    this.flashTimer = 0.045
  }

  update(dt) {
    if (this.alive) this._handleLook()
    this._handleMove(dt)
    if (this.shootingTimer > 0) this.shootingTimer -= dt
    this.recoil *= Math.max(0, 1 - dt * 9) // recover from kick

    // Smooth ADS transition + FOV zoom.
    const adsTarget = this.adsActive && this.alive ? 1 : 0
    this.adsAmount += (adsTarget - this.adsAmount) * Math.min(1, dt * 12)
    const fov = this.baseFov + (this.adsTargetFov - this.baseFov) * this.adsAmount
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
    this.gunBase.lerpVectors(this.gunHip, this.gunAds, this.adsAmount)

    // Muzzle flash flicker.
    if (this.flashTimer > 0) {
      this.flashTimer -= dt
      this.muzzleFlash.visible = true
      this.muzzleFlash.scale.setScalar(0.6 + Math.random() * 0.5)
      this.muzzleFlash.rotation.z = Math.random() * Math.PI
    } else if (this.muzzleFlash) {
      this.muzzleFlash.visible = false
    }

    this._updateCamera(dt)
  }

  _handleLook() {
    const { dx, dy } = this.input.consumeMouseDelta()
    this.yaw -= dx * this.mouseSensitivity
    this.pitch -= dy * this.mouseSensitivity
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch))
  }

  _handleMove(dt) {
    FORWARD.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))
    RIGHT.set(FORWARD.z, 0, -FORWARD.x)

    let ix = 0, iz = 0
    if (this.alive) {
      if (this.input.isDown('KeyW')) iz -= 1 // forward (basis points behind, so negate)
      if (this.input.isDown('KeyS')) iz += 1
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
    if (this.moving) TMP.normalize()

    this.velocity.x = TMP.x * speed
    this.velocity.z = TMP.z * speed

    if (this.alive && this.onGround && this.input.isDown('Space')) {
      this.velocity.y = this.jumpSpeed
      this.onGround = false
    }
    this.velocity.y += this.gravity * dt

    this.position.x += this.velocity.x * dt
    this.position.y += this.velocity.y * dt
    this.position.z += this.velocity.z * dt

    this._resolvePlatforms()
    this.world.clampToArena(this.position)

    // Jump pads launch you when standing on one.
    if (this.onGround) {
      for (const pad of this.world.jumpPads) {
        if (Math.hypot(this.position.x - pad.x, this.position.z - pad.z) < pad.radius) {
          this.velocity.y = pad.power
          this.onGround = false
          this.onJumpPad?.()
          break
        }
      }
    }
  }

  // AABB collision against world.platforms: block walls horizontally, and let the
  // player stand on top of (and step up onto) low props. Sets onGround.
  _resolvePlatforms() {
    const r = 0.5, h = 1.6, step = 0.5
    const p = this.position

    // Horizontal: push out of any box whose body the player overlaps vertically.
    for (const b of this.world.platforms) {
      const feetY = p.y, headY = p.y + h
      if (headY <= b.bottom + 0.02) continue   // entirely under an elevated platform
      if (feetY >= b.top - step) continue       // on/above top -> don't shove off
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX))
      const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ))
      const ddx = p.x - cx, ddz = p.z - cz
      const d2 = ddx * ddx + ddz * ddz
      if (d2 < r * r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2); const push = (r - d) / d
          p.x += ddx * push; p.z += ddz * push
        } else {
          // Center inside footprint: pop out the nearest face.
          const dl = p.x - b.minX, dr = b.maxX - p.x, dbk = p.z - b.minZ, df = b.maxZ - p.z
          const m = Math.min(dl, dr, dbk, df)
          if (m === dl) p.x = b.minX - r
          else if (m === dr) p.x = b.maxX + r
          else if (m === dbk) p.z = b.minZ - r
          else p.z = b.maxZ + r
        }
      }
    }

    // Vertical: highest support (ground or a platform top) beneath the feet.
    let support = this.world.groundY
    for (const b of this.world.platforms) {
      if (!b.climbable) continue
      if (p.x < b.minX - r || p.x > b.maxX + r) continue
      if (p.z < b.minZ - r || p.z > b.maxZ + r) continue
      if (b.top <= p.y + step && b.top > support) support = b.top
    }
    if (p.y <= support) {
      p.y = support
      if (this.velocity.y < 0) this.velocity.y = 0
      this.onGround = true
    } else {
      this.onGround = false
    }
  }

  _updateCamera(dt) {
    // Eye position with a subtle vertical bob while moving on the ground.
    if (this.moving && this.onGround) this.bobT += dt * (this.sprinting ? 14 : 10)
    const bob = (this.moving && this.onGround) ? Math.sin(this.bobT) * 0.05 : 0

    this.camera.position.set(
      this.position.x,
      this.position.y + this.eyeHeight + bob,
      this.position.z
    )
    // Recoil kicks the view up briefly.
    this.camera.rotation.set(this.pitch + this.recoil, this.yaw, 0)

    // Weapon bob + recoil on the viewmodel.
    if (this.gun) {
      const bx = (this.moving && this.onGround) ? Math.cos(this.bobT) * 0.012 : 0
      const by = (this.moving && this.onGround) ? Math.abs(Math.sin(this.bobT)) * 0.014 : 0
      this.gun.position.set(
        this.gunBase.x + bx,
        this.gunBase.y + by,
        this.gunBase.z + this.recoil * 0.5 // kick toward camera
      )
      this.gun.rotation.x = -this.recoil * 1.2
    }
  }
}
