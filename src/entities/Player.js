import * as THREE from 'three'
import { CharacterAnimator, normalizeModel } from './CharacterAnimator.js'

const TMP = new THREE.Vector3()
const TMP2 = new THREE.Vector3()
const FORWARD = new THREE.Vector3()
const RIGHT = new THREE.Vector3()
const EUL = new THREE.Euler(0, 0, 0, 'YXZ')

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
    this.team = null // set by Game in team modes; used by bot targeting

    // Movement tuning
    this.walkSpeed = 7
    this.sprintSpeed = 12
    this.jumpSpeed = 9.5 // enough to hop onto crates/sandbags
    this.gravity = -22
    this.mouseSensitivity = 0.0022
    this.invertY = false

    // View feel
    this.moving = false
    this.sprinting = false
    this.bobT = 0
    this.recoil = 0
    this.shootingTimer = 0
    this._spacePrev = false
    this._vaultCd = 0

    // Grapple / zipline
    this.grappling = false
    this.grappleTarget = new THREE.Vector3()
    this.grappleTime = 0
    this.grappleSpeed = 60

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

  setModel() {} // kept for API compatibility

  setThirdPerson(on) { this.thirdPerson = on }

  // Load a body model (shown only in third-person).
  setBody(scene, clips) {
    if (this.body) { this.modelPivot.remove(this.body) }
    scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false } })
    normalizeModel(scene, 1.8)
    this.modelPivot.add(scene)
    this.body = scene
    this.body.visible = !!this.thirdPerson
    if (clips && clips.length) { this.bodyAnimator = new CharacterAnimator(scene, clips); this.bodyAnimator.play('Idle', { fade: 0 }) }
  }

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

  // Combatant interface (so bots can damage + attribute kills to the player).
  applyDamage(amount, attacker) {
    this._lastAttacker = attacker || this._lastAttacker
    this.takeDamage(amount)
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

    // Third-person body: show it, hide the viewmodel, face the look dir, animate.
    if (this.body) this.body.visible = !!this.thirdPerson
    if (this.gun) this.gun.visible = !this.thirdPerson
    if (this.thirdPerson && this.bodyAnimator) {
      this.modelPivot.rotation.y = this.yaw
      this.bodyAnimator.play(this.alive ? (this.moving ? 'Run' : 'Idle') : 'Death', { fade: 0.18 })
      this.bodyAnimator.update(dt)
    }

    this._updateCamera(dt)
  }

  _handleLook() {
    const { dx, dy } = this.input.consumeMouseDelta()
    this.yaw -= dx * this.mouseSensitivity
    this.pitch += (this.invertY ? dy : -dy) * this.mouseSensitivity
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch))
  }

  // Fire a grapple toward a world point — zip there fast.
  startGrapple(point) {
    this.grappleTarget.copy(point)
    this.grappling = true
    this.grappleTime = 1.4
  }

  _grappleMove(dt) {
    TMP.subVectors(this.grappleTarget, this.position)
    const d = TMP.length()
    this.grappleTime -= dt
    // Arrive, time out, or cancel with jump.
    if (d < 2.6 || this.grappleTime <= 0 || this.input.isDown('Space')) {
      this.grappling = false
      this.velocity.set(0, this.input.isDown('Space') ? this.jumpSpeed * 0.7 : 0, 0)
      return
    }
    TMP.normalize()
    this.position.addScaledVector(TMP, this.grappleSpeed * dt)
    this.velocity.set(0, 0, 0)
    this.onGround = false
    this.moving = true; this.sprinting = false
    this.world.clampToArena(this.position)
  }

  _handleMove(dt) {
    if (this.grappling) { this._grappleMove(dt); return }
    FORWARD.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))
    RIGHT.set(FORWARD.z, 0, -FORWARD.x)

    let ix = 0, iz = 0
    if (this.alive) {
      if (this.input.isDown('KeyW')) iz -= 1 // forward (basis points behind, so negate)
      if (this.input.isDown('KeyS')) iz += 1
      if (this.input.isDown('KeyD')) ix += 1
      if (this.input.isDown('KeyA')) ix -= 1
      // Touch move-stick (analog): forward maps to -iz, right to +ix.
      const tm = this.input.touchMove
      if (tm.x || tm.y) { ix += tm.x; iz -= tm.y }
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

    // Jump / vault on Space. A fresh press near a ledge vaults onto it; otherwise
    // it's a normal ground jump.
    const spaceDown = this.input.isDown('Space')
    const spacePressed = spaceDown && !this._spacePrev
    this._spacePrev = spaceDown
    if (this._vaultCd > 0) this._vaultCd -= dt

    if (this.alive && spacePressed && this._vaultCd <= 0 && this._tryVault()) {
      // handled by vault
    } else if (this.alive && this.onGround && spaceDown) {
      this.velocity.y = this.jumpSpeed
      this.onGround = false
    }
    this.velocity.y += this.gravity * dt

    this.position.x += this.velocity.x * dt
    this.position.y += this.velocity.y * dt
    this.position.z += this.velocity.z * dt

    if (this.world.cityCollider) this._resolveCity()
    else this._resolvePlatforms()
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

  // Movement collision against a solid city mesh: push out of walls, stand on
  // streets/rooftops via a downward ray.
  _resolveCity() {
    const c = this.world.cityCollider
    const p = this.position
    // Walls at two body heights so curbs and tall walls both block.
    c.pushOut(p, 0.6, 1.2)
    c.pushOut(p, 0.6, 0.4)
    // Ground: the flat plane (world.groundY) is always a hard floor so you can
    // never fall through the world. City surfaces above it are used only when
    // they're within step range (stairs/curbs/rooftops you're actually on).
    const gy = c.groundY(p.x, p.z, p.y + 3)
    let support = this.world.groundY
    if (gy != null && gy > support && gy <= p.y + 0.6) support = gy
    if (p.y <= support) {
      p.y = support
      if (this.velocity.y < 0) this.velocity.y = 0
      this.onGround = true
    } else {
      this.onGround = false
    }
  }

  // Climb/vault: if a low-enough ledge is right in front of the player, hop on
  // top of it. Returns true if it vaulted.
  _tryVault() {
    // Climb onto whatever you're standing next to — large reach so it works on
    // essentially any object (crates, containers, buildings, stacks).
    const r = 0.5, mantleMax = 12
    const p = this.position
    let best = null
    for (const b of this.world.platforms) {
      if (!b.climbable) continue
      const rise = b.top - p.y
      if (rise < 0.4 || rise > mantleMax) continue // too low (just step) or too tall
      // Horizontal proximity to the box footprint.
      const cx = Math.max(b.minX, Math.min(p.x, b.maxX))
      const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ))
      const d = Math.hypot(p.x - cx, p.z - cz)
      if (d > r + 0.7) continue
      // Prefer the LOWEST climbable ledge so you climb one step at a time.
      if (!best || b.top < best.top) best = b
    }
    if (!best) return false
    // Place the player on top, just inside the ledge.
    p.x = Math.max(best.minX + 0.3, Math.min(p.x, best.maxX - 0.3))
    p.z = Math.max(best.minZ + 0.3, Math.min(p.z, best.maxZ - 0.3))
    p.y = best.top + 0.02
    this.velocity.y = 0
    this.onGround = true
    this._vaultCd = 0.35
    return true
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
    // Third-person: chase camera behind the player, looking forward.
    if (this.thirdPerson) {
      EUL.set(this.pitch + this.recoil, this.yaw, 0)
      const fwd = TMP.set(0, 0, -1).applyEuler(EUL)
      const eyeX = this.position.x, eyeY = this.position.y + this.eyeHeight, eyeZ = this.position.z
      this.camera.position.set(eyeX - fwd.x * 6, eyeY + 1.6 - fwd.y * 6, eyeZ - fwd.z * 6)
      this.camera.lookAt(eyeX + fwd.x * 12, eyeY + fwd.y * 12, eyeZ + fwd.z * 12)
      return
    }

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
