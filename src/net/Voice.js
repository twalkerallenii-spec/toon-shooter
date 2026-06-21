// Proximity voice chat over WebRTC. Each pair of players who have voice enabled
// forms a peer connection (lower id is the offerer to avoid glare); the remote
// audio plays through a per-peer <audio> element whose volume is set each frame
// from the distance between the two players. Signalling rides the relay's 'rtc'
// messages. Best-effort P2P with a public STUN server (no TURN).
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
const MAX_DIST = 55 // metres at which a voice fades to silence

export class Voice {
  constructor(net) {
    this.net = net
    this.on = false
    this.localStream = null
    this.peers = new Map() // peerId -> { pc, audioEl }
  }

  get enabled() { return this.on }

  async toggle() { return this.on ? (this.disable(), false) : this.enable() }

  async enable() {
    if (this.on) return true
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      this.on = true
      return true
    } catch (e) {
      console.warn('[voice] mic denied/unavailable', e?.message)
      return false
    }
  }

  disable() {
    this.on = false
    this.localStream?.getTracks().forEach((t) => t.stop())
    this.localStream = null
    for (const id of [...this.peers.keys()]) this._close(id)
  }

  _close(id) {
    const p = this.peers.get(id)
    if (!p) return
    try { p.pc.close() } catch {}
    p.audioEl?.remove()
    this.peers.delete(id)
  }

  _create(id, initiator) {
    if (this.peers.has(id)) return this.peers.get(id)
    const pc = new RTCPeerConnection(ICE)
    const audioEl = document.createElement('audio')
    audioEl.autoplay = true; audioEl.dataset.voice = String(id); audioEl.volume = 0
    document.body.appendChild(audioEl)
    const rec = { pc, audioEl }
    this.peers.set(id, rec)

    pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; audioEl.play?.().catch(() => {}) }
    pc.onicecandidate = (e) => { if (e.candidate) this.net.sendRtc(id, { ice: e.candidate }) }
    if (initiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          this.net.sendRtc(id, { sdp: pc.localDescription })
        } catch (err) { console.warn('[voice] offer failed', err?.message) }
      }
    }
    // Add our mic (triggers negotiationneeded on the initiator).
    if (this.localStream) for (const tr of this.localStream.getTracks()) pc.addTrack(tr, this.localStream)
    return rec
  }

  // Handle an incoming offer/answer/ICE from a peer.
  async onSignal(fromId, data) {
    if (!data) return
    let rec = this.peers.get(fromId)
    try {
      if (data.sdp) {
        if (!rec) rec = this._create(fromId, false)
        await rec.pc.setRemoteDescription(data.sdp)
        if (data.sdp.type === 'offer') {
          const answer = await rec.pc.createAnswer()
          await rec.pc.setLocalDescription(answer)
          this.net.sendRtc(fromId, { sdp: rec.pc.localDescription })
        }
      } else if (data.ice && rec) {
        await rec.pc.addIceCandidate(data.ice)
      }
    } catch (err) { console.warn('[voice] signal error', err?.message) }
  }

  // Each frame: open connections to in-range voice peers, set spatial volume,
  // and drop peers who left. remotes = Map(id -> RemotePlayer), localPos = THREE.Vector3.
  update(localPos, remotes) {
    const myId = this.net?.id
    if (!this.on || myId == null || !localPos) return
    for (const [id, rp] of remotes) {
      // Connect once both sides have voice on (lower id initiates).
      if (rp.voice && !this.peers.has(id) && myId < id) this._create(id, true)
      const rec = this.peers.get(id)
      if (rec) {
        const d = Math.hypot(localPos.x - rp.group.position.x, localPos.z - rp.group.position.z)
        rec.audioEl.volume = Math.max(0, Math.min(1, 1 - d / MAX_DIST))
      }
    }
    for (const id of [...this.peers.keys()]) if (!remotes.has(id)) this._close(id)
  }
}
