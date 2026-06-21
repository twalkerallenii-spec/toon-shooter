import * as THREE from 'three'
import { CharacterAnimator, normalizeModel } from './CharacterAnimator.js'
import { skinOf, applyTint } from '../core/skins.js'

// A networked other-player avatar: the animated kit character with a name tag and
// HP bar, smoothly interpolated toward the latest networked state.
export class RemotePlayer {
  constructor({ world, assets, name, id, fx = null }) {
    this.world = world
    this.assets = assets
    this.fx = fx
    this.name = name
    this.id = id
    this.skin = null
    this._skinLoading = null
    this.group = new THREE.Group()
    this.targetHeight = 1.8

    this.target = new THREE.Vector3()
    this.targetYaw = 0
    this.moving = false
    this.hp = 100

    // Drop-in: new players skydive down from above with a landing puff.
    this.dropOffset = 16
    this.landed = false
    this._gotState = false

    // Invisible capsule used for PvP bullet raycasts.
    this.hitMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.5, 1.0, 4, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    )
    this.hitMesh.position.y = 1.0
    this.hitMesh.userData.remote = this

    this.nameTag = makeNameTag(name)
    this.nameTag.position.set(0, 2.6, 0)
    this.group.add(this.nameTag)
    this.hpBarBg = makeBar(0x000000)
    this.hpBarBg.position.set(0, 2.3, 0)
    this.hpBar = makeBar(0x6ad36a)
    this.hpBar.position.set(0, 2.3, 0.001)
    this.group.add(this.hpBarBg, this.hpBar)

    this.modelPivot = new THREE.Group()
    this.group.add(this.modelPivot)
    this.group.add(this.hitMesh)

    // Team marker ring at the feet (hidden until a team is set).
    this.teamRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.7, 0.08, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    )
    this.teamRing.rotation.x = Math.PI / 2
    this.teamRing.position.y = 0.06
    this.teamRing.visible = false
    this.group.add(this.teamRing)

    world.scene.add(this.group)

    this.setSkin('Character_Soldier')
  }

  // Load (or swap to) the given Locker skin: base model + tint.
  setSkin(id) {
    if (this.skin === id || this._skinLoading === id) return
    this._skinLoading = id
    const skin = skinOf(id)
    this.assets.loadModel(`models/characters/${skin.base}.gltf`).then((m) => {
      if (!m || this._skinLoading !== id) return
      this.skin = id; this._skinLoading = null
      applyTint(m.scene, skin.tint)
      m.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false } })
      normalizeModel(m.scene, this.targetHeight)
      // Remove any previous model.
      for (let i = this.modelPivot.children.length - 1; i >= 0; i--) {
        const c = this.modelPivot.children[i]
        this.modelPivot.remove(c); c.traverse?.((o) => { o.geometry?.dispose?.() })
      }
      this.modelPivot.add(m.scene)
      if (m.animations?.length) {
        this.animator = new CharacterAnimator(m.scene, m.animations)
        this.animator.play(this.moving ? 'Run' : 'Idle', { fade: 0 })
      } else {
        this.animator = null
      }
    })
  }

  // Show a team color ring: green if ally, red if enemy (null hides it).
  setTeamColor(relation) {
    if (!relation) { this.teamRing.visible = false; return }
    this.teamRing.visible = true
    this.teamRing.material.color.set(relation === 'ally' ? 0x4ade80 : 0xff5555)
  }

  setState(p) {
    if (!p) return
    if (p.skin && p.skin !== this.skin) this.setSkin(p.skin)
    this.target.set(p.x, p.y, p.z)
    // First state: snap above the real spot so the drop-in starts there, not at origin.
    if (!this._gotState) {
      this._gotState = true
      this.group.position.set(p.x, p.y + this.dropOffset, p.z)
    }
    this.targetYaw = p.yaw ?? 0
    this.moving = !!p.moving
    if (typeof p.hp === 'number') {
      this.hp = p.hp
      const k = Math.max(0, this.hp / 100)
      this.hpBar.scale.x = Math.max(0.001, k)
      this.hpBar.position.x = -(1 - k) * 0.5
    }
  }

  update(dt, camera) {
    const k = Math.min(1, dt * 12)
    // Horizontal chase toward the networked target.
    this.group.position.x += (this.target.x - this.group.position.x) * k
    this.group.position.z += (this.target.z - this.group.position.z) * k

    // Vertical: descend the drop-in offset, then follow the target height.
    let dropping = false
    if (this.dropOffset > 0.02) {
      dropping = true
      this.dropOffset = Math.max(0, this.dropOffset - dt * 22)
      this.group.position.y = this.target.y + this.dropOffset
      if (this.dropOffset <= 0.02 && !this.landed) {
        this.landed = true
        this.fx?.emit(this.group.position, 24, { color: [0.7, 0.65, 0.5], speed: 6, size: 1.4, life: 0.5, gravity: -3, up: 2 })
      }
    } else {
      this.group.position.y += (this.target.y - this.group.position.y) * k
    }

    this.modelPivot.rotation.y = lerpAngle(this.modelPivot.rotation.y, this.targetYaw, k)

    if (this.animator) {
      const clip = dropping ? (this.animator.has('Jump_Idle') ? 'Jump_Idle' : 'Jump')
        : (this.moving ? 'Run' : 'Idle')
      this.animator.play(clip, { fade: 0.18 })
      this.animator.update(dt)
    }
    if (camera) {
      this.nameTag.quaternion.copy(camera.quaternion)
      this.hpBar.quaternion.copy(camera.quaternion)
      this.hpBarBg.quaternion.copy(camera.quaternion)
    }
  }

  dispose() {
    this.world.scene.remove(this.group)
    this.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.() })
  }
}

function makeBar(color) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 0.12),
    new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true })
  )
  m.renderOrder = 999
  return m
}

function makeNameTag(text) {
  const cv = document.createElement('canvas')
  cv.width = 256; cv.height = 64
  const ctx = cv.getContext('2d')
  ctx.font = 'bold 36px Trebuchet MS, sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.85)'
  ctx.strokeText(text, 128, 32)
  ctx.fillStyle = '#fff'
  ctx.fillText(text, 128, 32)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false })
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), mat)
  m.renderOrder = 1000
  return m
}

function lerpAngle(a, b, t) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}
