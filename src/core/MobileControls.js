// On-screen touch controls for phones/tablets: a left analog move-stick, a
// right-side look-drag area, and action buttons. Everything writes into the same
// Input fields the desktop controls use, so the rest of the game is unchanged.
export class MobileControls {
  constructor(input) {
    this.input = input
    this.joyId = null
    this.lookId = null
    this.lookLast = { x: 0, y: 0 }
    this.lookSpeed = 1.4 // touch drag -> look multiplier

    this.root = document.createElement('div')
    this.root.id = 'mobile-controls'
    this.root.innerHTML = `
      <div id="m-joy"><div id="m-knob"></div></div>
      <div id="m-buttons">
        <button class="m-btn m-small" data-act="swap">⇆</button>
        <button class="m-btn m-small" data-act="reload">R</button>
        <button class="m-btn m-small" data-act="nade">✸</button>
        <button class="m-btn m-small" data-act="sprint">⏵⏵</button>
        <button class="m-btn m-small" data-act="car">🚗</button>
        <button class="m-btn" data-act="ads">AIM</button>
        <button class="m-btn m-fire" data-act="fire">FIRE</button>
        <button class="m-btn m-jump" data-act="jump">JUMP</button>
      </div>
    `
    document.body.appendChild(this.root)
    this.joy = this.root.querySelector('#m-joy')
    this.knob = this.root.querySelector('#m-knob')

    this._bindJoystick()
    this._bindLook()
    this._bindButtons()
  }

  _bindJoystick() {
    const radius = 55
    const onMove = (e) => {
      if (this.joyId === null) return
      const t = [...e.touches || [e]].find((x) => x.identifier === this.joyId) || e
      const dx = t.clientX - this.joyOrigin.x
      const dy = t.clientY - this.joyOrigin.y
      const len = Math.hypot(dx, dy) || 1
      const cl = Math.min(len, radius)
      const nx = (dx / len), ny = (dy / len)
      this.knob.style.transform = `translate(${nx * cl}px, ${ny * cl}px)`
      // Screen down (+y) = backward.
      this.input.touchMove.x = nx * (cl / radius)
      this.input.touchMove.y = -ny * (cl / radius)
    }
    const onEnd = () => {
      this.joyId = null
      this.input.touchMove.x = 0; this.input.touchMove.y = 0
      this.knob.style.transform = 'translate(0,0)'
    }
    this.joy.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0]
      this.joyId = t.identifier
      this.joyOrigin = { x: t.clientX, y: t.clientY }
      e.preventDefault()
    }, { passive: false })
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', (e) => {
      if ([...e.changedTouches].some((t) => t.identifier === this.joyId)) onEnd()
    })
  }

  _bindLook() {
    const isControl = (el) => el.closest('#m-joy, #m-buttons')
    window.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (this.lookId !== null) continue
        if (isControl(t.target)) continue
        if (t.clientX < window.innerWidth * 0.35) continue // left third is movement
        this.lookId = t.identifier
        this.lookLast = { x: t.clientX, y: t.clientY }
      }
    }, { passive: true })
    window.addEventListener('touchmove', (e) => {
      for (const t of e.touches) {
        if (t.identifier !== this.lookId) continue
        this.input.mouse.dx += (t.clientX - this.lookLast.x) * this.lookSpeed
        this.input.mouse.dy += (t.clientY - this.lookLast.y) * this.lookSpeed
        this.lookLast = { x: t.clientX, y: t.clientY }
      }
    }, { passive: true })
    window.addEventListener('touchend', (e) => {
      if ([...e.changedTouches].some((t) => t.identifier === this.lookId)) this.lookId = null
    })
  }

  _bindButtons() {
    const press = (act, down) => {
      const k = this.input.keys
      switch (act) {
        case 'fire': this.input.mouse.down = down; if (down) this.input._clicked = true; break
        case 'ads': this.input.mouse.right = down; break
        case 'jump': down ? k.add('Space') : k.delete('Space'); break
        case 'reload': down ? k.add('KeyR') : k.delete('KeyR'); break
        case 'nade': down ? k.add('KeyG') : k.delete('KeyG'); break
        case 'sprint': down ? k.add('ShiftLeft') : k.delete('ShiftLeft'); break
        case 'car': down ? k.add('KeyE') : k.delete('KeyE'); break
        case 'swap': if (down) this.input._wheel += 1; break
      }
    }
    this.root.querySelectorAll('.m-btn').forEach((btn) => {
      const act = btn.dataset.act
      btn.addEventListener('touchstart', (e) => { e.preventDefault(); btn.classList.add('on'); press(act, true) }, { passive: false })
      btn.addEventListener('touchend', (e) => { e.preventDefault(); btn.classList.remove('on'); press(act, false) }, { passive: false })
    })
  }

  show(on) { this.root.style.display = on ? 'block' : 'none' }
}
