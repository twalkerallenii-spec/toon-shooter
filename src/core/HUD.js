// Thin wrapper around the DOM HUD elements declared in index.html.
export class HUD {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      crosshair: document.getElementById('crosshair'),
      hpFill: document.getElementById('hp-fill'),
      score: document.getElementById('score'),
      wave: document.getElementById('wave'),
      ammo: document.getElementById('ammo'),
      ammoMax: document.getElementById('ammo-max'),
      reloadHint: document.getElementById('reload-hint'),
      overlay: document.getElementById('overlay'),
      overlayMsg: document.getElementById('overlay-msg'),
      startBtn: document.getElementById('start-btn'),
    }
  }

  show() { this.el.hud.classList.remove('hidden') }
  hide() { this.el.hud.classList.add('hidden') }

  setHp(hp, maxHp) {
    const k = Math.max(0, hp / maxHp)
    this.el.hpFill.style.width = `${k * 100}%`
    this.el.hpFill.style.background = k < 0.3 ? 'var(--hp-low)' : 'var(--hp)'
  }

  setScore(v) { this.el.score.textContent = v }
  setWave(v) { this.el.wave.textContent = v }

  setAmmo(ammo, max) {
    this.el.ammo.textContent = ammo
    this.el.ammoMax.textContent = max
  }

  setReloading(on) {
    this.el.reloadHint.classList.toggle('hidden', !on)
  }

  // Dynamic reticle bloom: 0 = tight, larger = wider gap. Smoothed toward target.
  setCrosshairSpread(extra) {
    const base = 7
    this._spread = (this._spread ?? base)
    const target = base + Math.max(0, extra)
    this._spread += (target - this._spread) * 0.35 // ease toward target
    this.el.crosshair.style.setProperty('--gap', `${this._spread.toFixed(1)}px`)
  }

  // Flash the X hitmarker. isKill makes it red + a touch longer.
  hitMarker(isKill) {
    const ch = this.el.crosshair
    const cls = isKill ? 'kill' : 'hit'
    ch.classList.remove('hit', 'kill')
    // Force reflow so the animation restarts even on rapid consecutive hits.
    void ch.offsetWidth
    ch.classList.add(cls)
  }

  showOverlay(msg, buttonLabel = 'PLAY') {
    this.el.overlayMsg.textContent = msg
    this.el.startBtn.textContent = buttonLabel
    this.el.overlay.classList.remove('hidden')
  }

  hideOverlay() {
    this.el.overlay.classList.add('hidden')
  }
}
