import * as THREE from 'three'

// Capture-the-Flag visuals + state. Two flags (red, blue) whose positions are
// driven by the authoritative server state (home / dropped / carried). The Game
// handles the interaction logic; this just renders and exposes positions.
export class Flags {
  constructor(world) {
    this.world = world
    this.state = null // server ctf.flags: { red:{state,holder,x,z}, blue:{...} }
    this.flags = {
      red: makeFlag(0xff3b3b),
      blue: makeFlag(0x3b7bff),
    }
    world.scene.add(this.flags.red, this.flags.blue)
    this._t = 0
  }

  setState(ctf) {
    if (ctf?.flags) this.state = ctf.flags
  }

  baseOf(team) {
    return this.world.bases.find((b) => b.team === team)
  }

  // Position both flags each frame. ctx = { localId, localPos, remotePlayers }.
  update(dt, ctx) {
    this._t += dt
    for (const team of ['red', 'blue']) {
      const mesh = this.flags[team]
      const f = this.state?.[team]
      const base = this.baseOf(team)
      let x = base ? base.x : 0, y = 0, z = base ? base.z : 0
      if (f) {
        if (f.state === 'dropped') { x = f.x; z = f.z }
        else if (f.state === 'carried') {
          if (f.holder === ctx.localId) { x = ctx.localPos.x; y = 0.2; z = ctx.localPos.z }
          else {
            const rp = ctx.remotePlayers?.get(f.holder)
            if (rp) { x = rp.group.position.x; y = 0.2; z = rp.group.position.z }
          }
        }
      }
      mesh.position.set(x, y, z)
      mesh.rotation.y = this._t * 1.2 // gentle spin so it's easy to spot
    }
  }

  dispose() {
    for (const m of [this.flags.red, this.flags.blue]) {
      this.world.scene.remove(m)
      m.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.() })
    }
  }
}

function makeFlag(color) {
  const g = new THREE.Group()
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 3.2, 8),
    new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 })
  )
  pole.position.y = 1.6
  pole.castShadow = true
  g.add(pole)
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 0.8),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, side: THREE.DoubleSide, roughness: 0.6 })
  )
  banner.position.set(0.72, 2.7, 0)
  banner.castShadow = true
  g.add(banner)
  // Glow ring at the base so it's visible from afar.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.6, 0.07, 8, 20),
    new THREE.MeshBasicMaterial({ color })
  )
  ring.rotation.x = Math.PI / 2
  ring.position.y = 0.07
  g.add(ring)
  return g
}
