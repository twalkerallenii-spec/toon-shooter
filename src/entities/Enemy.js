import * as THREE from 'three'
import { CharacterAnimator, normalizeModel } from './CharacterAnimator.js'

const TMP = new THREE.Vector3()

// A chasing enemy: walks toward the player and attacks in range. Uses the Toon
// Shooter Game Kit's animated enemy model when provided, with a placeholder
// capsule + health bar otherwise.
export class Enemy {
  constructor({ world, position, hp = 100, speed = 3.5, damage = 8, model = null }) {
    this.world = world
    this.maxHp = hp
    this.hp = hp
    this.speed = speed
    this.damage = damage
    this.alive = true
    this.attackRange = 2.2
    this.attackCooldown = 0
    this.attackInterval = 1.2
    this.targetHeight = 1.8
    this.dying = false
    this.removeTimer = 0

    this.group = new THREE.Group()
    this.group.position.copy(position)

    // Invisible capsule that the bullet raycaster always tests against (reliable
    // hits regardless of the animated mesh's current pose).
    const hitMat = new THREE.MeshBasicMaterial({ visible: false })
    this.hitMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.0, 4, 8), hitMat)
    this.hitMesh.position.y = 1.0
    this.hitMesh.userData.enemy = this
    this.group.add(this.hitMesh)

    // Placeholder visual (replaced by model).
    const mat = new THREE.MeshStandardMaterial({ color: 0xe74c3c, roughness: 0.6 })
    this.placeholder = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.0, 6, 12), mat)
    this.placeholder.position.y = 1.0
    this.placeholder.castShadow = true
    this.group.add(this.placeholder)
    this.flashMat = mat

    // Health bar (billboard).
    this.hpBarBg = makeBar(0x000000, 1)
    this.hpBarBg.position.set(0, 2.3, 0)
    this.hpBar = makeBar(0x4ade80, 1)
    this.hpBar.position.set(0, 2.3, 0.001)
    this.group.add(this.hpBarBg, this.hpBar)

    if (model) this.setModel(model.scene, model.animations)

    world.scene.add(this.group)
  }

  setModel(scene, clips) {
    if (!scene) return
    this.group.remove(this.placeholder)
    scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false } })
    normalizeModel(scene, this.targetHeight)
    this.group.add(scene)
    this.model = scene
    this.flashMat = null

    if (clips && clips.length) {
      this.animator = new CharacterAnimator(scene, clips)
      this.animator.play('Idle', { fade: 0 })
    }
  }

  // Returns true if this hit killed the enemy.
  takeHit(dmg) {
    if (!this.alive) return false
    this.hp = Math.max(0, this.hp - dmg)

    if (this.flashMat) {
      this.flashMat.emissive = new THREE.Color(0xffffff)
      this.flashMat.emissiveIntensity = 0.8
      this._flash = 0.08
    }
    const ratio = this.hp / this.maxHp
    this.hpBar.scale.x = Math.max(0.001, ratio)
    this.hpBar.position.x = -(1 - ratio) * 0.5

    if (this.hp <= 0) {
      this._die()
      return true
    }
    this.animator?.playOnceThen('HitReact', 'Idle')
    return false
  }

  _die() {
    this.alive = false
    this.dying = true
    this.removeTimer = 1.6
    this.hpBar.visible = false
    this.hpBarBg.visible = false
    if (this.animator?.has('Death')) {
      this.animator.play('Death', { once: true, fade: 0.1 })
    } else {
      this.removeTimer = 0 // no death anim -> remove immediately
    }
  }

  // Returns true when fully finished (ready to be removed by the spawner).
  update(dt, player, camera) {
    if (this.dying) {
      this.animator?.update(dt)
      this.removeTimer -= dt
      return this.removeTimer <= 0
    }
    if (!this.alive) return true

    TMP.subVectors(player.position, this.group.position)
    TMP.y = 0
    const dist = TMP.length()

    if (dist > this.attackRange) {
      TMP.normalize()
      this.group.position.addScaledVector(TMP, this.speed * dt)
      this.group.rotation.y = Math.atan2(TMP.x, TMP.z)
      this._setClip(this.speed > 4 && this.animator?.has('Run') ? 'Run' : 'Walk')
      this.attacking = false
    } else {
      // Face the player and attack on cooldown.
      this.group.rotation.y = Math.atan2(TMP.x, TMP.z)
      this.attackCooldown -= dt
      this._setClip('Idle')
      if (this.attackCooldown <= 0 && player.alive) {
        player.takeDamage(this.damage)
        this.attackCooldown = this.attackInterval
        if (this.animator?.has('Punch')) this.animator.playOnceThen('Punch', 'Idle')
      }
    }

    this.world.clampToArena(this.group.position)

    if (this._flash > 0) {
      this._flash -= dt
      if (this._flash <= 0 && this.flashMat) this.flashMat.emissiveIntensity = 0
    }

    if (camera) {
      this.hpBar.quaternion.copy(camera.quaternion)
      this.hpBarBg.quaternion.copy(camera.quaternion)
    }

    this.animator?.update(dt)
    return false
  }

  _setClip(name) {
    if (!this.animator) return
    // Don't stomp a one-shot (punch/hitreact) that is currently playing once.
    const cur = this.animator.current
    if (cur && cur.loop === THREE.LoopOnce && cur.isRunning()) return
    if (this.animator.has(name)) this.animator.play(name, { fade: 0.18 })
  }

  dispose() {
    this.world.scene.remove(this.group)
    this.group.traverse((o) => {
      o.geometry?.dispose?.()
      o.material?.dispose?.()
    })
  }
}

function makeBar(color, w) {
  const geo = new THREE.PlaneGeometry(w, 0.12)
  const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true })
  const m = new THREE.Mesh(geo, mat)
  m.renderOrder = 999
  return m
}
