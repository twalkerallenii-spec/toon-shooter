// Client-side networking for multiplayer. Connects to the relay server, sends the
// local player's state (throttled) and shoot events, and surfaces peer events via
// callbacks. Transport is a plain WebSocket so it works with any host.
export class Net {
  constructor({ url, name, room, mode = 'coop', handlers = {} }) {
    this.url = url
    this.name = name
    this.room = room
    this.mode = mode
    this.handlers = handlers
    this.id = null
    this.connected = false
    this._lastStateSent = 0
    this._stateInterval = 50 // ms (~20 Hz)

    this.ws = new WebSocket(url)
    this.ws.addEventListener('open', () => {
      this._send({ t: 'join', name, room, mode })
    })
    this.ws.addEventListener('message', (e) => this._onMessage(e))
    this.ws.addEventListener('close', () => {
      this.connected = false
      this.handlers.onClose?.()
    })
    this.ws.addEventListener('error', () => this.handlers.onError?.())
  }

  _send(msg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  _onMessage(e) {
    let msg
    try { msg = JSON.parse(e.data) } catch { return }
    switch (msg.t) {
      case 'welcome':
        this.id = msg.id
        this.team = msg.team
        this.connected = true
        this.handlers.onWelcome?.(msg.id, msg.peers || [], msg.team)
        this.handlers.onAdmin?.(!!msg.admin)
        if (msg.ctf) this.handlers.onCtf?.(msg.ctf)
        break
      case 'peerJoin': this.handlers.onPeerJoin?.(msg.id, msg.name, msg.team); break
      case 'peerLeave': this.handlers.onPeerLeave?.(msg.id); break
      case 'state': this.handlers.onState?.(msg.id, msg.p); break
      case 'shoot': this.handlers.onShoot?.(msg.id, msg.from, msg.to); break
      case 'hit': this.handlers.onHit?.(msg.from, msg.dmg); break
      case 'killed': this.handlers.onKilled?.(msg.by, msg.victim); break
      case 'votes': this.handlers.onVotes?.(msg.tally); break
      case 'mapChange': this.handlers.onMapChange?.(msg.map); break
      case 'ctf': this.handlers.onCtf?.(msg.ctf); break
      case 'win': this.handlers.onWin?.(msg); break
      case 'chat': this.handlers.onChat?.(msg.id, msg.name, msg.text, msg.p); break
      case 'presence': this.handlers.onPresence?.(msg.list); break
      case 'fx': this.handlers.onFx?.(msg.id, msg.name, msg.fx); break
      case 'kicked': this.handlers.onKicked?.(msg.reason); break
      case 'admin': this.handlers.onAdmin?.(msg.value); break
      case 'rtc': this.handlers.onRtc?.(msg.from, msg.data); break
    }
  }

  // Throttled local-state broadcast.
  sendState(p, nowMs) {
    if (!this.connected) return
    if (nowMs - this._lastStateSent < this._stateInterval) return
    this._lastStateSent = nowMs
    this._send({ t: 'state', p })
  }

  sendShoot(from, to) {
    if (this.connected) this._send({ t: 'shoot', from, to })
  }

  sendHit(targetId, dmg) {
    if (this.connected) this._send({ t: 'hit', target: targetId, dmg })
  }

  sendKilled(byId) {
    if (this.connected) this._send({ t: 'killed', by: byId })
  }

  sendVote(map) {
    if (this.connected) this._send({ t: 'vote', map })
  }

  sendChat(text) {
    if (this.connected) this._send({ t: 'chat', text })
  }

  sendFx(fx) {
    if (this.connected) this._send({ t: 'fx', fx })
  }

  sendRtc(to, data) {
    if (this.connected) this._send({ t: 'rtc', to, data })
  }

  // Capture the Flag events.
  sendFlagTake(flag) { if (this.connected) this._send({ t: 'flagTake', flag }) }
  sendFlagDrop(flag, x, z) { if (this.connected) this._send({ t: 'flagDrop', flag, x, z }) }
  sendFlagReturn(flag) { if (this.connected) this._send({ t: 'flagReturn', flag }) }
  sendFlagCapture(flag) { if (this.connected) this._send({ t: 'flagCapture', flag }) }

  close() {
    try { this.ws.close() } catch {}
  }
}
