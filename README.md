# 🔫 Toon Shooter

A toon-style **third-person wave shooter** built with [Three.js](https://threejs.org/) and Vite.
Single-player today; **multiplayer is planned** (see roadmap).

![status](https://img.shields.io/badge/stage-single--player-yellow)

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
| `Mouse` | Aim / camera |
| `Left Click` | Shoot (hold for auto) |
| `Shift` | Sprint |
| `Space` | Jump |
| `R` | Reload |
| `Esc` | Pause |

Survive endless waves — each wave brings more and tougher enemies. Score 10 per kill.

## Project structure

```
src/
  main.js              entry point
  core/
    Game.js            game loop, state machine, wiring
    Input.js           keyboard/mouse + pointer lock
    HUD.js             DOM HUD bindings
    AssetLoader.js     GLTF loading + caching (drop-in models)
  entities/
    Player.js          third-person controller + camera rig
    Enemy.js           chasing enemy + health bar
  systems/
    World.js           scene, lights, ground, arena, obstacles
    Weapons.js         hitscan shooting + tracer/impact FX
    Spawner.js         wave logic
public/models/         put your Toon Shooter Game Kit .glb files here
```

## Using the Toon Shooter Game Kit art

The game runs with placeholder shapes out of the box. To use the real kit assets,
export them to `.glb` and drop them in `public/models/` — see
[`public/models/README.md`](public/models/README.md).

## Roadmap

- [x] Core single-player loop (movement, shooting, waves)
- [x] Real toon character + environment models (Toon Shooter Game Kit, animated)
- [ ] Weapon variety, pickups, reload/recoil animations
- [ ] Sound effects + music
- [ ] **Multiplayer** — co-op / deathmatch (planned: authoritative Node server,
      decide architecture once single-player feels good)

## Deploy

Pushing to `main` auto-deploys to **GitHub Pages** via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
Enable it in your repo: **Settings → Pages → Source: GitHub Actions**.

## License

Code: MIT. Art assets retain their original licenses from the Toon Shooter Game Kit.
