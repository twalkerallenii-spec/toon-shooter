# Toon Shooter — Multiplayer Server

A small WebSocket relay (rooms, player state, shots, teams, map voting).

## Run locally
```bash
cd server
npm install
npm start          # ws://localhost:8080
```
Then run the client locally (`npm run dev` in the project root) and use
**PLAY ONLINE** with server `ws://localhost:8080`.

## Deploy on Render (recommended — gives free HTTPS + WSS)
1. Push this repo to GitHub (already done).
2. In Render: **New → Blueprint**, select this repo. Render reads `render.yaml`
   in the repo root and creates the `toon-shooter-server` web service
   (root dir `server/`, `npm install`, `node index.js`, free plan).
3. Wait for it to go live; copy the URL, e.g. `https://toon-shooter-server.onrender.com`.
4. In the game's **PLAY ONLINE** panel, set the server to the **wss** form:
   `wss://toon-shooter-server.onrender.com` (it's remembered after the first time).
   Or share a link: `https://twalkerallenii-spec.github.io/toon-shooter/?server=wss://toon-shooter-server.onrender.com`

Notes:
- The live (HTTPS) site can only connect to a **wss://** server — that's why
  Render is ideal (it provides TLS automatically). Plain `ws://localhost` only
  works when running the client locally over http.
- Render's free instance sleeps after ~15 min idle; the first connection may
  take ~30s to wake it.
