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

  // Placeholder cover blocks, created immediately so collisions work before the
  // kit props finish loading. addPropModels() later swaps in real models.
  _buildScenery() {
    this.obstacles = []
    this.propSlots = [] // { x, z, radius, rotY } — filled deterministically
    const crateMat = new THREE.MeshStandardMaterial({ color: 0xb5651d, roughness: 0.9 })
    const rng = mulberry32(1337)
    for (let i = 0; i < 16; i++) {
      const size = 2 + rng() * 2
      const ang = rng() * Math.PI * 2
      const dist = 12 + rng() * (this.arenaRadius - 18)
      const x = Math.cos(ang) * dist
      const z = Math.sin(ang) * dist
      const rotY = rng() * Math.PI
      const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), crateMat)
      m.position.set(x, size / 2, z)
      m.rotation.y = rotY
      m.castShadow = true
      m.receiveShadow = true
      this.scene.add(m)
      const obstacle = { mesh: m, radius: size * 0.7 }
      this.obstacles.push(obstacle)
      this.propSlots.push({ x, z, rotY, obstacle, placeholder: m })
    }
  }

  // Replace placeholder boxes with real kit prop models. `props` is an array of
  // { scene } loaded models; they're distributed across the prop slots and
  // auto-scaled to roughly fill each slot footprint.
  addPropModels(props) {
    if (!props || !props.length) return
    let i = 0
    for (const slot of this.propSlots) {
      const proto = props[i % props.length]
      i++
      if (!proto || !proto.scene) continue
      const model = proto.scene
      // Scale prop so its larger horizontal footprint ~= the slot.
      const box = new THREE.Box3().setFromObject(model)
      const size = new THREE.Vector3(); box.getSize(size)
      const footprint = Math.max(size.x, size.z) || 1
      const targetFootprint = slot.obstacle.radius * 2
      model.scale.setScalar(targetFootprint / footprint)

      const box2 = new THREE.Box3().setFromObject(model)
      const center = new THREE.Vector3(); box2.getCenter(center)
      model.position.set(slot.x - center.x, -box2.min.y, slot.z - center.z)
      model.rotation.y = slot.rotY
      model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })

      this.scene.add(model)
      this.scene.remove(slot.placeholder)
      slot.obstacle.mesh = model // raycast against the real prop now
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
