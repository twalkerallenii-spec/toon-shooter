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

  // Attempt to fire. `aim` = {origin, dir} (camera ray for accurate crosshair
  // aim). `muzzlePos` = world Vector3 the visible tracer is drawn from.
  // `targets` = array of Enemy with .alive, .takeHit(dmg), .hitMesh.
  tryFire(aim, targets, muzzlePos) {
    const NONE = { fired: false, hit: false, killed: false }
    if (this._cooldown > 0 || this._reloading > 0) return NONE
    if (this.ammo <= 0) { this.startReload(); return NONE }

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

    // Collect candidate objects: enemy hit-capsules + obstacle props (Groups).
    const meshes = []
    for (const t of targets) if (t.alive && t.hitMesh) meshes.push(t.hitMesh)
    for (const o of this.world.obstacles) meshes.push(o.mesh)

    // Recursive: obstacle props are Groups with child meshes.
    const hits = this.raycaster.intersectObjects(meshes, true)
    let endPoint = aim.origin.clone().addScaledVector(dir, this.range)
    let killed = false
    let hitEnemy = false

    if (hits.length) {
      const hit = hits[0]
      endPoint = hit.point.clone()
      const enemy = targets.find((t) => t.hitMesh === hit.object)
      if (enemy) {
        killed = enemy.takeHit(this.damage)
        hitEnemy = true
        this.impact(hit.point, 0xff5555)
      } else {
        this.impact(hit.point, 0xffe08a)
      }
    }

    // Visible tracer beam from the gun muzzle to the impact point.
    const start = muzzlePos ? muzzlePos.clone() : aim.origin.clone().addScaledVector(dir, 1.2)
    this.beam(start, endPoint, 0xfff2a8)
    this.flash(start, 0xffd24a)
    if (this.ammo <= 0) this.startReload()

    return { fired: true, hit: hitEnemy, killed }
  }

  // ---- Public combat FX (used by the player weapon and by enemies) --------

  // A glowing cylinder stretched between two points (line width is unreliable in
  // WebGL, so geometry gives a tracer that's actually visible).
  beam(a, b, color = 0xfff2a8, life = 0.07) {
    const dir = new THREE.Vector3().subVectors(b, a)
    const len = dir.length()
    if (len < 0.01) return
    const geo = new THREE.CylinderGeometry(0.035, 0.035, len, 6, 1, true)
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false })
    const beam = new THREE.Mesh(geo, mat)
    beam.position.copy(a).addScaledVector(dir, 0.5)
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
    this.scene.add(beam)
    this.effects.push({ mesh: beam, life, maxLife: life, fade: true })
  }

  flash(pos, color = 0xffd24a) {
    this._spawnMuzzleFlash(pos, color)
  }

  _spawnMuzzleFlash(pos, color = 0xffd24a) {
    const geo = new THREE.SphereGeometry(0.22, 8, 8)
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false })
    const flash = new THREE.Mesh(geo, mat)
    flash.position.copy(pos)
    this.scene.add(flash)
    this.effects.push({ mesh: flash, life: 0.06, maxLife: 0.06, fade: true, grow: true })
  }

  impact(point, color = 0xffe08a) {
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
