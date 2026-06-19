import * as THREE from 'three'
import { CharacterAnimator, normalizeModel } from './CharacterAnimator.js'

// A networked other-player avatar: the animated soldier model with a name tag and
// HP bar, smoothly interpolated toward the latest networked state.
export class RemotePlayer {
  constructor({ world, assets, name, id }) {
    this.world = world
    this.name = name
    this.id = id
    this.group = new THREE.Group()
    this.targetHeight = 1.8

    this.target = new THREE.Vector3()
    this.targetYaw = 0
    this.moving = false
    this.hp = 100

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
    world.scene.add(this.group)

    assets.loadModel('models/characters/Character_Soldier.gltf').then((m) => {
      if (!m) return
      m.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false } })
      normalizeModel(m.scene, this.targetHeight)
      this.modelPivot.add(m.scene)
      if (m.animations?.length) {
        this.animator = new CharacterAnimator(m.scene, m.animations)
        this.animator.play('Idle', { fade: 0 })
      }
    })
  }

  setState(p) {
    if (!p) return
    this.target.set(p.x, p.y, p.z)
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
    // Smoothly chase the networked target.
    this.group.position.lerp(this.target, Math.min(1, dt * 12))
    this.modelPivot.rotation.y = lerpAngle(this.modelPivot.rotation.y, this.targetYaw, Math.min(1, dt * 12))

    if (this.animator) {
      this.animator.play(this.moving ? 'Run' : 'Idle', { fade: 0.18 })
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
