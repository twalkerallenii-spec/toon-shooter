// Centralized keyboard + mouse input with pointer-lock support.
export class Input {
  constructor(domElement) {
    this.dom = domElement
    this.keys = new Set()
    this.mouse = { dx: 0, dy: 0, down: false, right: false }
    this.locked = false
    this._clicked = false  // left-button press edge (for semi-auto)
    this._wheel = 0        // accumulated wheel steps (-1/+1)

    // Touch / mobile: a virtual move stick written by MobileControls, plus a flag
    // so the game skips pointer-lock on phones.
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window
    this.touchMove = { x: 0, y: 0 } // x = strafe, y = forward (-1..1)

    this._onKeyDown = (e) => {
      // Ignore game keys while typing in a text field (chat, name, etc.).
      const ae = document.activeElement
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return
      this.keys.add(e.code)
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault()
    }
    this._onKeyUp = (e) => this.keys.delete(e.code)
    this._onMouseMove = (e) => {
      if (!this.locked) return
      this.mouse.dx += e.movementX
      this.mouse.dy += e.movementY
    }
    this._onMouseDown = (e) => {
      if (e.button === 0) { this.mouse.down = true; this._clicked = true }
      if (e.button === 2) this.mouse.right = true
    }
    this._onMouseUp = (e) => {
      if (e.button === 0) this.mouse.down = false
      if (e.button === 2) this.mouse.right = false
    }
    this._onWheel = (e) => { this._wheel += Math.sign(e.deltaY) }
    this._onContextMenu = (e) => e.preventDefault() // don't show menu on right-click
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.dom
      if (this.onLockChange) this.onLockChange(this.locked)
    }

    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
    window.addEventListener('mousemove', this._onMouseMove)
    window.addEventListener('mousedown', this._onMouseDown)
    window.addEventListener('mouseup', this._onMouseUp)
    window.addEventListener('wheel', this._onWheel, { passive: true })
    window.addEventListener('contextmenu', this._onContextMenu)
    document.addEventListener('pointerlockchange', this._onLockChange)
  }

  // True once per physical left-click (consumed). Used for semi-auto weapons.
  consumeClick() {
    const c = this._clicked
    this._clicked = false
    return c
  }

  // Returns accumulated wheel direction since last call (-1, 0, or +1+), cleared.
  consumeWheel() {
    const w = this._wheel
    this._wheel = 0
    return w
  }

  requestLock() {
    this.dom.requestPointerLock?.()
  }

  exitLock() {
    document.exitPointerLock?.()
  }

  isDown(code) {
    return this.keys.has(code)
  }

  // Read & clear accumulated mouse movement for this frame.
  consumeMouseDelta() {
    const d = { dx: this.mouse.dx, dy: this.mouse.dy }
    this.mouse.dx = 0
    this.mouse.dy = 0
    return d
  }
}
