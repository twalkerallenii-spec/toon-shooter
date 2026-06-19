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
    if (mapKey === 'outpost') return this.buildOutpost()
    if (mapKey === 'rooftops') return this.buildRooftops()
    return this.buildArena()
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

  async buildArena() {
    const HALF = this.world.arenaRadius
    const E = HALF - 1 // edge line for the perimeter wall
    const rng = mulberry32(20240)
    const jobs = []
    const TAU = Math.PI * 2

    // ---- Perimeter wall (decorative, scaled up so it reads as a wall) -----
    const wallProto = await this._load('BrickWall_1')
    if (wallProto) {
      const WSCALE = 1.6
      const seg = (measureWidth(wallProto) || 6) * WSCALE
      const count = Math.ceil((HALF * 2) / seg)
      const step = (HALF * 2) / count
      for (let i = 0; i < count; i++) {
        const t = -HALF + step * (i + 0.5)
        jobs.push(this.place('BrickWall_1', { x: t, z: -E, rotY: 0, scale: WSCALE }))
        jobs.push(this.place('BrickWall_2', { x: t, z: E, rotY: Math.PI, scale: WSCALE }))
        jobs.push(this.place('BrickWall_2', { x: -E, z: t, rotY: Math.PI / 2, scale: WSCALE }))
        jobs.push(this.place('BrickWall_1', { x: E, z: t, rotY: -Math.PI / 2, scale: WSCALE }))
      }
    }

    // ---- Corner buildings (landmarks + big cover) ------------------------
    const c = HALF - 9
    jobs.push(this.place('Structure_1', { x: -c, z: -c, rotY: Math.PI * 0.25, solid: true, radiusMul: 0.7 }))
    jobs.push(this.place('Structure_2', { x: c, z: -c, rotY: -Math.PI * 0.25, solid: true, radiusMul: 0.7 }))
    jobs.push(this.place('Structure_3', { x: -c, z: c, rotY: Math.PI * 0.75, solid: true, radiusMul: 0.7 }))
    jobs.push(this.place('Structure_4', { x: c, z: c, rotY: -Math.PI * 0.75, solid: true, radiusMul: 0.7 }))
    // Mid-edge buildings so the perimeter isn't bare.
    jobs.push(this.place('Structure_2', { x: 0, z: -c, rotY: 0, solid: true, radiusMul: 0.7 }))
    jobs.push(this.place('Structure_3', { x: 0, z: c, rotY: Math.PI, solid: true, radiusMul: 0.7 }))
    jobs.push(this.place('Structure_1', { x: -c, z: 0, rotY: Math.PI / 2, solid: true, radiusMul: 0.7 }))
    jobs.push(this.place('Structure_4', { x: c, z: 0, rotY: -Math.PI / 2, solid: true, radiusMul: 0.7 }))

    // ---- Water tanks (kept OFF the central spawn so it stays open) -------
    jobs.push(this.place('WaterTank_Platform', { x: 14, z: 10, solid: true, radiusMul: 0.6 }))
    jobs.push(this.place('WaterTank_Floor', { x: -12, z: -14, solid: true, radiusMul: 0.7 }))

    // ---- Vehicles as heavy cover ----------------------------------------
    jobs.push(this.place('Tank', { x: -16, z: 8, rotY: 1.1, solid: true, radiusMul: 0.7 }))
    jobs.push(this.place('Debris_BrokenCar', { x: 18, z: -10, rotY: -0.6, solid: true, radiusMul: 0.7 }))
    jobs.push(this.place('Debris_BrokenCar', { x: -22, z: -22, rotY: 2.0, solid: true, radiusMul: 0.7 }))

    // ---- Interior fence lines (lanes / sight blockers) ------------------
    const fenceProto = await this._load('Fence_Long')
    if (fenceProto) {
      const fseg = measureWidth(fenceProto) || 5
      const lines = [
        { x: -10, z: -6, dx: 1, dz: 0, n: 5 },
        { x: 8, z: 12, dx: 0, dz: 1, n: 4 },
        { x: 14, z: -20, dx: 1, dz: 0.3, n: 4 },
        { x: -24, z: 10, dx: 0, dz: 1, n: 5 },
      ]
      for (const L of lines) {
        const ang = Math.atan2(L.dx, L.dz)
        for (let i = 0; i < L.n; i++) {
          jobs.push(this.place('Fence_Long', {
            x: L.x + L.dx * fseg * i, z: L.z + L.dz * fseg * i, rotY: ang, solid: true, radiusMul: 0.5,
          }))
        }
      }
    }

    // ---- Cover clusters spread across the WHOLE arena -------------------
    const coverMains = ['Container_Small', 'SackTrench', 'Barrier_Large', 'Crate',
      'CardboardBoxes_1', 'CardboardBoxes_3', 'Container_Long', 'SackTrench_Small',
      'TrashContainer', 'Barrier_Fixed', 'Barrier_Trash', 'Pallet']
    const extras = ['Crate', 'CardboardBoxes_2', 'CardboardBoxes_4', 'Pallet', 'GasTank',
      'GasCan', 'Barrier_Single', 'TrashContainer_Open']
    // Ring out from center to the edge in several rings so nothing is empty.
    let ci = 0
    for (const ring of [10, 18, 26, 33]) {
      const slots = ring < 14 ? 5 : 8
      for (let s = 0; s < slots; s++) {
        const a = (s / slots) * TAU + rng() * 0.4 + ring
        const x = Math.cos(a) * ring + (rng() - 0.5) * 4
        const z = Math.sin(a) * ring + (rng() - 0.5) * 4
        jobs.push(this.place(coverMains[ci % coverMains.length], {
          x, z, rotY: rng() * TAU, solid: true,
        }))
        ci++
        const n = 1 + Math.floor(rng() * 3)
        for (let k = 0; k < n; k++) {
          jobs.push(this.place(extras[Math.floor(rng() * extras.length)], {
            x: x + (rng() - 0.5) * 7, z: z + (rng() - 0.5) * 7, rotY: rng() * TAU, solid: true,
          }))
        }
      }
    }

    // ---- Exploding barrels scattered (cover; destructible later) --------
    for (let i = 0; i < 10; i++) {
      let x = (rng() - 0.5) * HALF * 1.7
      let z = (rng() - 0.5) * HALF * 1.7
      // Keep solid barrels out of the open central spawn plaza.
      const d = Math.hypot(x, z)
      if (d < 8) { x = (x / d) * 8; z = (z / d) * 8 }
      jobs.push(this.place(rng() < 0.5 ? 'ExplodingBarrel' : 'ExplodingBarrel_Spilled', {
        x, z, solid: true, radiusMul: 0.9, barrel: true,
      }))
    }

    // ---- Trees lining the field -----------------------------------------
    const trees = ['Tree_1', 'Tree_2', 'Tree_3', 'Tree_4']
    for (let i = 0; i < 26; i++) {
      const edge = HALF - 3 - rng() * 6
      const ang = (i / 26) * TAU + rng() * 0.2
      jobs.push(this.place(trees[i % trees.length], {
        x: Math.cos(ang) * edge, z: Math.sin(ang) * edge, rotY: rng() * TAU, solid: true, radiusMul: 0.35,
      }))
    }

    // ---- Lots of ground decoration (non-solid) so the field feels lived-in
    const deco = ['StreetLight', 'Sign', 'TrafficCone', 'Debris_Tires', 'Debris_Pile',
      'Debris_Papers_1', 'Debris_Papers_2', 'Debris_Papers_3', 'Pipes', 'WoodPlanks',
      'Pallet_Broken', 'BearTrap_Closed', 'Sofa', 'Sofa_Small']
    for (let i = 0; i < 60; i++) {
      jobs.push(this.place(deco[i % deco.length], {
        x: (rng() - 0.5) * HALF * 1.85,
        z: (rng() - 0.5) * HALF * 1.85,
        rotY: rng() * TAU,
      }))
    }

    await Promise.all(jobs)
  }

  // OUTPOST: building-heavy layout with lanes between structures and lots of
  // climbable container/crate cover. Tighter, more cover-to-cover combat.
  async buildOutpost() {
    const rng = mulberry32(7777)
    const TAU = Math.PI * 2
    const jobs = [this._perimeter(1.6)]

    // A loose grid of buildings forming streets.
    const bld = ['Structure_1', 'Structure_2', 'Structure_3', 'Structure_4']
    let bi = 0
    for (let gx = -1; gx <= 1; gx++) {
      for (let gz = -1; gz <= 1; gz++) {
        if (gx === 0 && gz === 0) continue // keep the center plaza open
        jobs.push(this.place(bld[bi++ % bld.length], {
          x: gx * 22 + (rng() - 0.5) * 4, z: gz * 22 + (rng() - 0.5) * 4,
          rotY: Math.round(rng() * 4) * (Math.PI / 2), solid: true, radiusMul: 0.7,
        }))
      }
    }

    // Climbable container stacks (cover you can mount) + crates beside them.
    const stacks = [{ x: -10, z: 0 }, { x: 10, z: 6 }, { x: 0, z: -12 }, { x: 6, z: 14 }, { x: -16, z: -14 }]
    for (const s of stacks) {
      jobs.push(this.place('Container_Long', { x: s.x, z: s.z, rotY: rng() * TAU, solid: true }))
      jobs.push(this.place('Crate', { x: s.x + 2.2, z: s.z + 1.5, rotY: rng() * TAU, solid: true }))
      jobs.push(this.place('Crate', { x: s.x - 1.5, z: s.z - 2, rotY: rng() * TAU, solid: true }))
      jobs.push(this.place('SackTrench', { x: s.x + (rng() - 0.5) * 6, z: s.z + (rng() - 0.5) * 6, rotY: rng() * TAU, solid: true }))
    }

    // Jump pads to reach the rooftops/containers.
    this.world.addJumpPad(-10, 4, 13)
    this.world.addJumpPad(10, 2, 13)

    // Barrels + decoration.
    for (let i = 0; i < 8; i++) {
      let x = (rng() - 0.5) * 60, z = (rng() - 0.5) * 60
      const d = Math.hypot(x, z); if (d < 7) { x = x / d * 7; z = z / d * 7 }
      jobs.push(this.place('ExplodingBarrel', { x, z, solid: true, radiusMul: 0.9, barrel: true }))
    }
    const deco = ['StreetLight', 'TrafficCone', 'Debris_Tires', 'Sign', 'Pipes', 'Debris_Papers_1', 'Pallet_Broken']
    for (let i = 0; i < 30; i++) {
      jobs.push(this.place(deco[i % deco.length], { x: (rng() - 0.5) * 72, z: (rng() - 0.5) * 72, rotY: rng() * TAU }))
    }
    await Promise.all(jobs)
  }

  // ROOFTOPS: elevated container/platform islands at varying heights connected by
  // jump pads — vertical, parkour-style combat above the ground.
  async buildRooftops() {
    const rng = mulberry32(4242)
    const TAU = Math.PI * 2
    const jobs = [this._perimeter(1.6)]

    // Elevated platforms (raised via baseY). Player hops between them with pads.
    const decks = [
      { x: -14, z: -6, y: 2.5 }, { x: 14, z: 6, y: 2.5 },
      { x: 12, z: -14, y: 4.5 }, { x: -12, z: 14, y: 4.5 },
      { x: -22, z: 18, y: 6.5 }, { x: 22, z: -18, y: 6.5 },
      { x: 0, z: 24, y: 5.5 }, { x: 0, z: -24, y: 5.5 },
    ]
    for (const d of decks) {
      // Two long containers side by side make a wide deck.
      jobs.push(this.place('Container_Long', { x: d.x - 1.6, z: d.z, rotY: 0, solid: true, baseY: d.y, climbable: true }))
      jobs.push(this.place('Container_Long', { x: d.x + 1.6, z: d.z, rotY: 0, solid: true, baseY: d.y, climbable: true }))
      // Sandbag cover on the deck.
      jobs.push(this.place('SackTrench_Small', { x: d.x + (rng() - 0.5) * 3, z: d.z + 1.6, rotY: rng() * TAU, solid: true, baseY: d.y + 2.6 }))
    }

    // Jump pads at the base near each deck to launch up.
    this.world.addJumpPad(0, 5, 12)
    this.world.addJumpPad(-14, -1, 14)
    this.world.addJumpPad(14, 1, 14)
    this.world.addJumpPad(12, -9, 17)
    this.world.addJumpPad(-12, 9, 17)
    this.world.addJumpPad(-22, 13, 20)
    this.world.addJumpPad(22, -13, 20)

    // Ground-level cover so you're not helpless when you fall.
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU
      jobs.push(this.place(i % 2 ? 'Crate' : 'SackTrench', {
        x: Math.cos(a) * (16 + rng() * 12), z: Math.sin(a) * (16 + rng() * 12),
        rotY: rng() * TAU, solid: true,
      }))
    }
    for (let i = 0; i < 5; i++) {
      jobs.push(this.place('ExplodingBarrel', { x: (rng() - 0.5) * 50, z: (rng() - 0.5) * 50, solid: true, radiusMul: 0.9, barrel: true }))
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
