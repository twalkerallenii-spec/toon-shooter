import * as THREE from 'three'
import { CharacterAnimator, normalizeModel } from './CharacterAnimator.js'

const TMP = new THREE.Vector3()
const MUZZLE = new THREE.Vector3()
const TARGET = new THREE.Vector3()
const DIR = new THREE.Vector3()
const RAY = new THREE.Raycaster()

// A CPU player: wanders the map, hunts the nearest living combatant (other bots
// or the human), and shoots when it has line of sight. Free-for-all by default;
// respects teams when given one. Shootable by the player (Enemy-like interface).
export class Bot {
  constructor({ world, assets, fx, name, team = null, position, role = 'fighter', hp = 100, scale = 1, char = 'models/characters/Character_Soldier.gltf' }) {
    this.world = world
    this.fx = fx
    this.name = name
    this.team = team
    this.role = role // 'fighter' | 'hider' | 'zombie' (melee chaser)
    this.maxHp = hp
    this.hp = hp
    this._scale = scale
    this.alive = true
    this.kills = 0
    this.dying = false
    this.removeTimer = 0
    this.speed = 6 + Math.random() * 2
    this.shootRange = 30
    this.viewRange = 70
    this.damage = 8
    this.accuracy = 0.28 // CPUs miss more (less laser-accurate)
    this.shootCd = Math.random() * 1.5
    this.shootInterval = 1.15
    this._wall = 0
    this._wander = new THREE.Vector3(position.x, 0, position.z)
    this._wanderCd = 0
    this.objective = null // CTF: a {x,z} to advance toward when not fighting
    this.forceGoal = null // CTF: a {x,z} to run to directly (carrying a flag)
    this.carrying = null  // CTF: flag color this bot is carrying

    this.group = new THREE.Group()
    this.group.position.copy(position)
    if (scale !== 1) this.group.scale.setScalar(scale) // e.g. juggernaut

    // Invisible capsule the player's bullets test against.
    this.hitMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.5, 1.0, 4, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    )
    this.hitMesh.position.y = 1.0
    this.hitMesh.userData.enemy = this
    this.group.add(this.hitMesh)

    this.tag = makeTag(name, team)
    this.tag.position.set(0, 2.5, 0)
    this.group.add(this.tag)

    world.scene.add(this.group)

