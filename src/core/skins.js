import * as THREE from 'three'

// Locker skins: 3 rigged kit characters + animated recolor variants. `base` is
// the real model file; `tint` recolors its materials (null = original look).
export const SKINS = [
  { id: 'Character_Soldier', base: 'Character_Soldier', label: 'Soldier', ico: '🪖', tint: null },
  { id: 'Character_Hazmat', base: 'Character_Hazmat', label: 'Hazmat', ico: '☣️', tint: null },
  { id: 'Character_Enemy', base: 'Character_Enemy', label: 'Alien', ico: '👽', tint: null },
  { id: 'Soldier_Red', base: 'Character_Soldier', label: 'Red Ops', ico: '🟥', tint: 0xff5a5a },
  { id: 'Soldier_Gold', base: 'Character_Soldier', label: 'Gold Elite', ico: '🟨', tint: 0xffd24a },
  { id: 'Soldier_Shadow', base: 'Character_Soldier', label: 'Shadow', ico: '⬛', tint: 0x586079 },
  { id: 'Soldier_Arctic', base: 'Character_Soldier', label: 'Arctic', ico: '🟦', tint: 0x9fd0ff },
  { id: 'Hazmat_Toxic', base: 'Character_Hazmat', label: 'Toxic', ico: '🟩', tint: 0x7cff5a },
  { id: 'Hazmat_Crimson', base: 'Character_Hazmat', label: 'Crimson', ico: '🩸', tint: 0xd42a3a },
  { id: 'Alien_Frost', base: 'Character_Enemy', label: 'Frost', ico: '❄️', tint: 0x8ad8ff },
  { id: 'Alien_Magma', base: 'Character_Enemy', label: 'Magma', ico: '🔥', tint: 0xff7a3a },
  { id: 'Alien_Void', base: 'Character_Enemy', label: 'Void', ico: '🟪', tint: 0xb06aff },
]

export const skinOf = (id) => SKINS.find((s) => s.id === id) || SKINS[0]

// Recolor a freshly-cloned model in place (clones materials so the cache is safe).
export function applyTint(scene, tint) {
  if (!scene || tint == null) return
  const c = new THREE.Color(tint)
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    const cloned = mats.map((m) => { const n = m.clone(); n.color?.copy?.(c); return n })
    o.material = Array.isArray(o.material) ? cloned : cloned[0]
  })
}
