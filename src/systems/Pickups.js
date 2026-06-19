import * as THREE from 'three'

// Floating, spinning health/ammo pickups. Spawn from kills or placed on the map;
// collected by walking over them.
export class Pickups {
  constructor({ world, assets, audio }) {
    this.world = world
    this.assets = assets
    this.audio = audio
    this.items = [] // { group, type, x, z, t }
  }

  // type: 'health' | 'ammo'
  spawn(type, x, z) {
    const model = type === 'health' ? 'Health' : 'GasCan'
    const group = new THREE.Group()
    group.position.set(x, 0, z)
    this.world.scene.add(group)

    // Glow base ring so pickups are easy to spot.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.7, 0.07, 8, 24),
      new THREE.MeshStandardMaterial({
        color: type === 'health' ? 0x4ade80 : 0xffcb3d,
        emissive: type === 'health' ? 0x2a8a4a : 0xb8901f, emissiveIntensity: 1,
      })
    )
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.1
    group.add(ring)

    const item = { group, type, x, z, t: Math.random() * 6, ring }
    this.items.push(item)

    this.assets.loadModel(`models/env/${model}.gltf`).then((m) => {
      if (!m) return
      m.scene.traverse((o) => { if (o.isMesh) o.castShadow = true })
      const box = new THREE.Box3().setFromObject(m.scene)
      const size = new THREE.Vector3(); box.getSize(size)
      const s = 1.4 / (Math.max(size.x, size.y, size.z) || 1)
      m.scene.scale.setScalar(s)
      const box2 = new THREE.Box3().setFromObject(m.scene)
      const c = new THREE.Vector3(); box2.getCenter(c)
      m.scene.position.set(-c.x, 1.1 - box2.min.y, -c.z)
      const spin = new THREE.Group()
      spin.add(m.scene)
      group.add(spin)
      item.spin = spin
    })
  }

  // Roll for a drop at a kill location.
  rollDrop(x, z) {
    const r = Math.random()
    if (r < 0.16) this.spawn('health', x, z)
    else if (r < 0.34) this.spawn('ammo', x, z)
  }

  update(dt, player, weapons) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      it.t += dt
      const bob = Math.sin(it.t * 2) * 0.15
      if (it.spin) { it.spin.rotation.y += dt * 1.6; it.spin.position.y = bob }
      it.ring.rotation.z += dt * 1.2

      const d = Math.hypot(player.position.x - it.x, player.position.z - it.z)
      if (d < 1.4 && player.alive) {
        let took = false
        if (it.type === 'health' && player.hp < player.maxHp) {
          player.hp = Math.min(player.maxHp, player.hp + 35); took = true
        } else if (it.type === 'ammo') {
          weapons.ammoByWeapon = weapons.defs.map((wd) => wd.mag); took = true
        }
        if (took) {
          this.audio?.pickup()
          this._remove(i)
        }
      }
    }
  }

  _remove(i) {
    const it = this.items[i]
    this.world.scene.remove(it.group)
    it.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.() })
    this.items.splice(i, 1)
  }
}
