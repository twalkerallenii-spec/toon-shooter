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

  // type: 'health' | 'medkit' | 'ammo' | 'shield' | 'bigshield'
  spawn(type, x, z) {
    // Custom OBJ/FBX pickup models (sized + tinted at load).
    const CUSTOM = {
      health: 'models/pickups/Health.fbx', medkit: 'models/pickups/Health.fbx',
      shield: 'models/pickups/Shield.fbx', bigshield: 'models/pickups/Shield.fbx',
      ammo: 'models/pickups/AmmoBox.obj',
    }
    const COLS = {
      health: [0x4ade80, 0x2a8a4a], medkit: [0xff5a8a, 0x9a2a4a],
      shield: [0x3da9fc, 0x2176c4], bigshield: [0xb06aff, 0x6a2ac4], ammo: [0xffcb3d, 0xb8901f],
    }
    const group = new THREE.Group()
    group.position.set(x, 0, z)
    this.world.scene.add(group)

    // Glow base ring so pickups are easy to spot.
    const [col, emi] = COLS[type] || [0xffcb3d, 0xb8901f]
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.05, 8, 24),
      new THREE.MeshStandardMaterial({ color: col, emissive: emi, emissiveIntensity: 1 })
    )
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.1
    group.add(ring)

    const item = { group, type, x, z, t: Math.random() * 6, ring }
    this.items.push(item)

    const path = CUSTOM[type] || 'models/pickups/AmmoBox.obj'
    this.assets.loadMesh(path).then((m) => {
      if (!m) return
      // Tint to the pickup colour (the source files ship without textures) and
      // make sure everything casts shadow + renders solid.
      m.scene.traverse((o) => {
        if (!o.isMesh) return
        o.castShadow = true
        o.material = new THREE.MeshStandardMaterial({ color: col, emissive: emi, emissiveIntensity: 0.25, roughness: 0.55, metalness: 0.15 })
      })
      // Auto-normalize size (OBJ/FBX come in wildly different units) to ~0.9u and
      // sit it on the ground, centred over the ring.
      const box = new THREE.Box3().setFromObject(m.scene)
      const size = new THREE.Vector3(); box.getSize(size)
      const s = 0.9 / (Math.max(size.x, size.y, size.z) || 1)
      m.scene.scale.setScalar(s)
      const box2 = new THREE.Box3().setFromObject(m.scene)
      const c = new THREE.Vector3(); box2.getCenter(c)
      m.scene.position.set(-c.x, 0.55 - box2.min.y, -c.z)
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
      new THREE.TorusGeometry(0.5, 0.05, 8, 24),
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
      m.scene.scale.setScalar(0.9 / (Math.max(sz.x, sz.y, sz.z) || 1))
      const spin = new THREE.Group(); spin.add(m.scene); spin.position.y = 0.7; group.add(spin)
      item.spin = spin
    })
  }

  // A loot chest. fall=true makes it parachute down (supply drop). Walk up to it
  // to open → it bursts into a weapon + a couple of consumables.
  spawnChest(x, z, fall = false) {
    const group = new THREE.Group()
    group.position.set(x, fall ? 34 : 0, z)
    this.world.scene.add(group)
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.8, 0.8),
      new THREE.MeshStandardMaterial({ color: 0xffcb3d, emissive: 0xb8901f, emissiveIntensity: 0.55, metalness: 0.45, roughness: 0.4 })
    )
    box.position.y = 0.5; box.castShadow = true; group.add(box)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.06, 8, 24), new THREE.MeshStandardMaterial({ color: 0xffe07a, emissive: 0xffb000, emissiveIntensity: 1 }))
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.06; group.add(ring)
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._iconTex('🎁'), transparent: true, depthWrite: false }))
    spr.scale.set(1.0, 1.0, 1); spr.position.y = 1.6; group.add(spr)
    let chute = null
    if (fall) {
      chute = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.8, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0xff5a5a, emissive: 0x551515, side: THREE.DoubleSide, roughness: 0.7 }))
      chute.position.y = 3.2; group.add(chute)
    }
    this.items.push({ group, type: 'chest', x, z, t: Math.random() * 6, fall, chute, ring })
  }

  _iconTex(ch) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 96
    const c = cv.getContext('2d'); c.font = '74px serif'; c.textAlign = 'center'; c.textBaseline = 'middle'
    c.fillText(ch, 48, 52)
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t
  }

  _openChest(it) {
    const x = it.group.position.x, z = it.group.position.z
    this.audio?.pickup?.()
    // A weapon + 2 consumables scattered around the chest.
    if (this.weaponDefs) {
      const pick = this.weaponDefs.map((d, i) => ({ index: i, model: d.model, key: d.key, secret: d.secret })).filter((d) => d.key !== 'Zip' && !d.secret)
      const d = pick[Math.floor(Math.random() * pick.length)]
      this.spawnWeapon(d, x + (Math.random() - 0.5) * 2, z + (Math.random() - 0.5) * 2)
    }
    const cons = ['shield', 'health', 'medkit', 'bigshield', 'ammo']
    for (let k = 0; k < 2; k++) {
      const t = cons[Math.floor(Math.random() * cons.length)]
      const a = Math.random() * Math.PI * 2
      this.spawn(t, x + Math.cos(a) * 1.7, z + Math.sin(a) * 1.7)
    }
    this.onPickup?.('chest')
  }

  // Scatter weapon loot across the map (Battle Royale).
  scatterWeapons(defs, count, half) {
    const pickable = defs.map((d, i) => ({ index: i, model: d.model, key: d.key, secret: d.secret })).filter((d) => d.key !== 'Zip' && !d.secret)
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
      // Loot chests (incl. parachuting supply drops).
      if (it.type === 'chest') {
        it.t += dt
        it.ring.rotation.z += dt * 1.2
        if (it.fall) {
          it.group.position.y = Math.max(0, it.group.position.y - 7 * dt)
          it.group.rotation.y += dt * 0.5
          if (it.group.position.y <= 0.02) { it.fall = false; if (it.chute) { it.group.remove(it.chute); it.chute.geometry.dispose(); it.chute.material.dispose(); it.chute = null } this.audio?.pickup?.() }
          continue
        }
        it.group.position.y = Math.sin(it.t * 2) * 0.1
        it.group.rotation.y += dt * 0.7
        if (player.alive && Math.hypot(player.position.x - it.x, player.position.z - it.z) < 2.4) {
          this._openChest(it); this._remove(i)
        }
        continue
      }
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
        } else if (it.type === 'medkit' && player.hp < player.maxHp) {
          player.hp = player.maxHp; took = true // full heal
        } else if (it.type === 'shield' && player.shield < 100) {
          player.shield = Math.min(100, player.shield + 50); took = true
        } else if (it.type === 'bigshield' && player.shield < 100) {
          player.shield = 100; took = true // full shield
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
