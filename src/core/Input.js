// Centralized keyboard + mouse input with pointer-lock support.
export class Input {
  constructor(domElement) {
    this.dom = domElement
    this.keys = new Set()
    this.mouse = { dx: 0, dy: 0, down: false }
    this.locked = false

    this._onKeyDown = (e) => {
      this.keys.add(e.code)
      // Prevent the page from scrolling on space, etc.
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault()
    }
    this._onKeyUp = (e) => this.keys.delete(e.code)
    this._onMouseMove = (e) => {
      if (!this.locked) return
      this.mouse.dx += e.movementX
      this.mouse.dy += e.movementY
    }
    this._onMouseDown = (e) => { if (e.button === 0) this.mouse.down = true }
    this._onMouseUp = (e) => { if (e.button === 0) this.mouse.down = false }
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.dom
      if (this.onLockChange) this.onLockChange(this.locked)
    }

    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
    window.addEventListener('mousemove', this._onMouseMove)
    window.addEventListener('mousedown', this._onMouseDown)
    window.addEventListener('mouseup', this._onMouseUp)
    document.addEventListener('pointerlockchange', this._onLockChange)
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
