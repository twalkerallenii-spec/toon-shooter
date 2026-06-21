import * as THREE from 'three'

// Weapon roster (Toon Shooter Game Kit guns). `model` maps to models/guns/<>.gltf.
export const WEAPONS = [
  { key: 'Pistol',  model: 'Pistol',  ico: '🔫', rarity: 'common', damage: 26, fireRate: 6,  mag: 14, spread: 0.012, pellets: 1, auto: false, range: 200, reload: 1.0, adsFov: 55, recoil: 0.05 },
  { key: 'AK',      model: 'AK',      ico: '🔫', rarity: 'rare', damage: 30, fireRate: 9,  mag: 30, spread: 0.022, pellets: 1, auto: true,  range: 220, reload: 1.4, adsFov: 50, recoil: 0.05 },
  { key: 'SMG',     model: 'SMG',     ico: '🔫', rarity: 'uncommon', damage: 17, fireRate: 14, mag: 30, spread: 0.030, pellets: 1, auto: true,  range: 160, reload: 1.3, adsFov: 55, recoil: 0.035 },
  { key: 'Shotgun', model: 'Shotgun', ico: '💥', rarity: 'uncommon', damage: 13, fireRate: 1.4, mag: 6, spread: 0.085, pellets: 10, auto: false, range: 140, reload: 0.9, adsFov: 60, recoil: 0.12 },
  { key: 'Sniper',  model: 'Sniper',  ico: '🎯', rarity: 'epic', damage: 130, fireRate: 1.1, mag: 5, spread: 0.002, pellets: 1, auto: false, range: 500, reload: 1.8, adsFov: 22, recoil: 0.16, tracer: 0x9fe7ff },
  { key: 'Revolver', model: 'Revolver', ico: '🔫', rarity: 'rare', label: 'Revolver', damage: 55, fireRate: 3, mag: 6, spread: 0.01, pellets: 1, auto: false, range: 220, reload: 1.3, adsFov: 52, recoil: 0.12, tracer: 0xffd24a },
  { key: 'Minigun', model: 'ShortCannon', ico: '🌀', rarity: 'legendary', label: 'Minigun', damage: 13, fireRate: 18, mag: 80, spread: 0.04, pellets: 1, auto: true, range: 200, reload: 3.0, adsFov: 60, recoil: 0.03, tracer: 0xff7a3d },
  { key: 'DMR',     model: 'Sniper_2', ico: '🎯', rarity: 'rare', label: 'Marksman', damage: 72, fireRate: 3.5, mag: 10, spread: 0.006, pellets: 1, auto: false, range: 320, reload: 1.6, adsFov: 38, recoil: 0.1, tracer: 0xbfffe0 },
  { key: 'Burst',   model: 'Knife_2', ico: '🔫', rarity: 'uncommon', label: 'Burst Rifle', damage: 22, fireRate: 16, mag: 24, spread: 0.018, pellets: 1, auto: true, range: 190, reload: 1.4, adsFov: 52, recoil: 0.045, tracer: 0xffe0a0 },
  { key: 'GL',      model: 'GrenadeLauncher', ico: '🧨', rarity: 'epic', label: 'Grenade Launcher', damage: 0, fireRate: 1.0, mag: 4, spread: 0.01, pellets: 1, auto: false, range: 200, reload: 2.0, adsFov: 62, recoil: 0.18, projectile: 'grenade' },
  { key: 'RPG',     model: 'RocketLauncher', ico: '🚀', rarity: 'legendary', label: 'Rocket Launcher', damage: 0, fireRate: 0.7, mag: 2, spread: 0.01, pellets: 1, auto: false, range: 200, reload: 2.6, adsFov: 62, recoil: 0.24, projectile: 'rocket' },
  { key: 'Knife',   model: 'Knife_1', ico: '🔪', rarity: 'common', label: 'Knife', damage: 75, fireRate: 2.4, mag: 99, spread: 0, pellets: 1, auto: false, range: 4.5, reload: 0.1, adsFov: 70, recoil: 0.06, tracer: 0xffffff, melee: true },
  { key: 'Zip',     model: 'Pistol', ico: '🪝', rarity: 'uncommon', label: 'Grapple', damage: 0, fireRate: 1.6, mag: 99, spread: 0, pellets: 1, auto: false, range: 140, reload: 0.1, adsFov: 70, recoil: 0, tool: 'grapple' },
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
    this.owned = new Set(this.defs.map((_, i) => i)) // which weapons you carry

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
    if (!this.owned.has(i)) return // can't equip a weapon you haven't picked up
    this.index = i
    this._reloading = 0
    this._cooldown = Math.max(this._cooldown, 0.15)
    this.onSwitch?.(this.def, i)
  }

  cycle(dir) {
    // Cycle only through owned weapons (in roster order).
    const list = [...this.owned].sort((a, b) => a - b)
    if (!list.length) return
    let pos = list.indexOf(this.index)
    if (pos < 0) pos = 0
    const next = list[(pos + (dir > 0 ? 1 : -1) + list.length) % list.length]
    this.switchTo(next)
  }

  // Restrict the carried set to a starting loadout (Fortnite-style: loot the rest).
  setLoadout(indices) {
    this.owned = new Set(indices)
    for (const i of indices) this.ammoByWeapon[i] = this.defs[i].mag
    if (!this.owned.has(this.index)) this.index = indices[0] ?? 0
  }

  // Drop the weapon at index i (can't drop your last one). Returns true if dropped.
  discard(i) {
    if (!this.owned.has(i) || this.owned.size <= 1) return false
    this.owned.delete(i)
    if (this.index === i) { this.index = -1; this.switchTo([...this.owned].sort((a, b) => a - b)[0]) }
    return true
  }

  // Pick up a weapon: add it to the carried set, refill its mag, and equip it.
  give(i, equip = true) {
    if (i < 0 || i >= this.defs.length) return
    this.owned.add(i)
    this.ammoByWeapon[i] = this.defs[i].mag
    if (equip) { this.index = -1; this.switchTo(i) }
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

    // Tool weapons (grapple) don't shoot bullets — the Game handles the action.
    if (def.tool) {
      this._cooldown = 1 / def.fireRate
      return { fired: true, hit: false, killed: false, barrel: null, playerHit: null, tool: def.tool }
    }

    this.ammo -= 1
    this._cooldown = 1 / def.fireRate
    this.onFire?.()

    const start0 = muzzlePos ? muzzlePos.clone() : aim.origin.clone().addScaledVector(aim.dir, 1.2)

    // Projectile weapons (grenade launcher): no hitscan — caller spawns a shell.
    if (def.projectile) {
      this.flash(start0, 0xffd24a)
      if (this.ammo <= 0) this.startReload()
      return { fired: true, hit: false, killed: false, barrel: null, playerHit: null, projectile: def.projectile, origin: start0, dir: aim.dir.clone() }
    }

    const meshes = []
    for (const t of targets) if (t.alive && t.hitMesh) meshes.push(t.hitMesh)
    for (const pl of players) if (pl.hitMesh) meshes.push(pl.hitMesh)
    for (const o of this.world.obstacles) meshes.push(o.mesh)

    const start = muzzlePos ? muzzlePos.clone() : aim.origin.clone().addScaledVector(aim.dir, 1.2)
    const spread = def.spread * (ads ? 0.3 : 1)
    let hitEnemy = false, killed = false, barrel = null, playerHit = null, headshot = false, dmgDealt = 0, hitPos = null

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
        // Headshot: hit point near the top of the ~1.8m capsule -> 2x damage.
        const targetBaseY = enemy ? enemy.group.position.y : (remote ? remote.group.position.y : 0)
        const isHead = (enemy || remote) && (hit.point.y - targetBaseY) > 1.45
        const mult = isHead ? 2 : 1
        if (enemy) {
          dmgDealt = def.damage * mult; hitPos = hit.point.clone()
          if (enemy.takeHit(dmgDealt)) killed = true
          hitEnemy = true; if (isHead) headshot = true
          this.impact(hit.point, isHead ? 0xffffff : 0xff5555)
          this.particles?.emit(hit.point, isHead ? 12 : 6, { color: [1, 0.25, 0.2], speed: 6, size: 0.55, life: 0.32 })
        } else if (remote) {
          playerHit = remote.id; dmgDealt = def.damage * mult; if (isHead) headshot = true; hitPos = hit.point.clone()
          this.impact(hit.point, isHead ? 0xffffff : 0xff5555)
          this.particles?.emit(hit.point, isHead ? 12 : 6, { color: [1, 0.3, 0.3], speed: 6, size: 0.55, life: 0.32 })
        } else {
          const b = findBarrel(hit.object)
          if (b) barrel = b
          else {
            this.impact(hit.point, 0xffe08a)
            this.particles?.emit(hit.point, 4, { color: [1, 0.85, 0.4], speed: 4, size: 0.35, life: 0.22 })
          }
        }
      }
      // Melee (knife) has no bullet/tracer — just a close-range slash.
      if (!def.melee) this.beam(start, endPoint, def.tracer || 0xfff2a8)
    }

    if (!def.melee) this.flash(start, 0xffd24a)
    if (this.ammo <= 0) this.startReload()
    return { fired: true, hit: hitEnemy, killed, barrel, playerHit, headshot, dmg: dmgDealt, hitPos }
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
