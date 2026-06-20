import * as THREE from 'three'

// Builds a designed combat arena out of Toon Shooter Game Kit environment props:
// a walled perimeter, corner buildings, cover clusters, vehicles, and scattered
// decoration. Solid props register circular colliders; perimeter walls are
// decorative (the arena clamp already keeps everyone inside).
export class LevelBuilder {
  constructor({ world, assets }) {
    this.world = world
    this.assets = assets
  }

  async _load(name) {
    const m = await this.assets.loadModel(`models/env/${name}.gltf`)
    return m ? m.scene : null
  }

  // Place a single named prop. Returns the placed Object3D (or null).
  async place(name, opts) {
    const scene = await this._load(name)
    if (!scene) return null
    return this.world.placeModel(scene, opts)
  }

  // Dispatch to a specific map layout.
  async build(mapKey = 'arena') {
    if (mapKey === 'royale') return this.buildRoyale()
    if (mapKey === 'outpost') return this.buildOutpost()
    if (mapKey === 'rooftops') return this.buildRooftops()
    return this.buildArena()
  }

  // ROYALE: a big, open Battle Royale island. Sparse clustered cover with wide
  // open lanes so cars can roam; landmark ruins, trees, barrels, and car spawns.
  async buildRoyale() {
    const HALF = this.world.arenaRadius
    const rng = mulberry32(56789)
    const TAU = Math.PI * 2
    const jobs = []

    // A handful of landmark building clusters (POIs), spaced far apart.
    const pois = [
      { x: -HALF * 0.5, z: -HALF * 0.5 }, { x: HALF * 0.55, z: -HALF * 0.45 },
      { x: -HALF * 0.55, z: HALF * 0.5 }, { x: HALF * 0.5, z: HALF * 0.55 },
      { x: 0, z: -HALF * 0.6 }, { x: 0, z: HALF * 0.6 }, { x: -HALF * 0.62, z: 0 }, { x: HALF * 0.62, z: 0 },
    ]
    const bld = ['Structure_1', 'Structure_2', 'Structure_3', 'Structure_4']
    const cover = ['Container_Long', 'Container_Small', 'SackTrench', 'Crate', 'Barrier_Large', 'TrashContainer', 'CardboardBoxes_1']
    pois.forEach((p, i) => {
      jobs.push(this.place(bld[i % 4], { x: p.x, z: p.z, rotY: rng() * TAU, solid: true, radiusMul: 0.7 }))
      const n = 4 + Math.floor(rng() * 4)
      for (let k = 0; k < n; k++) {
        const a = rng() * TAU, r = 5 + rng() * 9
        jobs.push(this.place(cover[Math.floor(rng() * cover.length)], {
          x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, rotY: rng() * TAU, solid: true,
        }))
      }
      // Climbable crate stack at each POI.
      jobs.push(this.place('Crate', { x: p.x + 3, z: p.z + 3, solid: true }))
      jobs.push(this.place('Crate', { x: p.x + 3, z: p.z + 3, baseY: 2.0, solid: true }))
      // Car spawn near each POI (kept in the open).
      this.world.carSpawns.push({ x: p.x + (rng() - 0.5) * 16, z: p.z + (rng() - 0.5) * 16 })
    })

    // A couple of central car spawns + jump pads.
    this.world.carSpawns.push({ x: 12, z: 0 }, { x: -12, z: 8 })
    this.world.addJumpPad(20, 20, 16)
    this.world.addJumpPad(-20, -20, 16)

    // Light tree scatter (kept sparse so driving stays open).
    const trees = ['Tree_1', 'Tree_2', 'Tree_3', 'Tree_4']
    for (let i = 0; i < 40; i++) {
      const a = rng() * TAU, r = HALF * (0.2 + rng() * 0.75)
      jobs.push(this.place(trees[i % 4], { x: Math.cos(a) * r, z: Math.sin(a) * r, rotY: rng() * TAU, solid: true, radiusMul: 0.3 }))
    }

    // Glowing exploding barrels scattered.
    for (let i = 0; i < 16; i++) {
      let x = (rng() - 0.5) * HALF * 1.7, z = (rng() - 0.5) * HALF * 1.7
      const d = Math.hypot(x, z); if (d < 12) { x = x / d * 12; z = z / d * 12 }
      jobs.push(this.place(rng() < 0.5 ? 'ExplodingBarrel' : 'ExplodingBarrel_Spilled', { x, z, solid: true, radiusMul: 0.9, barrel: true }))
    }

    // Sparse decoration.
    const deco = ['Debris_Tires', 'Debris_Pile', 'Sign', 'StreetLight', 'Pipes', 'WoodPlanks', 'Debris_BrokenCar']
    for (let i = 0; i < 40; i++) {
      jobs.push(this.place(deco[i % deco.length], { x: (rng() - 0.5) * HALF * 1.9, z: (rng() - 0.5) * HALF * 1.9, rotY: rng() * TAU }))
    }

    await Promise.all(jobs)
  }

