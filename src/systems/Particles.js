import * as THREE from 'three'

// Lightweight GPU particle system: a single THREE.Points cloud with a fixed
// pool, soft additive sprites, per-particle color/alpha/size, gravity and drag.
// The sprite texture is generated procedurally (canvas radial gradient) so no
// external image files are required.
export class Particles {
  constructor(scene, max = 1400) {
    this.max = max
    this.cursor = 0

    this.pos = new Float32Array(max * 3)
    this.vel = new Float32Array(max * 3)
    this.col = new Float32Array(max * 3)
    this.alpha = new Float32Array(max)
    this.size = new Float32Array(max)
    this.life = new Float32Array(max)
    this.maxLife = new Float32Array(max)
    this.grav = new Float32Array(max)
    this.drag = new Float32Array(max)

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3))
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1))
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1))
    this.geo = geo

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: makeSprite() }, uScale: { value: 520 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aAlpha;
        attribute float aSize;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (uScale / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uTex;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.001) discard;
          vec4 t = texture2D(uTex, gl_PointCoord);
          gl_FragColor = vec4(vColor, vAlpha) * t;
        }`,
    })

    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 5
    scene.add(this.points)
  }

  // Emit `count` particles from `origin`. opts:
  //   color [r,g,b] 0..1 | speed | spread (extra random vel) | size | life
  //   gravity | drag | up (bias velocity upward)
  emit(origin, count, opts = {}) {
    const color = opts.color || [1, 0.7, 0.2]
    const speed = opts.speed ?? 6
    const spread = opts.spread ?? speed
    const size = opts.size ?? 1.2
    const life = opts.life ?? 0.6
    const gravity = opts.gravity ?? -6
    const drag = opts.drag ?? 2.5
    const up = opts.up ?? 0

    for (let n = 0; n < count; n++) {
      const i = this.cursor
      this.cursor = (this.cursor + 1) % this.max
      const i3 = i * 3
      this.pos[i3] = origin.x
      this.pos[i3 + 1] = origin.y
      this.pos[i3 + 2] = origin.z
      // Random direction in a sphere.
      const dx = Math.random() * 2 - 1
      const dy = Math.random() * 2 - 1
      const dz = Math.random() * 2 - 1
      const inv = 1 / (Math.hypot(dx, dy, dz) || 1)
      const s = speed + (Math.random() - 0.5) * spread
      this.vel[i3] = dx * inv * s
      this.vel[i3 + 1] = dy * inv * s + up
      this.vel[i3 + 2] = dz * inv * s
      this.col[i3] = color[0]
      this.col[i3 + 1] = color[1]
      this.col[i3 + 2] = color[2]
      const lf = life * (0.7 + Math.random() * 0.6)
      this.life[i] = lf
      this.maxLife[i] = lf
      this.alpha[i] = 1
      this.size[i] = size * (0.7 + Math.random() * 0.6)
      this.grav[i] = gravity
      this.drag[i] = drag
    }
  }

  update(dt) {
    const { pos, vel, alpha, life, maxLife, grav, drag, size } = this
    for (let i = 0; i < this.max; i++) {
      if (alpha[i] <= 0) continue
      life[i] -= dt
      if (life[i] <= 0) { alpha[i] = 0; continue }
      const i3 = i * 3
      const d = Math.max(0, 1 - drag[i] * dt)
      vel[i3] *= d
      vel[i3 + 1] = vel[i3 + 1] * d + grav[i] * dt
      vel[i3 + 2] *= d
      pos[i3] += vel[i3] * dt
      pos[i3 + 1] += vel[i3 + 1] * dt
      pos[i3 + 2] += vel[i3 + 2] * dt
      const k = life[i] / maxLife[i]
      alpha[i] = k
      size[i] += dt * 1.5 // grow slightly as they fade (smoke puff feel)
    }
    this.geo.attributes.position.needsUpdate = true
    this.geo.attributes.aColor.needsUpdate = true
    this.geo.attributes.aAlpha.needsUpdate = true
    this.geo.attributes.aSize.needsUpdate = true
  }
}

// Soft round particle sprite via a canvas radial gradient.
function makeSprite() {
  const s = 64
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const ctx = cv.getContext('2d')
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.3, 'rgba(255,255,255,0.85)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
