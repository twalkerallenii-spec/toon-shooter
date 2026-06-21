// Toon Shooter multiplayer relay server.
//
// A lightweight, non-authoritative relay: clients send their own state (position,
// look, hp, weapon) and shoot events; the server forwards them to everyone else
// in the same room. Good enough to see and shoot alongside other players. Harden
// toward an authoritative server later if you need anti-cheat.
//
// Run:   cd server && npm install && npm start
// Env:   PORT (default 8080)
//
// Deploy anywhere that runs Node + WebSockets (Render, Railway, Fly.io, Glitch).
// Then point the client at it with ?server=wss://your-host

import { WebSocketServer } from 'ws'
import http from 'http'

const PORT = process.env.PORT || 8080

// Plain HTTP responder so hosts (Render) get a healthy 200 on GET / and the
// WebSocket upgrade shares the same port.
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('Toon Shooter relay server is running.\n')
})
const wss = new WebSocketServer({ server: httpServer })

// room -> Map(id -> { ws, name, state })
const rooms = new Map()
let nextId = 1

function getRoom(name) {
  if (!rooms.has(name)) rooms.set(name, new Map())
  return rooms.get(name)
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

function broadcast(room, msg, exceptId) {
  for (const [id, peer] of room) {
    if (id !== exceptId) send(peer.ws, msg)
  }
}

const MAPS = ['arena', 'outpost', 'rooftops']

// Map voting: tally per room, finalize when everyone has voted or after a timer.
function handleVote(room, voterId, map) {
  if (!MAPS.includes(map)) return
  if (!room._votes) room._votes = new Map()
  room._votes.set(voterId, map)

  const tally = {}
  for (const m of MAPS) tally[m] = 0
  for (const m of room._votes.values()) tally[m]++
  broadcast(room, { t: 'votes', tally })

  if (!room._voteTimer) {
    room._voteTimer = setTimeout(() => finalizeVote(room), 12000)
  }
  if (room._votes.size >= room.size) finalizeVote(room)
}

const CTF_LIMIT = 3
function ctfState(room) {
  if (!room.ctf) {
    room.ctf = {
      scores: { red: 0, blue: 0 },
      flags: {
        red: { state: 'home', holder: null, x: 0, z: 0 },
        blue: { state: 'home', holder: null, x: 0, z: 0 },
      },
    }
  }
  return room.ctf
}

// Drop any flags a leaving/dead player was carrying (returns them home).
function dropFlagsHeldBy(room, id) {
  if (!room.ctf) return
  let changed = false
  for (const k of ['red', 'blue']) {
    const f = room.ctf.flags[k]
    if (f.holder === id) { f.state = 'home'; f.holder = null; changed = true }
  }
  if (changed) broadcast(room, { t: 'ctf', ctf: room.ctf })
}

// Battle royale: when one player remains in a started match, they win.
function checkBattleRoyaleWin(room, deadId) {
  if (room._mode !== 'br' || !room._alive || !room._brStarted) return
  room._alive.delete(deadId)
  if (room._alive.size === 1) {
    const [winner] = [...room._alive]
    broadcast(room, { t: 'win', id: winner, reason: 'br' })
    room._brStarted = false
  }
}

function finalizeVote(room) {
  if (room._voteTimer) { clearTimeout(room._voteTimer); room._voteTimer = null }
  const tally = {}
  for (const m of MAPS) tally[m] = 0
  for (const m of (room._votes?.values() || [])) tally[m]++
  let winner = MAPS[0], best = -1
  for (const m of MAPS) if (tally[m] > best) { best = tally[m]; winner = m }
  room._votes = new Map()
  broadcast(room, { t: 'mapChange', map: winner })
}

wss.on('connection', (ws) => {
  ws.id = null
  ws.room = null

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }

    if (msg.t === 'join') {
      const id = nextId++
      const roomName = (msg.room || 'lobby').slice(0, 24)
      const room = getRoom(roomName)
      ws.id = id
      ws.room = roomName
      const name = (msg.name || `Player${id}`).slice(0, 16)

      // Balance teams (used only by team modes; harmless otherwise).
      let red = 0, blue = 0
      for (const [, peer] of room) { if (peer.team === 'red') red++; else if (peer.team === 'blue') blue++ }
      const team = red <= blue ? 'red' : 'blue'
      ws.mode = msg.mode || 'coop'
      room._mode = ws.mode
      room.set(id, { ws, name, state: msg.p || null, team })

      // Battle-royale alive tracking (for last-standing victory).
      if (ws.mode === 'br') {
        room._alive = room._alive || new Set()
        room._alive.add(id)
        if (room._alive.size >= 2) room._brStarted = true
      }

      // Tell the newcomer who's already here.
      const peers = []
      for (const [pid, peer] of room) {
        if (pid !== id) peers.push({ id: pid, name: peer.name, p: peer.state, team: peer.team })
      }
      send(ws, { t: 'welcome', id, team, peers, ctf: room.ctf || null })
      broadcast(room, { t: 'peerJoin', id, name, team }, id)
      console.log(`[+] ${name} (#${id}, ${team}) joined "${roomName}" — ${room.size} in room`)
      return
    }

    if (!ws.id || !ws.room) return
    const room = rooms.get(ws.room)
    if (!room) return
    const me = room.get(ws.id)

    switch (msg.t) {
      case 'state':
        if (me) me.state = msg.p
        broadcast(room, { t: 'state', id: ws.id, p: msg.p }, ws.id)
        break
      case 'shoot':
        broadcast(room, { t: 'shoot', id: ws.id, from: msg.from, to: msg.to }, ws.id)
        break
      case 'hit':
        // Relay a damage claim to the victim (client decides what to do).
        for (const [, peer] of room) {
          if (peer.ws.id === msg.target) send(peer.ws, { t: 'hit', from: ws.id, dmg: msg.dmg })
        }
        break
      case 'killed':
        // Victim reports who killed them; tell the whole room (kill feed + score).
        broadcast(room, { t: 'killed', by: msg.by, victim: ws.id })
        dropFlagsHeldBy(room, ws.id)
        checkBattleRoyaleWin(room, ws.id)
        break
      case 'vote':
        handleVote(room, ws.id, msg.map)
        break
      case 'chat': {
        const text = String(msg.text || '').slice(0, 140)
        if (text) broadcast(room, { t: 'chat', id: ws.id, name: me?.name || 'Player', text, p: me?.state || null })
        break
      }
      // WebRTC voice signalling: forward an offer/answer/ICE to one peer.
      case 'rtc': {
        for (const [, peer] of room) {
          if (peer.ws.id === msg.to) { send(peer.ws, { t: 'rtc', from: ws.id, data: msg.data }); break }
        }
        break
      }

      // ---- Capture the Flag ----
      case 'flagTake': {
        const c = ctfState(room); const f = c.flags[msg.flag]
        if (f && f.state !== 'carried') { f.state = 'carried'; f.holder = ws.id; broadcast(room, { t: 'ctf', ctf: c }) }
        break
      }
      case 'flagDrop': {
        const c = ctfState(room); const f = c.flags[msg.flag]
        if (f && f.holder === ws.id) { f.state = 'dropped'; f.holder = null; f.x = msg.x; f.z = msg.z; broadcast(room, { t: 'ctf', ctf: c }) }
        break
      }
      case 'flagReturn': {
        const c = ctfState(room); const f = c.flags[msg.flag]
        if (f && f.state === 'dropped') { f.state = 'home'; f.holder = null; broadcast(room, { t: 'ctf', ctf: c }) }
        break
      }
      case 'flagCapture': {
        const c = ctfState(room); const f = c.flags[msg.flag]
        if (f && f.holder === ws.id) {
          f.state = 'home'; f.holder = null
          const t = me?.team === 'red' ? 'red' : 'blue'
          c.scores[t] = (c.scores[t] || 0) + 1
          broadcast(room, { t: 'ctf', ctf: c })
          if (c.scores[t] >= CTF_LIMIT) broadcast(room, { t: 'win', team: t, reason: 'ctf' })
        }
        break
      }
    }
  })

  ws.on('close', () => {
    if (ws.room && rooms.has(ws.room)) {
      const room = rooms.get(ws.room)
      room.delete(ws.id)
      broadcast(room, { t: 'peerLeave', id: ws.id })
      dropFlagsHeldBy(room, ws.id)
      checkBattleRoyaleWin(room, ws.id)
      if (room.size === 0) rooms.delete(ws.room)
    }
  })
})

httpServer.listen(PORT, () => {
  console.log(`Toon Shooter relay server listening on port ${PORT}`)
})
