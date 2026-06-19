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

const PORT = process.env.PORT || 8080
const wss = new WebSocketServer({ port: PORT })

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
      room.set(id, { ws, name, state: msg.p || null, team })

      // Tell the newcomer who's already here.
      const peers = []
      for (const [pid, peer] of room) {
        if (pid !== id) peers.push({ id: pid, name: peer.name, p: peer.state, team: peer.team })
      }
      send(ws, { t: 'welcome', id, team, peers })
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
        break
      case 'vote':
        handleVote(room, ws.id, msg.map)
        break
    }
  })

  ws.on('close', () => {
    if (ws.room && rooms.has(ws.room)) {
      const room = rooms.get(ws.room)
      room.delete(ws.id)
      broadcast(room, { t: 'peerLeave', id: ws.id })
      if (room.size === 0) rooms.delete(ws.room)
    }
  })
})

console.log(`Toon Shooter relay server listening on ws://localhost:${PORT}`)
