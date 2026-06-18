import * as THREE from 'three'

// Hitscan shooting + lightweight visual effects (tracers, muzzle flash, impact
// sparks). Keeps short-lived effect meshes in a list and fades them each frame.
export class Weapons {
  constructor({ world }) {
    this.world = world
    this.scene = world.scene
    this.raycaster = new THREE.Raycaster()
    this.effects = [] // { mesh, life, maxLife, fade }

    // Weapon config
    this.damage = 34
    this.fireRate = 9          // shots per second
    this.magazine = 12
    this.ammo = this.magazine
    this.reloadTime = 1.2
    this.spread = 0.012        // radians of random cone
    this.range = 200

    this._cooldown = 0
    this._reloading = 0

    this.onFire = null         // callback() — for HUD/sfx hooks
    this.onReloadStart = null
    this.onReloadEnd = null
  }

  get reloading() { return this._reloading > 0 }

  startReload() {
    if (this._reloading > 0 || this.ammo === this.magazine) return
    this._reloading = this.reloadTime
    this.onReloadStart?.()
  }

  // Attempt to fire. `aim` = {origin, dir}. `targets` = array of Enemy with
  // .alive, .takeHit(dmg), and .hitMesh (a Mesh used for raycasting).
  tryFire(aim, targets) {
    if (this._cooldown > 0 || this._reloading > 0) return false
    if (this.ammo <= 0) { this.startReload(); return false }

    this.ammo -= 1
    this._cooldown = 1 / this.fireRate
    this.onFire?.()

    // Apply spread.
    const dir = aim.dir.clone()
    dir.x += (Math.random() - 0.5) * this.spread
    dir.y += (Math.random() - 0.5) * this.spread
    dir.z += (Math.random() - 0.5) * this.spread
    dir.normalize()

    this.raycaster.set(aim.origin, dir)
    this.raycaster.far = this.range

    // Collect candidate meshes: enemies + obstacles.
    const meshes = []
    for (const t of targets) if (t.alive && t.hitMesh) meshes.push(t.hitMesh)
    for (const o of this.world.obstacles) meshes.push(o.mesh)

    const hits = this.raycaster.intersectObjects(meshes, false)
    let endPoint = aim.origin.clone().addScaledVector(dir, this.range)
    let killed = false

    if (hits.length) {
      const hit = hits[0]
      endPoint = hit.point.clone()
      const enemy = targets.find((t) => t.hitMesh === hit.object)
      if (enemy) {
        const dead = enemy.takeHit(this.damage)
        killed = dead
        this._spawnImpact(hit.point, 0xff5555)
      } else {
        this._spawnImpact(hit.point, 0xffe08a)
      }
    }

    // Tracer from a point near the player toward the hit point.
    const tracerStart = aim.origin.clone().addScaledVector(dir, 1.2)
    this._spawnTracer(tracerStart, endPoint)
    if (this.ammo <= 0) this.startReload()

    return killed
  }

  _spawnTracer(a, b) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b])
    const mat = new THREE.LineBasicMaterial({ color: 0xfff2a8, transparent: true })
    const line = new THREE.Line(geo, mat)
    this.scene.add(line)
    this.effects.push({ mesh: line, life: 0.08, maxLife: 0.08, fade: true })
  }

  _spawnImpact(point, color) {
    const geo = new THREE.SphereGeometry(0.18, 8, 8)
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true })
    const m = new THREE.Mesh(geo, mat)
    m.position.copy(point)
    this.scene.add(m)
    this.effects.push({ mesh: m, life: 0.25, maxLife: 0.25, fade: true, grow: true })
  }

  update(dt) {
    if (this._cooldown > 0) this._cooldown -= dt
    if (this._reloading > 0) {
      this._reloading -= dt
      if (this._reloading <= 0) {
        this._reloading = 0
        this.ammo = this.magazine
        this.onReloadEnd?.()
      }
    }

    // Fade/expire effects.
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]
      e.life -= dt
      const k = Math.max(0, e.life / e.maxLife)
      if (e.fade && e.mesh.material) e.mesh.material.opacity = k
      if (e.grow) e.mesh.scale.setScalar(1 + (1 - k) * 1.5)
      if (e.life <= 0) {
        this.scene.remove(e.mesh)
        e.mesh.geometry?.dispose()
        e.mesh.material?.dispose()
        this.effects.splice(i, 1)
      }
    }
  }
}
