import * as THREE from 'three'
import { CharacterAnimator, normalizeModel } from './CharacterAnimator.js'

const TMP = new THREE.Vector3()
const MUZZLE = new THREE.Vector3()
const TARGET = new THREE.Vector3()

// An enemy that SHOOTS at range and only punches in close combat. Uses the Toon
// Shooter Game Kit's animated enemy model (no visible capsule placeholder).
export class Enemy {
  constructor({ world, position, hp = 100, speed = 3.5, damage = 8, model = null, fx = null }) {
    this.world = world
    this.fx = fx // shared combat FX (beam/impact) — usually the Weapons instance
    this.maxHp = hp
    this.hp = hp
    this.speed = speed
    this.meleeDamage = damage
    this.shootDamage = Math.max(3, Math.round(damage * 0.6))
    this.alive = true

    this.meleeRange = 2.4
    this.preferredRange = 13 // tries to close to here, then shoots
    this.attackCooldown = 0
    this.attackInterval = 1.1
    this.shootCooldown = 0.6 + Math.random() * 1.2 // desync volleys
    this.shootInterval = 1.4
    this.shootAccuracy = 0.55 // chance a shot connects
    this.targetHeight = 1.8
    this.dying = false
    this.removeTimer = 0

    this.group = new THREE.Group()
    this.group.position.copy(position)

    // Invisible capsule the bullet raycaster tests against (reliable hits
    // regardless of the animated mesh pose). Not a visible character.
    const hitMat = new THREE.MeshBasicMaterial({ visible: false })
    this.hitMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.0, 4, 8), hitMat)
    this.hitMesh.position.y = 1.0
    this.hitMesh.userData.enemy = this
    this.group.add(this.hitMesh)

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
    scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false } })
    normalizeModel(scene, this.targetHeight)
    this.group.add(scene)
    this.model = scene
    if (clips && clips.length) {
      this.animator = new CharacterAnimator(scene, clips)
      this.animator.play('Idle', { fade: 0 })
    }
  }

  // Returns true if this hit killed the enemy.
  takeHit(dmg) {
    if (!this.alive) return false
    this.hp = Math.max(0, this.hp - dmg)
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
    if (this.animator?.has('Death')) this.animator.play('Death', { once: true, fade: 0.1 })
    else this.removeTimer = 0
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
    TMP.normalize()
    this.group.rotation.y = Math.atan2(TMP.x, TMP.z)

    if (dist <= this.meleeRange) {
      // Close combat: punch only.
      this._setClip('Idle')
      this.attackCooldown -= dt
      if (this.attackCooldown <= 0 && player.alive) {
        player.takeDamage(this.meleeDamage)
        this.attackCooldown = this.attackInterval
        if (this.animator?.has('Punch')) this.animator.playOnceThen('Punch', 'Idle')
      }
    } else {
      // Ranged: advance toward preferred range, then shoot.
      const advancing = dist > this.preferredRange
      if (advancing) {
        this.group.position.addScaledVector(TMP, this.speed * dt)
        this._setClip(this.speed > 4 && this.animator?.has('Run_Shoot') ? 'Run_Shoot' : 'Walk')
      } else {
        this._setClip('Idle_Shoot')
      }
      this.shootCooldown -= dt
      if (this.shootCooldown <= 0 && player.alive) {
        this._shoot(player)
        this.shootCooldown = this.shootInterval * (0.8 + Math.random() * 0.5)
      }
    }

    this.world.clampToArena(this.group.position)
    if (camera) {
      this.hpBar.quaternion.copy(camera.quaternion)
      this.hpBarBg.quaternion.copy(camera.quaternion)
    }
    this.animator?.update(dt)
    return false
  }

  _shoot(player) {
    MUZZLE.set(this.group.position.x, this.group.position.y + 1.3, this.group.position.z)
    MUZZLE.addScaledVector(TMP, 0.6) // a little in front of the chest
    TARGET.set(player.position.x, player.position.y + 1.2, player.position.z)
    // Enemy tracer (reddish).
    this.fx?.beam(MUZZLE, TARGET, 0xff6b4a, 0.05)
    this.fx?.flash(MUZZLE, 0xff8a5a)
    if (Math.random() < this.shootAccuracy) {
      player.takeDamage(this.shootDamage)
    }
    if (this.animator?.has('Idle_Shoot') && !this._isRunShooting()) {
      // a brief shoot pose pulse if currently idle
    }
  }

  _isRunShooting() {
    return this.animator?.current === this.animator?.actions['Run_Shoot']
  }

  _setClip(name) {
    if (!this.animator) return
    const cur = this.animator.current
    if (cur && cur.loop === THREE.LoopOnce && cur.isRunning()) return
    const pick = this.animator.has(name) ? name : 'Idle'
    this.animator.play(pick, { fade: 0.18 })
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
