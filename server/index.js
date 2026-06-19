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
      room.set(id, { ws, name, state: msg.p || null })

      // Tell the newcomer who's already here.
      const peers = []
      for (const [pid, peer] of room) {
        if (pid !== id) peers.push({ id: pid, name: peer.name, p: peer.state })
      }
      send(ws, { t: 'welcome', id, peers })
      broadcast(room, { t: 'peerJoin', id, name }, id)
      console.log(`[+] ${name} (#${id}) joined "${roomName}" — ${room.size} in room`)
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
