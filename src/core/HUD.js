// Thin wrapper around the DOM HUD elements declared in index.html.
export class HUD {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
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

  showOverlay(msg, buttonLabel = 'PLAY') {
    this.el.overlayMsg.textContent = msg
    this.el.startBtn.textContent = buttonLabel
    this.el.overlay.classList.remove('hidden')
  }

  hideOverlay() {
    this.el.overlay.classList.add('hidden')
  }
}
