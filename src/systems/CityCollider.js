import * as THREE from 'three'

const DOWN = new THREE.Vector3(0, -1, 0)
const ORIGIN = new THREE.Vector3()

// Mesh-based collision for a single big city model (e.g. Fortnite city.glb).
// Provides a ground height (raycast down) and horizontal wall push-out (rays in
// a ring) so the player and cars treat the whole city as solid.
export class CityCollider {
  constructor(root) {
    this.meshes = []
    root.traverse((o) => { if (o.isMesh) this.meshes.push(o) })
    this.ray = new THREE.Raycaster()
    // Precompute ring directions for wall checks.
    this.dirs = []
    const N = 8
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      this.dirs.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)))
    }
  }

  // Highest surface under (x,z) at or below the searcher's head. Returns the
  // ground Y, or null if nothing is below.
  groundY(x, z, fromY = 250) {
    this.ray.set(ORIGIN.set(x, fromY, z), DOWN)
    this.ray.far = fromY + 60
    const hits = this.ray.intersectObjects(this.meshes, false)
    return hits.length ? hits[0].point.y : null
  }

  // Push a position out of nearby walls. Casts short rays in a ring at the given
  // body height; for each wall hit closer than `r`, pushes back. Mutates pos.
  pushOut(pos, r, y) {
    let px = 0, pz = 0
    const o = ORIGIN.set(pos.x, pos.y + y, pos.z)
    for (const d of this.dirs) {
      this.ray.set(o, d)
      this.ray.far = r
      const hits = this.ray.intersectObjects(this.meshes, false)
      if (hits.length) {
        const pen = r - hits[0].distance
        if (pen > 0) { px -= d.x * pen; pz -= d.z * pen }
      }
    }
    pos.x += px
    pos.z += pz
    return (px !== 0 || pz !== 0)
  }
}