  // Tile a scaled brick-wall perimeter around the square arena (decorative).
  async _perimeter(scale = 1.6) {
    const HALF = this.world.arenaRadius
    const E = HALF - 1
    const jobs = []
    const wallProto = await this._load('BrickWall_1')
    if (!wallProto) return
    const seg = (measureWidth(wallProto) || 6) * scale
    const count = Math.ceil((HALF * 2) / seg)
    const step = (HALF * 2) / count
    for (let i = 0; i < count; i++) {
      const t = -HALF + step * (i + 0.5)
      jobs.push(this.place('BrickWall_1', { x: t, z: -E, rotY: 0, scale }))
      jobs.push(this.place('BrickWall_2', { x: t, z: E, rotY: Math.PI, scale }))
      jobs.push(this.place('BrickWall_2', { x: -E, z: t, rotY: Math.PI / 2, scale }))
      jobs.push(this.place('BrickWall_1', { x: E, z: t, rotY: -Math.PI / 2, scale }))
    }
    await Promise.all(jobs)
  }

  // A team base: colored pad (added by caller), sandbag ring with an opening
  // toward the field, a building behind it, and a couple crates. Flag-ready.
  async _base(x, z, rng) {
    const TAU = Math.PI * 2
    const jobs = []
    const ringR = 7
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU
      // Leave a gap on the side facing the field (center).
      if ((z < 0 && Math.sin(a) > 0.55) || (z > 0 && Math.sin(a) < -0.55)) continue
      jobs.push(this.place('SackTrench', {
        x: x + Math.cos(a) * ringR, z: z + Math.sin(a) * ringR, rotY: a + Math.PI / 2, solid: true, radiusMul: 0.6,
      }))
    }
    const behind = z < 0 ? -1 : 1
    jobs.push(this.place('Structure_2', { x, z: z + behind * 10, rotY: z < 0 ? 0 : Math.PI, solid: true, radiusMul: 0.7 }))
    jobs.push(this.place('Crate', { x: x - 3.5, z, solid: true }))
    jobs.push(this.place('Crate', { x: x + 3.5, z, solid: true }))
    return Promise.all(jobs)
  }

  async buildArena() {
    const HALF = this.world.arenaRadius
    const S = (v) => v * (HALF / 42) // scale legacy coords to the bigger arena
    const rng = mulberry32(20240)
    const TAU = Math.PI * 2
    const jobs = [this._perimeter(1.8)]

    // ---- Team bases at the two ends (CTF / objective ready) -------------
    const baseZ = HALF - 13
    this.world.addBase('red', 0, -baseZ)
    this.world.addBase('blue', 0, baseZ)
    jobs.push(this._base(0, -baseZ, rng), this._base(0, baseZ, rng))

    // ---- Buildings: corners + mid-edges, scaled to the arena ------------
    const c = HALF - 11
    const bld = ['Structure_1', 'Structure_2', 'Structure_3', 'Structure_4']
    const spots = [[-c, -c], [c, -c], [-c, c], [c, c], [-c, 0], [c, 0], [-c * 0.5, -c * 0.5], [c * 0.5, c * 0.5]]
    spots.forEach((p, i) => jobs.push(this.place(bld[i % 4], {
      x: p[0], z: p[1], rotY: Math.atan2(-p[0], -p[1]), solid: true, radiusMul: 0.7,
    })))

    // ---- Vehicles + water tanks as heavy cover (scaled) -----------------
    jobs.push(this.place('Tank', { x: S(-16), z: S(8), rotY: 1.1, solid: true, radiusMul: 0.7 }))
    jobs.push(this.place('Debris_BrokenCar', { x: S(18), z: S(-10), rotY: -0.6, solid: true, radiusMul: 0.7 }))
    jobs.push(this.place('Debris_BrokenCar', { x: S(-22), z: S(22), rotY: 2.0, solid: true, radiusMul: 0.7 }))
    jobs.push(this.place('WaterTank_Platform', { x: S(16), z: S(12), solid: true, radiusMul: 0.6 }))
    jobs.push(this.place('WaterTank_Floor', { x: S(-14), z: S(-12), solid: true, radiusMul: 0.7 }))

    // ---- Interior fence lines (scaled) ---------------------------------
    const fenceProto = await this._load('Fence_Long')
    if (fenceProto) {
      const fseg = measureWidth(fenceProto) || 5
      const lines = [
        { x: S(-12), z: S(-6), dx: 1, dz: 0, n: 7 },
        { x: S(10), z: S(14), dx: 0, dz: 1, n: 6 },
        { x: S(22), z: S(-26), dx: 1, dz: 0.3, n: 6 },
        { x: S(-30), z: S(12), dx: 0, dz: 1, n: 7 },
      ]
      for (const L of lines) {
        const ang = Math.atan2(L.dx, L.dz)
        for (let i = 0; i < L.n; i++) {
          jobs.push(this.place('Fence_Long', { x: L.x + L.dx * fseg * i, z: L.z + L.dz * fseg * i, rotY: ang, solid: true, radiusMul: 0.5 }))
        }
      }
    }

    // ---- Cover clusters in rings (fractions of HALF) -------------------
    const coverMains = ['Container_Small', 'SackTrench', 'Barrier_Large', 'Crate',
      'CardboardBoxes_1', 'CardboardBoxes_3', 'Container_Long', 'SackTrench_Small',
      'TrashContainer', 'Barrier_Fixed', 'Barrier_Trash', 'Pallet']
    const extras = ['Crate', 'CardboardBoxes_2', 'CardboardBoxes_4', 'Pallet', 'GasTank',
      'GasCan', 'Barrier_Single', 'TrashContainer_Open']
    let ci = 0
    for (const frac of [0.16, 0.3, 0.45, 0.6, 0.75]) {
      const ring = HALF * frac
      const slots = Math.max(6, Math.round(frac * 18))
      for (let s = 0; s < slots; s++) {
        const a = (s / slots) * TAU + rng() * 0.4
        const x = Math.cos(a) * ring + (rng() - 0.5) * 6
        const z = Math.sin(a) * ring + (rng() - 0.5) * 6
        jobs.push(this.place(coverMains[ci % coverMains.length], { x, z, rotY: rng() * TAU, solid: true }))
        ci++
        const n = 1 + Math.floor(rng() * 3)
        for (let k = 0; k < n; k++) {
          jobs.push(this.place(extras[Math.floor(rng() * extras.length)], {
            x: x + (rng() - 0.5) * 8, z: z + (rng() - 0.5) * 8, rotY: rng() * TAU, solid: true,
          }))
        }
      }
    }

    // ---- Exploding barrels (kept out of center spawn) ------------------
    for (let i = 0; i < 18; i++) {
      let x = (rng() - 0.5) * HALF * 1.7, z = (rng() - 0.5) * HALF * 1.7
      const d = Math.hypot(x, z); if (d < 10) { x = (x / d) * 10; z = (z / d) * 10 }
      jobs.push(this.place(rng() < 0.5 ? 'ExplodingBarrel' : 'ExplodingBarrel_Spilled', { x, z, solid: true, radiusMul: 0.9, barrel: true }))
    }

    // ---- Trees lining the field ---------------------------------------
    const trees = ['Tree_1', 'Tree_2', 'Tree_3', 'Tree_4']
    for (let i = 0; i < 44; i++) {
      const edge = HALF - 3 - rng() * 8
      const ang = (i / 44) * TAU + rng() * 0.2
      jobs.push(this.place(trees[i % trees.length], { x: Math.cos(ang) * edge, z: Math.sin(ang) * edge, rotY: rng() * TAU, solid: true, radiusMul: 0.35 }))
    }

    // ---- Ground decoration --------------------------------------------
    const deco = ['StreetLight', 'Sign', 'TrafficCone', 'Debris_Tires', 'Debris_Pile',
      'Debris_Papers_1', 'Debris_Papers_2', 'Debris_Papers_3', 'Pipes', 'WoodPlanks',
      'Pallet_Broken', 'BearTrap_Closed', 'Sofa', 'Sofa_Small']
    for (let i = 0; i < 100; i++) {
      jobs.push(this.place(deco[i % deco.length], { x: (rng() - 0.5) * HALF * 1.9, z: (rng() - 0.5) * HALF * 1.9, rotY: rng() * TAU }))
    }

    jobs.push(this._detail(HALF, 101))
    await Promise.all(jobs)
  }

  // OUTPOST: building-heavy grid with lanes, climbable container stacks, bases.
  async buildOutpost() {
    const HALF = this.world.arenaRadius
    const rng = mulberry32(7777)
    const TAU = Math.PI * 2
    const jobs = [this._perimeter(1.8)]

    const baseZ = HALF - 13
    this.world.addBase('red', 0, -baseZ)
    this.world.addBase('blue', 0, baseZ)
    jobs.push(this._base(0, -baseZ, rng), this._base(0, baseZ, rng))

    // A grid of buildings forming streets (scaled to the arena).
    const bld = ['Structure_1', 'Structure_2', 'Structure_3', 'Structure_4']
    let bi = 0
    const span = HALF * 0.62
    for (let gx = -2; gx <= 2; gx++) {
      for (let gz = -2; gz <= 2; gz++) {
        if (gx === 0 && gz === 0) continue // open center plaza
        if (Math.abs(gx) + Math.abs(gz) > 3) continue // trim far corners
        jobs.push(this.place(bld[bi++ % bld.length], {
          x: gx * (span / 2) + (rng() - 0.5) * 6, z: gz * (span / 2) + (rng() - 0.5) * 6,
          rotY: Math.round(rng() * 4) * (Math.PI / 2), solid: true, radiusMul: 0.7,
        }))
      }
    }

    // Climbable container stacks (mount them) + crates, spread out.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU
      const r = HALF * (0.25 + rng() * 0.4)
      const x = Math.cos(a) * r, z = Math.sin(a) * r
      jobs.push(this.place('Container_Long', { x, z, rotY: rng() * TAU, solid: true }))
      jobs.push(this.place('Crate', { x: x + 2.2, z: z + 1.5, solid: true }))
      jobs.push(this.place('Crate', { x: x + 2.2, z: z + 1.5, baseY: 2.0, solid: true }))
      jobs.push(this.place('SackTrench', { x: x - 2, z: z - 2, rotY: rng() * TAU, solid: true }))
    }

    this.world.addJumpPad(0, -baseZ + 12, 14)
    this.world.addJumpPad(0, baseZ - 12, 14)

    for (let i = 0; i < 14; i++) {
      let x = (rng() - 0.5) * HALF * 1.6, z = (rng() - 0.5) * HALF * 1.6
      const d = Math.hypot(x, z); if (d < 9) { x = x / d * 9; z = z / d * 9 }
      jobs.push(this.place('ExplodingBarrel', { x, z, solid: true, radiusMul: 0.9, barrel: true }))
    }
    jobs.push(this._detail(HALF, 202))
    await Promise.all(jobs)
  }

  // ROOFTOPS: elevated container decks at varying heights + jump pads, bases.
  async buildRooftops() {
    const HALF = this.world.arenaRadius
    const S = (v) => v * (HALF / 42)
    const rng = mulberry32(4242)
    const TAU = Math.PI * 2
    const jobs = [this._perimeter(1.8)]

    const baseZ = HALF - 13
    this.world.addBase('red', 0, -baseZ)
    this.world.addBase('blue', 0, baseZ)
    jobs.push(this._base(0, -baseZ, rng), this._base(0, baseZ, rng))

    const decks = [
      { x: S(-14), z: S(-6), y: 2.5 }, { x: S(14), z: S(6), y: 2.5 },
      { x: S(12), z: S(-14), y: 4.5 }, { x: S(-12), z: S(14), y: 4.5 },
      { x: S(-22), z: S(18), y: 6.5 }, { x: S(22), z: S(-18), y: 6.5 },
      { x: S(0), z: S(24), y: 5.5 }, { x: S(0), z: S(-24), y: 5.5 },
      { x: S(-30), z: S(-4), y: 5.0 }, { x: S(30), z: S(4), y: 5.0 },
    ]
    for (const d of decks) {
      jobs.push(this.place('Container_Long', { x: d.x - 1.6, z: d.z, rotY: 0, solid: true, baseY: d.y, climbable: true }))
      jobs.push(this.place('Container_Long', { x: d.x + 1.6, z: d.z, rotY: 0, solid: true, baseY: d.y, climbable: true }))
      jobs.push(this.place('SackTrench_Small', { x: d.x + (rng() - 0.5) * 3, z: d.z + 1.6, rotY: rng() * TAU, solid: true, baseY: d.y + 2.6 }))
      this.world.addJumpPad(d.x, d.z - 4, 12 + d.y * 1.4)
    }

    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU
      jobs.push(this.place(i % 2 ? 'Crate' : 'SackTrench', {
        x: Math.cos(a) * (HALF * (0.25 + rng() * 0.4)), z: Math.sin(a) * (HALF * (0.25 + rng() * 0.4)),
        rotY: rng() * TAU, solid: true,
      }))
    }
    for (let i = 0; i < 8; i++) {
      jobs.push(this.place('ExplodingBarrel', { x: (rng() - 0.5) * HALF * 1.3, z: (rng() - 0.5) * HALF * 1.3, solid: true, radiusMul: 0.9, barrel: true }))
    }
    jobs.push(this._detail(HALF, 303))
    await Promise.all(jobs)
  }

  // Shared extra detail layered onto every map: dense ground clutter, sandbag
  // walls, and climbable crate stacks. Scales with the arena half-extent.
  async _detail(HALF, seed = 1) {
    const S = (v) => v * (HALF / 42)
    const rng = mulberry32(seed)
    const TAU = Math.PI * 2
    const jobs = []

    const deco = ['Debris_Papers_1', 'Debris_Papers_2', 'Debris_Papers_3', 'Debris_Tires',
      'Debris_Pile', 'TrafficCone', 'WoodPlanks', 'Pallet_Broken', 'Pipes', 'GasCan',
      'Sign', 'BearTrap_Closed']
    for (let i = 0; i < 80; i++) {
      jobs.push(this.place(deco[i % deco.length], { x: (rng() - 0.5) * HALF * 1.9, z: (rng() - 0.5) * HALF * 1.9, rotY: rng() * TAU }))
    }

    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU
      jobs.push(this.place('StreetLight', { x: Math.cos(a) * (HALF - 8), z: Math.sin(a) * (HALF - 8), rotY: a + Math.PI }))
    }

    const sgProto = await this._load('SackTrench')
    const sgW = sgProto ? Math.max(measureWidth(sgProto), 1.5) : 2
    const walls = [
      { x: S(-18), z: S(6), dx: 1, dz: 0, n: 5 }, { x: S(16), z: S(-8), dx: 0, dz: 1, n: 4 },
      { x: S(6), z: S(18), dx: 1, dz: 0, n: 4 }, { x: S(-8), z: S(-22), dx: 1, dz: 0, n: 4 },
    ]
    for (const w of walls) {
      const ang = Math.atan2(w.dx, w.dz)
      for (let i = 0; i < w.n; i++) {
        jobs.push(this.place('SackTrench', { x: w.x + w.dx * sgW * i, z: w.z + w.dz * sgW * i, rotY: ang, solid: true, radiusMul: 0.6 }))
      }
    }

    const stacks = [{ x: S(-8), z: S(-8) }, { x: S(12), z: S(10) }, { x: S(20), z: S(-16) }, { x: S(-22), z: S(20) }]
    for (const s of stacks) {
      jobs.push(this.place('Crate', { x: s.x, z: s.z, solid: true }))
      jobs.push(this.place('Crate', { x: s.x, z: s.z, baseY: 2.0, solid: true }))
      jobs.push(this.place('Crate', { x: s.x + 2.1, z: s.z + 0.3, solid: true }))
    }
    await Promise.all(jobs)
  }
}

function measureWidth(obj) {
  const box = new THREE.Box3().setFromObject(obj)
  const s = new THREE.Vector3(); box.getSize(s)
  return Math.max(s.x, s.z)
}

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
