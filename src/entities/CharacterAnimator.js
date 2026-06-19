import * as THREE from 'three'

// Wraps an AnimationMixer and a set of named AnimationActions, with smooth
// crossfading between states. Built from a glTF's animation clips.
export class CharacterAnimator {
  constructor(root, clips) {
    this.mixer = new THREE.AnimationMixer(root)
    this.actions = {}
    for (const clip of clips) {
      this.actions[clip.name] = this.mixer.clipAction(clip)
    }
    this.current = null
  }

  has(name) {
    return !!this.actions[name]
  }

  // Crossfade to a clip. `once` plays it a single time (e.g. Death, HitReact).
  play(name, { fade = 0.2, once = false, timeScale = 1 } = {}) {
    const next = this.actions[name]
    if (!next || next === this.current) {
      if (next) next.timeScale = timeScale
      return
    }
    next.reset()
    next.timeScale = timeScale
    next.enabled = true
    if (once) {
      next.setLoop(THREE.LoopOnce, 1)
      next.clampWhenFinished = true
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity)
    }
    next.fadeIn(fade)
    if (this.current) this.current.fadeOut(fade)
    next.play()
    this.current = next
  }

  // Play a one-shot clip then return to a base clip (e.g. HitReact -> Idle).
  playOnceThen(name, baseName, { fade = 0.12 } = {}) {
    if (!this.has(name)) return
    this.play(name, { fade, once: true })
    const action = this.actions[name]
    const onFinished = (e) => {
      if (e.action === action) {
        this.mixer.removeEventListener('finished', onFinished)
        this.play(baseName, { fade })
      }
    }
    this.mixer.addEventListener('finished', onFinished)
  }

  update(dt) {
    this.mixer.update(dt)
  }
}

// Scale + ground a loaded model so it stands `targetHeight` units tall with its
// feet at y=0, centered on x/z. Returns the computed scale factor.
export function normalizeModel(root, targetHeight) {
  const box = new THREE.Box3().setFromObject(root)
  const size = new THREE.Vector3()
  box.getSize(size)
  const scale = targetHeight / (size.y || 1)
  root.scale.setScalar(scale)

  // Recompute after scaling to drop feet to ground and center horizontally.
  const box2 = new THREE.Box3().setFromObject(root)
  const center = new THREE.Vector3()
  box2.getCenter(center)
  root.position.x -= center.x
  root.position.z -= center.z
  root.position.y -= box2.min.y
  return scale
}
