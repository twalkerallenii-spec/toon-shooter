// Procedural sound effects via the Web Audio API — no audio files needed.
// All sounds are synthesized from oscillators + filtered noise envelopes.
export class Audio {
  constructor() {
    this.ctx = null
    this.master = null
    this.enabled = true
    this._lastHurt = 0
  }

  // Must be called from a user gesture (e.g. the PLAY click) to unlock audio.
  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) { this.enabled = false; return }
      this.ctx = new AC()
      this.master = this.ctx.createGain()
      this.master.gain.value = this._vol ?? 0.5
      this.master.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') this.ctx.resume()
  }

  setVolume(v) { this._vol = v; if (this.master) this.master.gain.value = v }

  get t() { return this.ctx.currentTime }

  _noiseBuffer(dur) {
    const n = Math.floor(this.ctx.sampleRate * dur)
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
    return buf
  }

  _noise(dur, { gain = 0.5, type = 'lowpass', freq = 1800, q = 1 } = {}) {
    if (!this.ctx) return
    const src = this.ctx.createBufferSource()
    src.buffer = this._noiseBuffer(dur)
    const filt = this.ctx.createBiquadFilter()
    filt.type = type; filt.frequency.value = freq; filt.Q.value = q
    const g = this.ctx.createGain()
    const t = this.t
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
    src.connect(filt); filt.connect(g); g.connect(this.master)
    src.start(t); src.stop(t + dur)
  }

  _tone(freq, dur, { gain = 0.3, type = 'square', to = null } = {}) {
    if (!this.ctx) return
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    const t = this.t
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur)
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
    osc.connect(g); g.connect(this.master)
    osc.start(t); osc.stop(t + dur)
  }

  // ---- Game sounds -------------------------------------------------------
  shoot(weapon = 'AK') {
    if (!this.ctx) return
    const cfg = {
      Pistol:  { d: 0.10, f: 2200, g: 0.45 },
      AK:      { d: 0.12, f: 1600, g: 0.5 },
      SMG:     { d: 0.08, f: 2000, g: 0.4 },
      Shotgun: { d: 0.22, f: 1100, g: 0.6 },
      Sniper:  { d: 0.30, f: 900,  g: 0.65 },
    }[weapon] || { d: 0.12, f: 1600, g: 0.5 }
    this._noise(cfg.d, { gain: cfg.g, freq: cfg.f, q: 0.8 })
    this._tone(cfg.f * 0.5, cfg.d * 0.6, { gain: cfg.g * 0.5, type: 'sawtooth', to: cfg.f * 0.18 })
  }

  reload() {
    this._tone(420, 0.05, { gain: 0.25, type: 'square' })
    setTimeout(() => this._tone(300, 0.06, { gain: 0.25, type: 'square' }), 180)
    setTimeout(() => this._tone(520, 0.05, { gain: 0.22, type: 'square' }), 380)
  }

  explosion() {
    this._noise(0.6, { gain: 0.8, freq: 600, q: 0.5 })
    this._tone(140, 0.55, { gain: 0.6, type: 'sine', to: 40 })
  }

  hit() { this._tone(1500, 0.04, { gain: 0.18, type: 'square' }) }
  kill() {
    this._tone(900, 0.08, { gain: 0.25, type: 'square', to: 1500 })
    setTimeout(() => this._tone(1400, 0.07, { gain: 0.2, type: 'square' }), 60)
  }
  pickup() {
    this._tone(700, 0.08, { gain: 0.3, type: 'triangle', to: 1100 })
    setTimeout(() => this._tone(1100, 0.1, { gain: 0.3, type: 'triangle', to: 1500 }), 70)
  }
  jumpPad() { this._tone(300, 0.18, { gain: 0.3, type: 'sine', to: 900 }) }
  hurt() {
    const now = performance.now()
    if (now - this._lastHurt < 150) return
    this._lastHurt = now
    this._noise(0.12, { gain: 0.4, freq: 500, q: 0.6 })
    this._tone(180, 0.12, { gain: 0.3, type: 'sawtooth', to: 90 })
  }
}
