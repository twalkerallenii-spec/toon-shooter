import * as THREE from 'three'

// Builds the scene, lighting, sky and ground. Keeps a list of static colliders
// (currently just the ground plane height + arena bounds) for simple physics.
export class World {
  constructor() {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x9fd3ff)
    this.scene.fog = new THREE.Fog(0x9fd3ff, 60, 160)

    this.arenaRadius = 70 // players/enemies are kept inside this radius
    this.groundY = 0

    this._buildLights()
    this._buildGround()
    this._buildScenery()
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x5a6b4f, 0.9)
    this.scene.add(hemi)

    const sun = new THREE.DirectionalLight(0xfff4d6, 1.6)
    sun.position.set(40, 60, 20)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    const s = 90
    sun.shadow.camera.left = -s
    sun.shadow.camera.right = s
    sun.shadow.camera.top = s
    sun.shadow.camera.bottom = -s
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 200
    sun.shadow.bias = -0.0004
    this.scene.add(sun)
    this.sun = sun
  }

  _buildGround() {
    const geo = new THREE.CircleGeometry(this.arenaRadius + 10, 64)
    const mat = new THREE.MeshStandardMaterial({ color: 0x6ab04c, roughness: 1 })
    const ground = new THREE.Mesh(geo, mat)
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    this.scene.add(ground)

    // Subtle grid so motion is readable.
    const grid = new THREE.GridHelper(this.arenaRadius * 2, 40, 0x4e8a39, 0x4e8a39)
    grid.material.opacity = 0.25
    grid.material.transparent = true
    grid.position.y = 0.02
    this.scene.add(grid)

    // Arena wall ring (visual boundary).
    const ringGeo = new THREE.TorusGeometry(this.arenaRadius, 0.6, 8, 80)
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xffcb3d, roughness: 0.6 })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.6
    this.scene.add(ring)
  }

  // A few decorative blocks/crates as cover and visual interest. These also act
  // as a stand-in until environment props from the asset kit are dropped in.
  _buildScenery() {
    this.obstacles = []
    const crateMat = new THREE.MeshStandardMaterial({ color: 0xb5651d, roughness: 0.9 })
    const rng = mulberry32(1337)
    for (let i = 0; i < 14; i++) {
      const size = 2 + rng() * 3
      const geo = new THREE.BoxGeometry(size, size, size)
      const m = new THREE.Mesh(geo, crateMat)
      const ang = rng() * Math.PI * 2
      const dist = 12 + rng() * (this.arenaRadius - 18)
      m.position.set(Math.cos(ang) * dist, size / 2, Math.sin(ang) * dist)
      m.rotation.y = rng() * Math.PI
      m.castShadow = true
      m.receiveShadow = true
      this.scene.add(m)
      this.obstacles.push({ mesh: m, radius: size * 0.7 })
    }
  }

  // Clamp a position to stay within the arena (returns a new clamped Vector3).
  clampToArena(pos) {
    const r = Math.hypot(pos.x, pos.z)
    const max = this.arenaRadius - 1.5
    if (r > max) {
      const k = max / r
      pos.x *= k
      pos.z *= k
    }
    return pos
  }
}

// Tiny deterministic PRNG so scenery is the same every run.
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
