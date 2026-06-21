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

  // type: 'health' | 'ammo' | 'shield'
  spawn(type, x, z) {
    const model = type === 'health' ? 'Health' : type === 'shield' ? 'GasTank' : 'GasCan'
    const group = new THREE.Group()
    group.position.set(x, 0, z)
    this.world.scene.add(group)

    // Glow base ring so pickups are easy to spot.
    const col = type === 'health' ? 0x4ade80 : type === 'shield' ? 0x3da9fc : 0xffcb3d
    const emi = type === 'health' ? 0x2a8a4a : type === 'shield' ? 0x2176c4 : 0xb8901f
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.7, 0.07, 8, 24),
      new THREE.MeshStandardMaterial({ color: col, emissive: emi, emissiveIntensity: 1 })
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

  // A floating weapon pickup (Battle Royale loot). def = { index, model, key }.
  spawnWeapon(def, x, z) {
    const group = new THREE.Group()
    group.position.set(x, 0, z)
    this.world.scene.add(group)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.8, 0.07, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0x9ad0ff, emissive: 0x2a6cff, emissiveIntensity: 1 })
    )
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.1
    group.add(ring)
    const item = { group, type: 'weapon', wIndex: def.index, x, z, t: Math.random() * 6, ring }
    this.items.push(item)
    this.assets.loadModel(`models/guns/${def.model}.gltf`).then((m) => {
      if (!m) return
      m.scene.traverse((o) => { if (o.isMesh) o.castShadow = true })
      const box = new THREE.Box3().setFromObject(m.scene); const sz = new THREE.Vector3(); box.getSize(sz)
      m.scene.scale.setScalar(1.8 / (Math.max(sz.x, sz.y, sz.z) || 1))
      const spin = new THREE.Group(); spin.add(m.scene); spin.position.y = 1.1; group.add(spin)
      item.spin = spin
    })
  }

  // Scatter weapon loot across the map (Battle Royale).
  scatterWeapons(defs, count, half) {
    const pickable = defs.map((d, i) => ({ index: i, model: d.model, key: d.key })).filter((d) => d.key !== 'Zip')
    for (let i = 0; i < count; i++) {
      const d = pickable[Math.floor(Math.random() * pickable.length)]
      const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * (half - 12)
      this.spawnWeapon(d, Math.cos(a) * r, Math.sin(a) * r)
    }
  }

  // Roll for a drop at a kill location.
  rollDrop(x, z) {
    const r = Math.random()
    if (r < 0.16) this.spawn('health', x, z)
    else if (r < 0.30) this.spawn('ammo', x, z)
    else if (r < 0.40) this.spawn('shield', x, z)
  }

  update(dt, player, weapons) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      it.t += dt
      const bob = Math.sin(it.t * 2) * 0.15
      if (it.spin) { it.spin.rotation.y += dt * 1.6; it.spin.position.y = bob }
      it.ring.rotation.z += dt * 1.2

      const d = Math.hypot(player.position.x - it.x, player.position.z - it.z)
      if (d < 1.6 && player.alive) {
        let took = false
        if (it.type === 'health' && player.hp < player.maxHp) {
          player.hp = Math.min(player.maxHp, player.hp + 35); took = true
        } else if (it.type === 'ammo') {
          weapons.ammoByWeapon = weapons.defs.map((wd) => wd.mag); took = true
        } else if (it.type === 'weapon') {
          weapons.give(it.wIndex); took = true
        } else if (it.type === 'shield' && player.shield < 100) {
          player.shield = Math.min(100, player.shield + 50); took = true
        }
        if (took) {
          this.audio?.pickup()
          this.onPickup?.(it.type, it.wIndex)
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
