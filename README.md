# 🔫 Toon Shooter

A toon-style **first-person wave shooter** built with [Three.js](https://threejs.org/) and Vite,
using the **Toon Shooter Game Kit** art. Single-player wave survival with an
optional **online multiplayer** mode.

## Play

```bash
npm install
npm run dev      # open the printed localhost URL
```

Click **PLAY**, then click the canvas to lock your mouse.

### Controls
| Key | Action |
|-----|--------|
| `WASD` | Move |
| `Mouse` | Aim |
| `Left Click` | Shoot (hold for auto weapons) |
| `Right Click` | Aim down sights (ADS) |
| `1`–`5` / `Scroll` | Switch weapon (Pistol/AK/SMG/Shotgun/Sniper) |
| `Shift` | Sprint |
| `Space` | Jump |
| `R` | Reload |
| `Esc` | Pause |

Survive endless waves — enemies shoot at range and punch up close. Cover blocks
bullets both ways. Shoot exploding barrels to clear groups. Score 10 per kill.

## Multiplayer

Multiplayer needs a small WebSocket relay server (GitHub Pages can't host one).

**1. Run the server** (locally or on any Node host):

```bash
cd server
npm install
npm start         # listens on ws://localhost:8080 (PORT env to change)
```

**2. Connect** from the menu: enter a name + room, set the **server URL**, and
click **PLAY ONLINE**. Players in the same room see and shoot alongside each
other. You can also prefill the server via URL: `?server=wss://your-host`.

**Hosting online:** deploy the `server/` folder to any Node + WebSocket host
(Render, Railway, Fly.io, Glitch). Use a `wss://` URL when the client is served
over HTTPS (e.g. GitHub Pages), or browsers will block the mixed connection.

> The server is a lightweight **relay** (non-authoritative): clients broadcast
> their own position/aim/shots. Great for seeing and shooting together; harden to
> an authoritative server later for anti-cheat and synced enemies.

## Project structure

```
src/
  core/      Game loop/state, Input, HUD, AssetLoader
  entities/  Player (FPS), Enemy (ranged+melee AI), RemotePlayer, CharacterAnimator
  systems/   World, LevelBuilder, Weapons, Spawner, Particles
  net/       Net.js (client WebSocket layer)
public/models/  Toon Shooter Game Kit glTF (characters / guns / env)
server/         WebSocket relay server (own package.json, deploy separately)
```

## Roadmap

- [x] First-person controller, shooting, waves
- [x] Toon character + environment models (animated)
- [x] Weapon variety (5 weapons), ADS, muzzle flash, reload
- [x] Particles + exploding barrels, cover that blocks bullets
- [x] Multiplayer foundation (relay server, remote players, shot sync)
- [ ] Synced enemies + PvP damage (authoritative server)
- [ ] Sound effects + music, pickups (Health/Ammo)

## Deploy

Pushing to `main` auto-deploys the client to **GitHub Pages** via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

## License

Code: MIT. Art assets retain their original licenses from the Toon Shooter Game Kit.
