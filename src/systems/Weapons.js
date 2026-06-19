import * as THREE from 'three'

// Weapon roster (Toon Shooter Game Kit guns). `model` maps to models/guns/<>.gltf.
export const WEAPONS = [
  { key: 'Pistol',  model: 'Pistol',  damage: 26, fireRate: 6,  mag: 14, spread: 0.012, pellets: 1, auto: false, range: 200, reload: 1.0, adsFov: 55, recoil: 0.05 },
  { key: 'AK',      model: 'AK',      damage: 30, fireRate: 9,  mag: 30, spread: 0.022, pellets: 1, auto: true,  range: 220, reload: 1.4, adsFov: 50, recoil: 0.05 },
  { key: 'SMG',     model: 'SMG',     damage: 17, fireRate: 14, mag: 30, spread: 0.030, pellets: 1, auto: true,  range: 160, reload: 1.3, adsFov: 55, recoil: 0.035 },
  { key: 'Shotgun', model: 'Shotgun', damage: 13, fireRate: 1.4, mag: 6, spread: 0.10,  pellets: 9, auto: false, range: 70,  reload: 0.9, adsFov: 60, recoil: 0.12 },
  { key: 'Sniper',  model: 'Sniper',  damage: 130, fireRate: 1.1, mag: 5, spread: 0.002, pellets: 1, auto: false, range: 500, reload: 1.8, adsFov: 22, recoil: 0.16 },
]

// Hitscan shooting for a roster of weapons + lightweight combat FX (tracers,
// muzzle flash, impact sparks) shared with enemies.
export class Weapons {
  constructor({ world, particles = null }) {
    this.world = world
    this.scene = world.scene
    this.particles = particles
    this.raycaster = new THREE.Raycaster()
    this.effects = []

    this.defs = WEAPONS
    this.index = 1 // start on the AK
    this.ammoByWeapon = this.defs.map((d) => d.mag)

    this._cooldown = 0
    this._reloading = 0

    this.onFire = null
    this.onReloadStart = null
    this.onReloadEnd = null
    this.onSwitch = null
  }

  get def() { return this.defs[this.index] }
  get magazine() { return this.def.mag }
  get ammo() { return this.ammoByWeapon[this.index] }
  set ammo(v) { this.ammoByWeapon[this.index] = v }
  get reloading() { return this._reloading > 0 }
  get auto() { return this.def.auto }

  switchTo(i) {
    if (i < 0 || i >= this.defs.length || i === this.index) return
    this.index = i
    this._reloading = 0
    this._cooldown = Math.max(this._cooldown, 0.15)
    this.onSwitch?.(this.def, i)
  }

  cycle(dir) {
    const n = this.defs.length
    this.switchTo((this.index + (dir > 0 ? 1 : -1) + n) % n)
  }

  startReload() {
    if (this._reloading > 0 || this.ammo === this.magazine) return
    this._reloading = this.def.reload
    this.onReloadStart?.()
  }

  // Attempt to fire. aim={origin,dir}; muzzlePos = tracer origin; targets=enemies;
  // ads=true tightens spread. Returns {fired,hit,killed,barrel}.
  tryFire(aim, targets, muzzlePos, ads = false, players = []) {
    const NONE = { fired: false, hit: false, killed: false, barrel: null, playerHit: null }
    if (this._cooldown > 0 || this._reloading > 0) return NONE
    if (this.ammo <= 0) { this.startReload(); return NONE }

    const def = this.def
    this.ammo -= 1
    this._cooldown = 1 / def.fireRate
    this.onFire?.()

    const meshes = []
    for (const t of targets) if (t.alive && t.hitMesh) meshes.push(t.hitMesh)
    for (const pl of players) if (pl.hitMesh) meshes.push(pl.hitMesh)
    for (const o of this.world.obstacles) meshes.push(o.mesh)

    const start = muzzlePos ? muzzlePos.clone() : aim.origin.clone().addScaledVector(aim.dir, 1.2)
    const spread = def.spread * (ads ? 0.3 : 1)
    let hitEnemy = false, killed = false, barrel = null, playerHit = null

    for (let p = 0; p < def.pellets; p++) {
      const dir = aim.dir.clone()
      dir.x += (Math.random() - 0.5) * spread
      dir.y += (Math.random() - 0.5) * spread
      dir.z += (Math.random() - 0.5) * spread
      dir.normalize()

      this.raycaster.set(aim.origin, dir)
      this.raycaster.far = def.range
      const hits = this.raycaster.intersectObjects(meshes, true)
      let endPoint = aim.origin.clone().addScaledVector(dir, def.range)

      if (hits.length) {
        const hit = hits[0]
        endPoint = hit.point.clone()
        const enemy = targets.find((t) => t.hitMesh === hit.object)
        const remote = hit.object.userData?.remote
        if (enemy) {
          if (enemy.takeHit(def.damage)) killed = true
          hitEnemy = true
          this.impact(hit.point, 0xff5555)
          this.particles?.emit(hit.point, 6, { color: [1, 0.25, 0.2], speed: 5, size: 0.55, life: 0.32 })
        } else if (remote) {
          playerHit = remote.id
          this.impact(hit.point, 0xff5555)
          this.particles?.emit(hit.point, 6, { color: [1, 0.3, 0.3], speed: 5, size: 0.55, life: 0.32 })
        } else {
          const b = findBarrel(hit.object)
          if (b) barrel = b
          else {
            this.impact(hit.point, 0xffe08a)
            this.particles?.emit(hit.point, 4, { color: [1, 0.85, 0.4], speed: 4, size: 0.35, life: 0.22 })
          }
        }
      }
      this.beam(start, endPoint, 0xfff2a8)
    }

    this.flash(start, 0xffd24a)
    if (this.ammo <= 0) this.startReload()
    return { fired: true, hit: hitEnemy, killed, barrel, playerHit }
  }

  // ---- Public combat FX (player weapon + enemies) ------------------------
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

  flash(pos, color = 0xffd24a) { this._spawnMuzzleFlash(pos, color) }
  emit(...args) { this.particles?.emit(...args) }

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

function findBarrel(obj) {
  let o = obj
  while (o) {
    if (o.userData && o.userData.barrel && o.userData.barrel.alive) return o.userData.barrel
    o = o.parent
  }
  return null
}