    this.ready = assets.loadModel(char).then((m) => {
      if (!m || this.dying) return
      m.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = true } })
      normalizeModel(m.scene, 1.8)
      this.group.add(m.scene)
      if (m.animations?.length) {
        this.animator = new CharacterAnimator(m.scene, m.animations)
        this.animator.play('Idle', { fade: 0 })
      }
    })
  }

  // Combatant interface — same shape as the player (so bots target each other).
  get position() { return this.group.position }

  // Hit by a bullet. Returns true if this killed it. (Enemy-like for Weapons.)
  takeHit(dmg, attacker) {
    if (!this.alive) return false
    this.hp = Math.max(0, this.hp - dmg)
    if (this.hp <= 0) { this._die(attacker); return true }
    return false
  }

  applyDamage(dmg, attacker) { return this.takeHit(dmg, attacker) }

  _die(attacker) {
    this.alive = false
    this.dying = true
    this.removeTimer = 2.0
    this.tag.visible = false
    this.onDeath?.(this, attacker)
    if (!this.dying) return // onDeath revived us (e.g. infected into a zombie)
    if (this.animator?.has('Death')) this.animator.play('Death', { once: true, fade: 0.1 })
  }

  // ctx = { combatants: [...], camera }. Returns true when fully gone.
  update(dt, ctx) {
    if (this.dying) { this.animator?.update(dt); this.removeTimer -= dt; if (this.removeTimer <= 0) { this.dispose(); return true } return false }
    if (!this.alive) return true

    // HIDER role: flee from the seeker, never shoot.
    if (this.role === 'hider') {
      const p2 = this.group.position
      const seeker = ctx.seeker
      let moving = false
      const d = seeker ? Math.hypot(seeker.position.x - p2.x, seeker.position.z - p2.z) : 999
      if (seeker && d < 38) {
        TMP.set(p2.x - seeker.position.x, 0, p2.z - seeker.position.z).normalize()
        this.group.rotation.y = Math.atan2(TMP.x, TMP.z) + Math.PI
        p2.addScaledVector(TMP, this.speed * 1.15 * dt); moving = true
      } else {
        this._wanderCd -= dt
        if (this._wanderCd <= 0 || this._wander.distanceToSquared(p2) < 9) {
          const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * 28
          this._wander.set(p2.x + Math.cos(a) * r, 0, p2.z + Math.sin(a) * r)
          this._wanderCd = 2 + Math.random() * 3
        }
        TMP.subVectors(this._wander, p2); TMP.y = 0
        if (TMP.lengthSq() > 1) { TMP.normalize(); this.group.rotation.y = Math.atan2(TMP.x, TMP.z) + Math.PI; p2.addScaledVector(TMP, this.speed * 0.5 * dt); moving = true }
      }
      this._wall -= dt
      if (this.world.cityCollider) {
        if (this._wall <= 0) { this.world.cityCollider.pushOut(p2, 0.6, 1.0); this._wall = 0.15 }
        const gy = this.world.cityCollider.groundY(p2.x, p2.z, p2.y + 3)
        p2.y = gy != null && gy >= 0 ? gy : 0
      }
      this.world.clampToArena(p2)
      if (this.animator) { this.animator.play(moving ? 'Run' : 'Idle', { fade: 0.2 }); this.animator.update(dt) }
      if (ctx.camera) this.tag.quaternion.copy(ctx.camera.quaternion)
      return false
    }

    // ZOMBIE role: chase the nearest combatant and melee on contact, no guns.
    if (this.role === 'zombie') {
      const p3 = this.group.position
      let tgt = null, bd = 200
      for (const c of ctx.combatants) {
        if (c === this || !c.alive) continue
        if (c.role === 'zombie' || c.isZombie) continue // zombies only hunt humans
        const d = Math.hypot(c.position.x - p3.x, c.position.z - p3.z)
        if (d < bd) { bd = d; tgt = c }
      }
      let moving = false
      if (tgt) {
        TMP.subVectors(tgt.position, p3); TMP.y = 0; const dist = TMP.length(); TMP.normalize()
        this.group.rotation.y = Math.atan2(TMP.x, TMP.z) + Math.PI
        if (dist > 1.9) { p3.addScaledVector(TMP, this.speed * 1.35 * dt); moving = true }
        else { this.shootCd -= dt; if (this.shootCd <= 0) { this.shootCd = 0.9; tgt.applyDamage?.(11, this); this.animator?.playOnceThen?.('Punch', 'Idle') } }
      }
      if (this.world.cityCollider) { const gy = this.world.cityCollider.groundY(p3.x, p3.z, p3.y + 3); p3.y = gy != null && gy >= 0 ? gy : 0 }
      this.world.clampToArena(p3)
      if (this.animator) { if (moving) this.animator.play('Run', { fade: 0.2 }); this.animator.update(dt) }
      if (ctx.camera) this.tag.quaternion.copy(ctx.camera.quaternion)
      return false
    }

    // CTF carrier: commit to running the flag to the goal, ignore combat.
    if (this.forceGoal) {
      const pc = this.group.position
      TMP.set(this.forceGoal.x - pc.x, 0, this.forceGoal.z - pc.z)
      let mv = false
      if (TMP.lengthSq() > 0.5) { TMP.normalize(); this.group.rotation.y = Math.atan2(TMP.x, TMP.z) + Math.PI; pc.addScaledVector(TMP, this.speed * 1.05 * dt); mv = true }
      this._wall -= dt
      if (this.world.cityCollider) {
        if (this._wall <= 0) { this.world.cityCollider.pushOut(pc, 0.6, 1.0); this._wall = 0.15 }
        const gy = this.world.cityCollider.groundY(pc.x, pc.z, pc.y + 3); pc.y = gy != null && gy >= 0 ? gy : 0
      }
      this.world.clampToArena(pc)
      if (this.animator) { this.animator.play(mv ? 'Run' : 'Idle', { fade: 0.2 }); this.animator.update(dt) }
      if (ctx.camera) this.tag.quaternion.copy(ctx.camera.quaternion)
      return false
    }

    // Acquire nearest valid target.
    let target = null, bestD = this.viewRange
    for (const c of ctx.combatants) {
      if (c === this || !c.alive) continue
      if (this.team && c.team && c.team === this.team) continue // same team
      const cp = c.position
      const d = Math.hypot(cp.x - this.group.position.x, cp.z - this.group.position.z)
      if (d < bestD) { bestD = d; target = c }
    }

    const p = this.group.position
    let moving = false
    if (target) {
      TMP.subVectors(target.position, p); TMP.y = 0
      const dist = TMP.length(); TMP.normalize()
      this.group.rotation.y = Math.atan2(TMP.x, TMP.z) + Math.PI
      if (dist > this.shootRange * 0.8) {
        p.addScaledVector(TMP, this.speed * dt); moving = true // close in
      } else {
        // In range: strafe sideways + keep spacing so they never stand still.
        const side = (Math.floor(this._t || 0) % 2 === 0) ? 1 : -1
        p.x += TMP.z * side * this.speed * 0.6 * dt
        p.z += -TMP.x * side * this.speed * 0.6 * dt
        if (dist < this.shootRange * 0.45) p.addScaledVector(TMP, -this.speed * 0.5 * dt) // back off
        moving = true
      }
      this._t = (this._t || 0) + dt * 0.4
      this.shootCd -= dt
      if (this.shootCd <= 0 && dist < this.shootRange) {
        this.shootCd = this.shootInterval * (0.7 + Math.random() * 0.8)
        this._shoot(target)
      }
    } else if (this.objective) {
      // CTF: advance toward the assigned objective (a flag/base) when not fighting.
      TMP.set(this.objective.x - p.x, 0, this.objective.z - p.z)
      if (TMP.lengthSq() > 1) { TMP.normalize(); this.group.rotation.y = Math.atan2(TMP.x, TMP.z) + Math.PI; p.addScaledVector(TMP, this.speed * 0.85 * dt); moving = true }
    } else {
      // Wander.
      this._wanderCd -= dt
      if (this._wanderCd <= 0 || this._wander.distanceToSquared(p) < 9) {
        const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 40
        this._wander.set(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r)
        this._wanderCd = 3 + Math.random() * 3
      }
      TMP.subVectors(this._wander, p); TMP.y = 0; TMP.normalize()
      this.group.rotation.y = Math.atan2(TMP.x, TMP.z) + Math.PI
      p.addScaledVector(TMP, this.speed * 0.6 * dt); moving = true
    }

    // City collision (throttled wall push-out) + ground follow.
    this._wall -= dt
    if (this.world.cityCollider) {
      if (this._wall <= 0) { this.world.cityCollider.pushOut(p, 0.6, 1.0); this._wall = 0.15 }
      const gy = this.world.cityCollider.groundY(p.x, p.z, p.y + 3)
      p.y = gy != null && gy >= 0 ? gy : 0
    }
    this.world.clampToArena(p)

    if (this.animator) {
      this.animator.play(moving ? 'Run' : 'Idle', { fade: 0.2 })
      this.animator.update(dt)
    }
    if (ctx.camera) this.tag.quaternion.copy(ctx.camera.quaternion)
    return false
  }

  _shoot(target) {
    MUZZLE.set(this.group.position.x, this.group.position.y + 1.4, this.group.position.z)
    TARGET.set(target.position.x, target.position.y + 1.2, target.position.z)
    DIR.subVectors(TARGET, MUZZLE); const dist = DIR.length(); DIR.normalize()
    // Line of sight against the solid world.
    if (this.world.obstacles.length) {
      RAY.set(MUZZLE, DIR); RAY.far = dist
      const meshes = this.world.obstacles.map((o) => o.mesh)
      const hits = RAY.intersectObjects(meshes, true)
      if (hits.length && hits[0].distance < dist - 1) { this.fx?.beam(MUZZLE, hits[0].point, 0xffd24a, 0.05); return }
    }
    this.fx?.beam(MUZZLE, TARGET, 0xffe08a, 0.05)
    this.fx?.flash(MUZZLE, 0xffd24a)
    if (Math.random() < this.accuracy) target.applyDamage?.(this.damage, this)
  }

  dispose() {
    this.world.scene.remove(this.group)
    this.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.() })
  }
}

function makeTag(text, team) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64
  const ctx = cv.getContext('2d')
  ctx.font = 'bold 30px Trebuchet MS, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(text, 128, 32)
  ctx.fillStyle = team === 'red' ? '#ff8080' : team === 'blue' ? '#88b4ff' : '#ffd24a'
  ctx.fillText(text, 128, 32)
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }))
  m.renderOrder = 1000
  return m
}
