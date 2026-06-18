import * as THREE from 'three'

const TMP = new THREE.Vector3()

// A simple chasing enemy: walks toward the player, attacks when in range.
// Placeholder is a colored capsule with a health bar billboard; swap in a GLTF
// model with setModel().
export class Enemy {
  constructor({ world, position, hp = 100, speed = 3.5, damage = 8 }) {
    this.world = world
    this.maxHp = hp
    this.hp = hp
    this.speed = speed
    this.damage = damage
    this.alive = true
    this.attackRange = 2.2
    this.attackCooldown = 0
    this.attackInterval = 1.0

    this.group = new THREE.Group()
    this.group.position.copy(position)

    const mat = new THREE.MeshStandardMaterial({ color: 0xe74c3c, roughness: 0.6 })
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.0, 6, 12), mat)
    body.position.y = 1.0
    body.castShadow = true
    this.group.add(body)
    this.material = mat
    // hitMesh is what the raycaster tests against.
    this.hitMesh = body
    this.hitMesh.userData.enemy = this

    // Health bar (billboard quad above the head).
    this.hpBarBg = makeBar(0x000000, 1)
    this.hpBarBg.position.set(0, 2.3, 0)
    this.hpBar = makeBar(0x4ade80, 1)
    this.hpBar.position.set(0, 2.3, 0.001)
    this.group.add(this.hpBarBg, this.hpBar)

    world.scene.add(this.group)
  }

  setModel(modelScene) {
    if (!modelScene) return
    this.group.remove(this.hitMesh)
    modelScene.traverse((o) => { if (o.isMesh) o.castShadow = true })
    this.group.add(modelScene)
    // Keep an invisible capsule as the raycast target for reliable hits.
    this.hitMesh.visible = false
    this.group.add(this.hitMesh)
  }

  // Returns true if this hit killed the enemy.
  takeHit(dmg) {
    if (!this.alive) return false
    this.hp = Math.max(0, this.hp - dmg)
    // Flash white briefly.
    this.material.emissive = new THREE.Color(0xffffff)
    this.material.emissiveIntensity = 0.8
    this._flash = 0.08
    const ratio = this.hp / this.maxHp
    this.hpBar.scale.x = Math.max(0.001, ratio)
    this.hpBar.position.x = -(1 - ratio) * 0.5
    if (this.hp <= 0) {
      this.alive = false
      return true
    }
    return false
  }

  update(dt, player, camera) {
    if (!this.alive) return

    // Move toward player on the ground plane.
    TMP.subVectors(player.position, this.group.position)
    TMP.y = 0
    const dist = TMP.length()
    if (dist > this.attackRange) {
      TMP.normalize()
      this.group.position.addScaledVector(TMP, this.speed * dt)
      this.group.rotation.y = Math.atan2(TMP.x, TMP.z)
    } else {
      // In range: attack on cooldown.
      this.attackCooldown -= dt
      if (this.attackCooldown <= 0 && player.alive) {
        player.takeDamage(this.damage)
        this.attackCooldown = this.attackInterval
      }
    }

    // Separate from other enemies a little is handled by Spawner; keep in arena.
    this.world.clampToArena(this.group.position)

    // Flash decay.
    if (this._flash > 0) {
      this._flash -= dt
      if (this._flash <= 0) this.material.emissiveIntensity = 0
    }

    // Billboard the health bars toward the camera.
    if (camera) {
      this.hpBar.quaternion.copy(camera.quaternion)
      this.hpBarBg.quaternion.copy(camera.quaternion)
    }
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
