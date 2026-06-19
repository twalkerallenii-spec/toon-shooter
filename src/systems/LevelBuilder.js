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

  async build() {
    const HALF = this.world.arenaRadius
    const E = HALF - 1 // edge line for the perimeter wall
    const rng = mulberry32(20240)

    const jobs = []

    // ---- Perimeter wall (decorative) -------------------------------------
    // Measure one wall segment to tile evenly along each edge.
    const wallProto = await this._load('BrickWall_1')
    if (wallProto) {
      const seg = measureWidth(wallProto) || 6
      const count = Math.ceil((HALF * 2) / seg)
      const step = (HALF * 2) / count
      for (let i = 0; i < count; i++) {
        const t = -HALF + step * (i + 0.5)
        // top & bottom edges (run along X)
        jobs.push(this.place('BrickWall_1', { x: t, z: -E, rotY: 0 }))
        jobs.push(this.place('BrickWall_2', { x: t, z: E, rotY: Math.PI }))
        // left & right edges (run along Z)
        jobs.push(this.place('BrickWall_2', { x: -E, z: t, rotY: Math.PI / 2 }))
        jobs.push(this.place('BrickWall_1', { x: E, z: t, rotY: -Math.PI / 2 }))
      }
    }

    // ---- Corner buildings (landmarks + big cover) ------------------------
    const c = HALF - 10
    jobs.push(this.place('Structure_1', { x: -c, z: -c, rotY: Math.PI * 0.25, solid: true, radiusMul: 0.7 }))
    jobs.push(this.place('Structure_2', { x: c, z: -c, rotY: -Math.PI * 0.25, solid: true, radiusMul: 0.7 }))
    jobs.push(this.place('Structure_3', { x: -c, z: c, rotY: Math.PI * 0.75, solid: true, radiusMul: 0.7 }))
    jobs.push(this.place('Structure_4', { x: c, z: c, rotY: -Math.PI * 0.75, solid: true, radiusMul: 0.7 }))

    // ---- Central landmark: water tank platform ---------------------------
    jobs.push(this.place('WaterTank_Platform', { x: 0, z: 0, solid: true, radiusMul: 0.6 }))

    // ---- Vehicles as heavy cover ----------------------------------------
    jobs.push(this.place('Tank', { x: -16, z: 8, rotY: 1.1, solid: true, radiusMul: 0.7 }))
    jobs.push(this.place('Debris_BrokenCar', { x: 18, z: -10, rotY: -0.6, solid: true, radiusMul: 0.7 }))

    // ---- Cover clusters (deterministic combat positions) ----------------
    const clusters = [
      { x: -14, z: -16 }, { x: 16, z: 14 }, { x: -20, z: 18 },
      { x: 22, z: -18 }, { x: 0, z: 22 }, { x: 0, z: -24 },
      { x: -26, z: 0 }, { x: 26, z: 4 },
    ]
    const coverProps = ['Container_Small', 'SackTrench', 'Barrier_Large', 'Crate',
      'CardboardBoxes_1', 'CardboardBoxes_3', 'Container_Long', 'SackTrench_Small']
    clusters.forEach((p, i) => {
      const main = coverProps[i % coverProps.length]
      jobs.push(this.place(main, { x: p.x, z: p.z, rotY: rng() * Math.PI * 2, solid: true }))
      // A couple of smaller bits beside each cover piece.
      const extras = ['Crate', 'CardboardBoxes_2', 'Pallet', 'GasTank', 'Barrier_Single']
      const n = 1 + Math.floor(rng() * 2)
      for (let k = 0; k < n; k++) {
        const ex = extras[Math.floor(rng() * extras.length)]
        jobs.push(this.place(ex, {
          x: p.x + (rng() - 0.5) * 6,
          z: p.z + (rng() - 0.5) * 6,
          rotY: rng() * Math.PI * 2,
          solid: true,
        }))
      }
    })

    // ---- Exploding barrels (cover now; can be made destructible later) ---
    for (const p of [{ x: -8, z: 4 }, { x: 10, z: 6 }, { x: 4, z: -12 }]) {
      jobs.push(this.place('ExplodingBarrel', { x: p.x, z: p.z, solid: true, radiusMul: 0.9 }))
    }

    // ---- Decoration (non-solid): trees, lights, signs, debris -----------
    const trees = ['Tree_1', 'Tree_2', 'Tree_3', 'Tree_4']
    for (let i = 0; i < 14; i++) {
      const edge = HALF - 4 - rng() * 3
      const ang = rng() * Math.PI * 2
      jobs.push(this.place(trees[i % trees.length], {
        x: Math.cos(ang) * edge, z: Math.sin(ang) * edge, rotY: rng() * Math.PI * 2,
      }))
    }
    const deco = ['StreetLight', 'Sign', 'TrafficCone', 'Debris_Tires', 'Debris_Pile',
      'Debris_Papers_1', 'Debris_Papers_2', 'Pipes', 'WoodPlanks', 'Pallet_Broken']
    for (let i = 0; i < 22; i++) {
      const name = deco[i % deco.length]
      jobs.push(this.place(name, {
        x: (rng() - 0.5) * (HALF * 1.7),
        z: (rng() - 0.5) * (HALF * 1.7),
        rotY: rng() * Math.PI * 2,
      }))
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
