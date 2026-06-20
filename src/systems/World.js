import * as THREE from 'three'

// Builds the scene, lighting, sky and ground for a square combat arena, and
// provides a placeModel() helper the LevelBuilder uses to drop kit props in with
// automatic grounding + collision registration.
export class World {
  constructor() {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x9fd3ff)
    this.scene.fog = new THREE.Fog(0x9fd3ff, 90, 260)

    this.arenaRadius = 75 // half-extent of the square arena (kept name for callers)
    this.groundY = 0
    this.obstacles = []   // { mesh, radius, x, z } — used for bullet raycasts
    this.platforms = []   // AABB colliders { minX, maxX, minZ, maxZ, top, bottom } — movement
    this.jumpPads = []    // { x, z, radius, power, mesh }
    this.barrels = []     // explodable barrels: { group, obstacle, x, z, radius, alive }
    this.bases = []       // team base markers: { team, x, z } — used by CTF/objective modes

    this._buildLights()
    this._buildGround()
  }

  // A glowing pad that launches the player upward when stepped on.
  addJumpPad(x, z, power = 16) {
    const geo = new THREE.CylinderGeometry(1.6, 1.8, 0.4, 16)
    const mat = new THREE.MeshStandardMaterial({
      color: 0x33e1ff, emissive: 0x14a0c0, emissiveIntensity: 1.2, roughness: 0.4,
    })
    const pad = new THREE.Mesh(geo, mat)
    pad.position.set(x, 0.2, z)
    pad.receiveShadow = true
    this.scene.add(pad)
    this.jumpPads.push({ x, z, radius: 1.8, power, mesh: pad })
  }

  // A team base pad (capture point / flag stand for objective modes).
  addBase(team, x, z) {
    const col = team === 'red' ? 0xff4444 : 0x4488ff
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(4, 4.4, 0.3, 32),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.45, roughness: 0.7 })
    )
    pad.position.set(x, 0.16, z)
    pad.receiveShadow = true
    this.scene.add(pad)
    this.bases.push({ team, x, z, pad })
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x55613f, 0.85)
    this.scene.add(hemi)

    const sun = new THREE.DirectionalLight(0xfff1d0, 1.7)
    sun.position.set(50, 70, 30)
    sun.castShadow = true
    sun.shadow.mapSize.set(4096, 4096) // larger arena -> bigger shadow map
    sun.position.set(70, 100, 45)
    const s = this.arenaRadius + 20
    sun.shadow.camera.left = -s
    sun.shadow.camera.right = s
    sun.shadow.camera.top = s
    sun.shadow.camera.bottom = -s
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 400
    sun.shadow.bias = -0.0004
    this.scene.add(sun)
    this.sun = sun
  }

  _buildGround() {
    const span = (this.arenaRadius + 12) * 2
    const geo = new THREE.PlaneGeometry(span, span)
    const mat = new THREE.MeshStandardMaterial({ color: 0x7a8b5a, roughness: 1 })
    const ground = new THREE.Mesh(geo, mat)
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    this.scene.add(ground)

    // Subtle grid for motion readability.
    const grid = new THREE.GridHelper(span, 48, 0x5c6b43, 0x5c6b43)
    grid.material.opacity = 0.18
    grid.material.transparent = true
    grid.position.y = 0.02
    this.scene.add(grid)
  }

  // Place a loaded model clone in the world. Options:
  //   x, z       world position (default 0,0)
  //   rotY       Y rotation in radians
  //   scale      uniform scale (default 1 = native kit scale)
  //   solid      register a circular collider (default false)
  //   radiusMul  shrink/grow the collider relative to footprint (default 0.8)
  //   groundOffset extra lift off the ground (default 0)
  // Returns the placed model (Object3D), or null if model missing.
  placeModel(scene, { x = 0, z = 0, rotY = 0, scale = 1, solid = false, radiusMul = 0.8, groundOffset = 0, barrel = false, climbable = true, baseY = null } = {}) {
    if (!scene) return null
    scene.scale.setScalar(scale)
    scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false } })

    // Measure (scaled, at origin), then place. baseY raises the model's base to a
    // given height (for elevated platforms); otherwise it sits on the ground.
    const box = new THREE.Box3().setFromObject(scene)
    const size = new THREE.Vector3(); box.getSize(size)
    const center = new THREE.Vector3(); box.getCenter(center)
    scene.rotation.y = rotY
    const restY = baseY != null ? baseY - box.min.y : -box.min.y + groundOffset
    scene.position.set(x - center.x, restY, z - center.z)

    this.scene.add(scene)

    if (solid) {
      const footprint = Math.max(size.x, size.z) || 1
      const obstacle = { mesh: scene, radius: (footprint / 2) * radiusMul, x, z }
      this.obstacles.push(obstacle)

      // AABB collider for movement (walk into it, or stand on top). Measure the
      // placed model's true world bounds.
      const wb = new THREE.Box3().setFromObject(scene)
      this.platforms.push({
        minX: wb.min.x, maxX: wb.max.x,
        minZ: wb.min.z, maxZ: wb.max.z,
        top: wb.max.y, bottom: wb.min.y,
        climbable: climbable, // only let the player stand on top of low-ish props
      })

      if (barrel) {
        // Make explosive barrels glow a little so they read as hazards.
        scene.traverse((o) => {
          if (o.isMesh && o.material) {
            o.material = o.material.clone()
            o.material.emissive = new THREE.Color(0xff3a00)
            o.material.emissiveIntensity = 0.6
          }
        })
        const record = { group: scene, obstacle, x, z, radius: obstacle.radius, alive: true }
        scene.userData.barrel = record
        this.barrels.push(record)
      }
    }
    return scene
  }

  // Remove a barrel's mesh + collider after it explodes.
  removeBarrel(record) {
    record.alive = false
    this.scene.remove(record.group)
    const oi = this.obstacles.indexOf(record.obstacle)
    if (oi >= 0) this.obstacles.splice(oi, 1)
  }

  // Square clamp: keep a position inside the arena bounds.
  clampToArena(pos) {
    const max = this.arenaRadius - 1.5
    if (pos.x > max) pos.x = max
    else if (pos.x < -max) pos.x = -max
    if (pos.z > max) pos.z = max
    else if (pos.z < -max) pos.z = -max
    return pos
  }
}
