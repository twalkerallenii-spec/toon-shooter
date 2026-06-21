import * as THREE from 'three'
import { Input } from './Input.js'
import { HUD } from './HUD.js'
import { MobileControls } from './MobileControls.js'
import { AssetLoader } from './AssetLoader.js'
import { World } from '../systems/World.js'
import { Weapons } from '../systems/Weapons.js'
import { Spawner } from '../systems/Spawner.js'
import { Particles } from '../systems/Particles.js'
import { Audio } from '../systems/Audio.js'
import { Pickups } from '../systems/Pickups.js'
import { Zone } from '../systems/Zone.js'
import { Flags } from '../systems/Flags.js'
import { Player } from '../entities/Player.js'
import { Vehicle } from '../entities/Vehicle.js'
import { Bot } from '../entities/Bot.js'
import { Grenade } from '../entities/Grenade.js'
import { Net } from '../net/Net.js'
import { Voice } from '../net/Voice.js'
import { RemotePlayer } from '../entities/RemotePlayer.js'
import { SKINS, skinOf, applyTint } from './skins.js'
import { Assistant } from './Assistant.js'

// Game states
const STATE = { MENU: 'menu', LOADING: 'loading', PLAYING: 'playing', PAUSED: 'paused', DEAD: 'dead' }

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// Tiny deterministic PRNG for the lobby scenery.
function mulberryLobby(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Solo combat modes (vs bots) on the normal arena. Each is a small rule tweak.
const SOLO_MODES = {
  ffa: { label: 'FFA DEATHMATCH', bots: 7, role: 'fighter', killTarget: 15, map: 'outpost' },
  gungame: { label: 'GUN GAME', bots: 6, role: 'fighter', gungame: true, killTarget: 15, startWeapon: 0, map: 'outpost' },
  oitc: { label: 'ONE IN THE CHAMBER', bots: 6, role: 'fighter', killTarget: 10, lowHp: true, startWeapon: 0, map: 'arena' },
  jugg: { label: 'JUGGERNAUT', jugg: true, map: 'outpost' },
  infect: { label: 'INFECTION', infect: true, bots: 9, startZombies: 3, map: 'outpost' },
  koth: { label: 'KING OF THE HILL', koth: true, bots: 7, role: 'fighter', map: 'arena' },
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas
    this.state = STATE.MENU
    this.score = 0
    this.selectedMap = 'arena'

    // Persisted settings.
    this.settings = { sens: 1, invertY: false }
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem('ts_settings') || '{}')) } catch {}
    this.character = localStorage.getItem('ts_char') || 'Character_Soldier' // Locker pick

    // Minimap canvas.
    this.minimap = document.getElementById('minimap')
    this.minimapCtx = this.minimap?.getContext('2d')

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.camera = new THREE.PerspectiveCamera(
      72, window.innerWidth / window.innerHeight, 0.1, 500
    )

    this.clock = new THREE.Clock()
    this._muzzle = new THREE.Vector3() // reused each frame for the tracer origin
    this.audio = new Audio()
    this._grenadeCd = 0
    this._prevHp = 100
    this.input = new Input(canvas)
    this.hud = new HUD()
    this.assets = new AssetLoader()

    // Touch devices: on-screen controls + no pointer lock.
    if (this.input.isTouch) {
      document.body.classList.add('touch')
      this.mobile = new MobileControls(this.input)
    }

    this._wireUI()
    this._onResize = () => this._resize()
    window.addEventListener('resize', this._onResize)

    // Animated lobby scene behind the menu.
    this._buildLobby()
    this._lobbyLoop()
    this._populateLobby()
    this._connectPresence() // appear online + see who else is on

    // In-game Claude assistant (password-gated, uses the player's own API key).
    window.game = this // exposed for the assistant's eval_js tool
    this.assistant = new Assistant({ exec: (name, input) => this._aiExec(name, input) })
    this._wireAssistant()
  }

  _wireUI() {
    this.hud.el.startBtn.addEventListener('click', () => {
      if (this.state === STATE.MENU || this.state === STATE.DEAD) this._startSelectedMode()
    })

    // Pause / death box buttons.
    this.hud.el.pauseResume.addEventListener('click', () => {
      if (this.state === STATE.PAUSED) this.resume()
      else if (this.state === STATE.DEAD) { this.hud.hidePause(); this._startSelectedMode() }
    })
    document.getElementById('pause-quit').addEventListener('click', () => { this.hud.hidePause(); this._toLobby() })

    // Multiplayer: server URL precedence = ?server= > saved > empty.
    // Remembered in localStorage so you don't retype your Render URL.
    const params = new URLSearchParams(location.search)
    const serverInput = document.getElementById('mp-server')
    const DEFAULT_SERVER = 'wss://toon-shooter-server.onrender.com'
    const savedServer = localStorage.getItem('ts_server') || ''
    serverInput.value = params.get('server') || savedServer || DEFAULT_SERVER
    serverInput.addEventListener('change', () => localStorage.setItem('ts_server', serverInput.value.trim()))
    const nameInput = document.getElementById('mp-name')
    if (localStorage.getItem('ts_name')) nameInput.value = localStorage.getItem('ts_name')
    nameInput.addEventListener('change', () => { localStorage.setItem('ts_name', nameInput.value.trim()); this._populateLobby() })
    document.getElementById('online-btn').addEventListener('click', () => {
      if (this.state === STATE.PLAYING) return
      localStorage.setItem('ts_server', serverInput.value.trim())
      this.startOnline()
    })

    // Quick Battle Royale drop-in.
    document.getElementById('br-btn').addEventListener('click', () => {
      if (this.state === STATE.MENU || this.state === STATE.DEAD) this.startOnline('br')
    })

    // Invite links: copy a ?room=&mode= URL that drops a friend into your match.
    document.getElementById('invite-btn')?.addEventListener('click', () => {
      const room = (document.getElementById('mp-room').value || 'lobby').trim()
      const mode = document.querySelector('.event-tile.active')?.dataset.mode || 'coop'
      const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}&mode=${encodeURIComponent(mode)}`
      const btn = document.getElementById('invite-btn'); const orig = btn.textContent
      const done = () => { btn.textContent = '✓ LINK COPIED!'; setTimeout(() => (btn.textContent = orig), 1600) }
      navigator.clipboard?.writeText(url).then(done).catch(() => window.prompt('Copy this invite link:', url))
    })

    // Joining via an invite link: prefill room + select the mode tile.
    const invRoom = params.get('room'), invMode = params.get('mode')
    if (invRoom) document.getElementById('mp-room').value = invRoom.slice(0, 24)
    if (invMode) {
      const tile = document.querySelector(`.event-tile[data-mode="${invMode}"]`)
      if (tile) {
        document.querySelectorAll('.event-tile').forEach((t) => t.classList.remove('active'))
        tile.classList.add('active'); this._updateLobbyCard(invMode)
      }
    }
    if (invRoom || invMode) {
      const om = document.getElementById('overlay-msg')
      if (om) om.textContent = `Invited to "${invRoom || 'lobby'}" — press START to join!`
    }

    // Map voting (online): toggle panel + cast vote.
    this.hud.el.voteToggle.addEventListener('click', () => this.hud.toggleVotePanel())
    this.hud.el.votePanel.querySelectorAll('.vote-opt').forEach((b) => {
      b.addEventListener('click', () => this.net?.sendVote(b.dataset.map))
    })

    // Map selector buttons.
    document.querySelectorAll('.map-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedMap = btn.dataset.map
        document.querySelectorAll('.map-btn').forEach((b) => b.classList.toggle('active', b === btn))
      })
    })

    // Mode tabs — update the matchmaking card.
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b === btn))
        this._updateLobbyCard(btn.dataset.mode)
      })
    })
    this._updateLobbyCard('coop')

    // Top tabs switch PLAY / LOCKER / STORE panels.
    document.querySelectorAll('.top-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const p = tab.dataset.panel
        document.querySelectorAll('.top-tab').forEach((t) => t.classList.toggle('active', t === tab))
        document.querySelectorAll('.panel-play').forEach((el) => el.classList.toggle('hidden', p !== 'play'))
        document.querySelectorAll('.panel-locker').forEach((el) => el.classList.toggle('hidden', p !== 'locker'))
        document.querySelectorAll('.panel-store').forEach((el) => el.classList.toggle('hidden', p !== 'store'))
        document.getElementById('event-bar').style.display = p === 'play' ? '' : 'none'
      })
    })

    // Locker shows only owned skins (click to equip); Store sells the rest.
    this._renderLocker()
    this._renderStore()
    document.getElementById('char-grid')?.addEventListener('click', (e) => {
      const card = e.target.closest('.char-card'); if (!card) return
      this.character = card.dataset.char
      localStorage.setItem('ts_char', this.character)
      this._renderLocker()
      this._setLobbyCharacter(this.character)
      this._populateLobby()
    })
    document.getElementById('store-grid')?.addEventListener('click', (e) => {
      const card = e.target.closest('.char-card'); if (!card) return
      this._buySkin(card.dataset.char)
    })

    // Settings (sensitivity + invert-Y + third-person), persisted to localStorage.
    const sens = document.getElementById('set-sens')
    const invert = document.getElementById('set-invert')
    const tps = document.getElementById('set-tps')
    const fov = document.getElementById('set-fov')
    const vol = document.getElementById('set-vol')
    const shadows = document.getElementById('set-shadows')
    sens.value = this.settings.sens
    invert.checked = this.settings.invertY
    tps.checked = !!this.settings.thirdPerson
    fov.value = this.settings.fov ?? 72
    vol.value = this.settings.volume ?? 0.5
    shadows.checked = this.settings.shadows !== false
    const saveSettings = () => {
      this.settings.sens = parseFloat(sens.value)
      this.settings.invertY = invert.checked
      this.settings.thirdPerson = tps.checked
      this.settings.fov = parseFloat(fov.value)
      this.settings.volume = parseFloat(vol.value)
      this.settings.shadows = shadows.checked
      localStorage.setItem('ts_settings', JSON.stringify(this.settings))
      this._applySettings()
    }
    for (const el of [sens, invert, tps, fov, vol, shadows]) {
      el.addEventListener('input', saveSettings); el.addEventListener('change', saveSettings)
    }
    this._applySettings() // apply saved fov/volume/shadows at startup

    this.input.onLockChange = (locked) => {
      // Losing the pointer lock mid-game = pause (desktop only) — unless chatting.
      if (!this.input.isTouch && !locked && this.state === STATE.PLAYING && !this._chatOpen && !this._aiOpen) this.pause()
    }

    // Pointer lock can't be requested right after an async load (no user
    // gesture), so clicking the game re-acquires it.
    this.canvas.addEventListener('click', () => {
      if (this.state === STATE.PLAYING && !this.input.isTouch && !this.input.locked) this.input.requestLock()
    })

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR' && this.state === STATE.PLAYING) this.weapons.startReload()
      // TAB cycles through the weapons you actually have.
      if (e.code === 'Tab') { e.preventDefault(); if (this.state === STATE.PLAYING && !e.repeat) this.weapons.cycle(1) }
      // X discards the current weapon (drops it as loot).
      if (e.code === 'KeyX' && this.state === STATE.PLAYING && !e.repeat) this._discardWeapon()
      // Enter opens chat.
      if (e.code === 'Enter' && this.state === STATE.PLAYING && !this._chatOpen && !e.repeat) { e.preventDefault(); this._openChat() }
      // M toggles proximity voice (the 🎤 button can't be clicked while aiming).
      if (e.code === 'KeyM' && this.state === STATE.PLAYING && !e.repeat) this._toggleVoice()
      // K toggles the AI assistant (works in lobby + match).
      if (e.code === 'KeyK' && !e.repeat) { const ae = document.activeElement; if (!ae || (ae.tagName !== 'INPUT' && ae.tagName !== 'TEXTAREA')) this._toggleAi?.() }
    })

    // Mobile RANK button (toggle).
    const rankBtn = document.getElementById('rank-btn')
    rankBtn.addEventListener('click', () => {
      if (this.hud.el.scoreboard.classList.contains('hidden')) this.hud.showScoreboard(this._scoreboardRows())
      else this.hud.hideScoreboard()
    })

    // Discard-weapon button.
    document.getElementById('drop-btn')?.addEventListener('click', () => {
      if (this.state === STATE.PLAYING) this._discardWeapon()
    })

    // Unlock audio + start lobby music on the first lobby interaction.
    this.hud.el.overlay?.addEventListener('click', () => {
      this.audio.resume()
      if (this.state === STATE.MENU) this.audio.startMusic()
    })

    // ---- Live chat ----
    this._chatOpen = false
    document.getElementById('chat-btn')?.addEventListener('click', () => {
      if (this.state === STATE.PLAYING) this._chatOpen ? this._closeChat() : this._openChat()
    })
    // Proximity voice toggle (button works in menus; press M in a match).
    document.getElementById('mic-btn')?.addEventListener('click', () => this._toggleVoice())

    const chatInput = this.hud.el.chatInput
    chatInput?.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.code === 'Enter') { this._sendChat(chatInput.value.trim()); this._closeChat() }
      else if (e.code === 'Escape') this._closeChat()
    })

    // Victory screen -> back to the lobby.
    document.getElementById('victory-btn').addEventListener('click', () => this._toLobby())
  }

  _buildWorld() {
    // BR is a huge arena; Hide & Seek is a smaller, denser map; rest standard.
    const radius = this.brMode ? 190 : this.hnsMode ? 95 : 75
    const backdrop = !!this.brMode || !!this.hnsMode
    this.world = new World({ radius, backdrop })
    this.camera.fov = 72 // reset base FOV (ADS may have left it zoomed)
    this.camera.updateProjectionMatrix()
    this.camera.position.set(0, 1.6, 0)
  }

  // Update the matchmaking card label/sub for the selected mode.
  _updateLobbyCard(mode) {
    const info = {
      coop: ['CO-OP', 'Survive endless waves of enemies.'],
      dm: ['DEATHMATCH', 'Free-for-all — most kills wins. (online)'],
      team: ['TEAM DM', 'Red vs Blue team battle. (online)'],
      br: ['BATTLE ROYALE', 'Drop into the big arena. Last one standing as the storm closes.'],
      ctf: ['CAPTURE THE FLAG', 'Steal the enemy flag, defend yours. (online)'],
      hns: ['HIDE & SEEK', "You're the Seeker — hunt every hider before time runs out."],
      ffa: ['FFA DEATHMATCH', 'Free-for-all vs bots — first to 15 kills wins.'],
      gungame: ['GUN GAME', 'Every kill upgrades your weapon. Master all to win.'],
      oitc: ['ONE IN THE CHAMBER', 'Everyone has 1 HP. One shot, one kill.'],
      jugg: ['JUGGERNAUT', 'Take down the giant juggernaut bot.'],
      infect: ['INFECTION', 'Zombies are knife-only — get stabbed and you turn. Last human wins.'],
      koth: ['KING OF THE HILL', 'Hold the glowing hill at the center. First to 100 wins.'],
    }
    const [label, sub] = info[mode] || info.coop
    this.hud.setLobbyMode(label, sub)
  }

  // Every game drops into an online match (bots fill it; friends can join the
  // same room). Falls back to offline if the server can't be reached.
  _startSelectedMode() {
    const mode = document.querySelector('.event-tile.active')?.dataset.mode
      || document.querySelector('.mode-btn.active')?.dataset.mode || 'coop'
    this.startOnline(mode)
  }

  // ---- Animated Fortnite-style lobby: stage, lights, skyline, FX ----
  _buildLobby() {
    const scene = new THREE.Scene()
    this.lobbyScene = scene
    scene.fog = new THREE.Fog(0x121641, 22, 70)

    // Gradient dusk sky dome.
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(90, 24, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x1c2c70) }, bot: { value: new THREE.Color(0x5a2c74) } },
      vertexShader: 'varying float h; void main(){ h=normalize(position).y; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'varying float h; uniform vec3 top; uniform vec3 bot; void main(){ gl_FragColor=vec4(mix(bot,top,clamp(h*1.3+0.2,0.0,1.0)),1.0);}',
    })))

    // Lights — key, rim, two colored accents.
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x241a3a, 1.0))
    const key = new THREE.DirectionalLight(0xfff0d0, 2.1); key.position.set(5, 9, 6); scene.add(key)
    const rim = new THREE.DirectionalLight(0x6a8cff, 1.6); rim.position.set(-6, 4, -6); scene.add(rim)
    const accent1 = new THREE.PointLight(0xff5aa0, 0.9, 34); accent1.position.set(-5, 4, 3); scene.add(accent1)
    const accent2 = new THREE.PointLight(0x5ad1ff, 0.9, 34); accent2.position.set(7, 3, -2); scene.add(accent2)

    const podCenter = 2.4
    this._podCenter = podCenter

    // Stage floor + grid.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(11, 48), new THREE.MeshStandardMaterial({ color: 0x141a30, roughness: 0.45, metalness: 0.35 }))
    floor.rotation.x = -Math.PI / 2; scene.add(floor)
    const grid = new THREE.GridHelper(22, 28, 0x2a3a7a, 0x1a2348); grid.position.y = 0.02; scene.add(grid)

    // Podium + 3 spinning accent rings.
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.0, 0.5, 40),
      new THREE.MeshStandardMaterial({ color: 0x222a44, emissive: 0x163a8a, emissiveIntensity: 0.85, roughness: 0.3, metalness: 0.5 }))
    ped.position.set(podCenter, 0, 0); scene.add(ped)
    this._lobbyRings = []
    const ringCols = [0xffcb3d, 0x5ad1ff, 0xff5aa0]
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(1.7 + i * 0.4, 0.04, 8, 64), new THREE.MeshBasicMaterial({ color: ringCols[i] }))
      r.rotation.x = Math.PI / 2; r.position.set(podCenter, 0.3 + i * 0.05, 0)
      scene.add(r); this._lobbyRings.push(r)
    }

    // Spotlight beams (faint additive cones angled onto the podium).
    this._lobbySpots = []
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.4, 9, 18, 1, true),
        new THREE.MeshBasicMaterial({ color: [0xff7adf, 0x7ad1ff, 0xffe07a][i], transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }))
      cone.position.set(podCenter + Math.cos(a) * 3.2, 6.5, Math.sin(a) * 3.2)
      cone.rotation.x = Math.PI; cone.rotation.z = Math.cos(a) * 0.25
      scene.add(cone); this._lobbySpots.push({ cone, a })
    }

    // Distant city skyline silhouette.
    const bMat = new THREE.MeshStandardMaterial({ color: 0x0c1130, roughness: 1 })
    const rng = mulberryLobby(7)
    for (let i = 0; i < 60; i++) {
      const ang = rng() * Math.PI * 2, dist = 26 + rng() * 26
      const h = 6 + rng() * 26, w = 3 + rng() * 4
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), bMat)
      b.position.set(podCenter + Math.cos(ang) * dist, h / 2 - 1, Math.sin(ang) * dist)
      scene.add(b)
    }

    // Floating ambient spark particles.
    const N = 160
    const pos = new Float32Array(N * 3)
    this._lobbyPV = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = podCenter + (rng() - 0.5) * 22
      pos[i * 3 + 1] = rng() * 16
      pos[i * 3 + 2] = (rng() - 0.5) * 22
      this._lobbyPV[i] = 0.3 + rng() * 0.8
    }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this._lobbyParticles = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x9fd0ff, size: 0.08, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }))
    scene.add(this._lobbyParticles)

    this.lobbyCam = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200)
    this.lobbyCam.position.set(-0.4, 2.4, 7.2); this.lobbyCam.lookAt(podCenter, 1.5, 0)
    this._lobbyClock = new THREE.Clock()
    this._lobbyT = 0
    this._setLobbyCharacter(this.character)
  }

  // Swap the podium character (used by the Locker).
  _setLobbyCharacter(name) {
    if (!this.lobbyScene) return
    if (this.lobbyModel) { this.lobbyScene.remove(this.lobbyModel); this.lobbyMixer = null }
    const podCenter = this._podCenter
    const skin = skinOf(name)
    this.assets.loadModel(`models/characters/${skin.base}.gltf`).then((m) => {
      if (!m || this.character !== name) return
      applyTint(m.scene, skin.tint)
      m.scene.traverse((o) => { if (o.isMesh) o.castShadow = true })
      const box = new THREE.Box3().setFromObject(m.scene); const s = new THREE.Vector3(); box.getSize(s)
      m.scene.scale.setScalar(2.5 / (s.y || 1))
      const b2 = new THREE.Box3().setFromObject(m.scene); const c = new THREE.Vector3(); b2.getCenter(c)
      m.scene.position.set(podCenter - c.x, 0.2 - b2.min.y, -c.z)
      this.lobbyScene.add(m.scene); this.lobbyModel = m.scene
      if (m.animations?.length) {
        this.lobbyMixer = new THREE.AnimationMixer(m.scene)
        const clip = m.animations.find((a) => /idle/i.test(a.name)) || m.animations[0]
        this.lobbyMixer.clipAction(clip).play()
      }
    })
  }

  _lobbyLoop() {
    if (this.state !== STATE.MENU) { this._lobbyRAF = null; return }
    this._lobbyRAF = requestAnimationFrame(() => this._lobbyLoop())
    const dt = this._lobbyClock.getDelta()
    this._lobbyT = (this._lobbyT || 0) + dt
    if (this.lobbyModel) this.lobbyModel.rotation.y += dt * 0.5
    this.lobbyMixer?.update(dt)
    // Spin the accent rings at different speeds/axes.
    if (this._lobbyRings) this._lobbyRings.forEach((r, i) => { r.rotation.z += dt * (0.4 + i * 0.25) * (i % 2 ? -1 : 1) })
    // Sway the spotlight beams.
    if (this._lobbySpots) this._lobbySpots.forEach((s) => { s.cone.rotation.z = Math.cos(this._lobbyT * 0.6 + s.a) * 0.28 })
    // Drift particles upward, wrap around.
    if (this._lobbyParticles) {
      const a = this._lobbyParticles.geometry.attributes.position
      for (let i = 0; i < this._lobbyPV.length; i++) {
        a.array[i * 3 + 1] += this._lobbyPV[i] * dt
        if (a.array[i * 3 + 1] > 16) a.array[i * 3 + 1] = 0
      }
      a.needsUpdate = true
    }
    // Gentle camera orbit for life.
    const pc = this._podCenter || 2.4
    this.lobbyCam.position.x = -0.4 + Math.sin(this._lobbyT * 0.2) * 0.6
    this.lobbyCam.lookAt(pc, 1.5, 0)
    this.renderer.render(this.lobbyScene, this.lobbyCam)
  }

  _stopLobby() {
    if (this._lobbyRAF) { cancelAnimationFrame(this._lobbyRAF); this._lobbyRAF = null }
  }

  _stats() {
    try { return JSON.parse(localStorage.getItem('ts_stats') || '{}') } catch { return {} }
  }
  _recordMatch(won) {
    if (this._recorded) return // once per match (win, death, or quit)
    this._recorded = true
    const s = this._stats()
    const k = this.kills || this.enemyKills || 0
    s.matches = (s.matches || 0) + 1
    s.kills = (s.kills || 0) + k
    s.wins = (s.wins || 0) + (won ? 1 : 0)
    s.xp = (s.xp || 0) + (won ? 300 : 120) + k * 20
    localStorage.setItem('ts_stats', JSON.stringify(s))
    // Coins: earn from kills + a win bonus.
    const coinGain = k * 10 + (won ? 100 : 25)
    this._setCoins(this._coins() + coinGain)
    // Stash this match's recap for the end screen.
    const deaths = this.net ? (this.deaths || 0) : (this.player?.alive ? 0 : 1)
    this._summary = { kills: k, deaths, kd: (k / Math.max(1, deaths)).toFixed(2), xp: (won ? 300 : 120) + k * 20, coins: coinGain, won }
    this._populateLobby() // refresh lobby stats immediately (even on Play Again)
  }

  // ---- Economy: coins + owned skins (Store/Locker) ----------------------
  _coins() { return parseInt(localStorage.getItem('ts_coins') || '600', 10) || 0 }
  _setCoins(n) { localStorage.setItem('ts_coins', String(Math.max(0, Math.floor(n)))) }
  _ownedSkins() {
    try {
      const a = JSON.parse(localStorage.getItem('ts_owned') || 'null')
      if (Array.isArray(a) && a.length) return a
    } catch { /* ignore */ }
    return ['Character_Soldier', 'Character_Hazmat', 'Character_Enemy']
  }
  _saveOwned(arr) { localStorage.setItem('ts_owned', JSON.stringify([...new Set(arr)])) }

  _renderLocker() {
    const grid = document.getElementById('char-grid'); if (!grid) return
    const owned = this._ownedSkins()
    if (!owned.includes(this.character)) { this.character = owned[0]; localStorage.setItem('ts_char', this.character) }
    grid.innerHTML = SKINS.filter((s) => owned.includes(s.id)).map((s) =>
      `<button class="char-card ${s.id === this.character ? 'active' : ''}" data-char="${s.id}"><span class="cc-ico">${s.ico}</span>${s.label}</button>`).join('')
  }

  _renderStore() {
    const grid = document.getElementById('store-grid'); if (!grid) return
    const owned = this._ownedSkins()
    grid.innerHTML = SKINS.map((s) => {
      if (owned.includes(s.id)) return `<button class="char-card owned"><span class="cc-ico">${s.ico}</span>${s.label}<small>OWNED</small></button>`
      return `<button class="char-card buy" data-char="${s.id}"><span class="cc-ico">${s.ico}</span>${s.label}<small>◆ ${s.price}</small></button>`
    }).join('')
  }

  _buySkin(id) {
    const skin = SKINS.find((s) => s.id === id); if (!skin) return
    const owned = this._ownedSkins()
    if (owned.includes(id)) return
    if (this._coins() < skin.price) { this.hud.addKillFeed?.(`Not enough ◆ for ${skin.label}`); return }
    this._setCoins(this._coins() - skin.price)
    owned.push(id); this._saveOwned(owned)
    this.character = id; localStorage.setItem('ts_char', id)
    this._renderStore(); this._renderLocker()
    this._setLobbyCharacter(id)
    this._populateLobby()
  }

  // Fill the lobby panels (level, XP, season, challenges, career, avatar).
  _populateLobby() {
    const $ = (id) => document.getElementById(id)
    const s = this._stats()
    const xp = s.xp || 0, kills = s.kills || 0, wins = s.wins || 0, matches = s.matches || 0
    const level = 1 + Math.floor(xp / 1000), inLvl = xp % 1000
    if ($('pc-level')) $('pc-level').textContent = level
    if ($('pc-xpfill')) $('pc-xpfill').style.width = `${(inLvl / 1000) * 100}%`
    if ($('pc-xptext')) $('pc-xptext').textContent = `${inLvl} / 1000 XP`
    const tier = 1 + Math.floor(xp / 500)
    if ($('sb-tier')) $('sb-tier').textContent = Math.min(100, tier)
    if ($('sb-fill')) $('sb-fill').style.width = `${((xp % 500) / 500) * 100}%`
    if ($('st-wins')) $('st-wins').textContent = wins
    if ($('st-kills')) $('st-kills').textContent = kills
    if ($('st-matches')) $('st-matches').textContent = matches
    if ($('st-kd')) $('st-kd').textContent = (kills / Math.max(1, matches)).toFixed(1)
    if ($('coin-count')) $('coin-count').textContent = this._coins().toLocaleString()
    const name = localStorage.getItem('ts_name') || (document.getElementById('mp-name')?.value) || 'Recruit'
    if ($('pc-name')) $('pc-name').textContent = name
    if ($('party-you')) $('party-you').textContent = name
    const av = skinOf(this.character).ico
    if ($('pc-avatar')) $('pc-avatar').textContent = av
    // Daily challenges with live progress from stats.
    const ch = [
      { t: 'Get 20 kills', cur: Math.min(kills, 20), max: 20, xp: 200 },
      { t: 'Win a match', cur: Math.min(wins, 1), max: 1, xp: 300 },
      { t: 'Play 5 matches', cur: Math.min(matches, 5), max: 5, xp: 150 },
    ]
    const list = $('challenge-list')
    if (list) list.innerHTML = ch.map((c) =>
      `<li><div class="ch-row"><span>${c.t}</span><span class="xp">+${c.xp}</span></div>
       <div class="ch-bar"><i style="width:${(c.cur / c.max) * 100}%"></i></div>
       <div style="font-size:10px;opacity:.6">${c.cur}/${c.max}</div></li>`).join('')

    // Rankings: a local leaderboard (your saved kills vs seeded rivals).
    const rl = $('rank-list')
    if (rl) {
      const rivals = [
        ['Reaper', 920], ['Vortex', 740], ['Nyx', 610], ['Specter', 480],
        ['Riot', 360], ['Comet', 250], ['Hex', 170], ['Pulse', 90],
      ]
      const board = [...rivals, [name + ' (you)', kills, true]]
        .sort((a, b) => b[1] - a[1]).slice(0, 8)
      rl.innerHTML = board.map((r, i) =>
        `<li class="${r[2] ? 'me' : ''}"><span class="rk-pos">${i + 1}</span><span class="rk-name">${r[0]}</span><span class="rk-k">${r[1]}</span></li>`).join('')
    }
  }

  // Return to the lobby menu (from victory/game-over).
  _toLobby() {
    this._recordMatch(false) // save kills/XP/coins even if you just quit (deduped)
    this.state = STATE.MENU
    this.hud.hide()
    this.hud.hideVictory()
    this.hud.hidePause()
    this.hud.el.overlay.classList.remove('hidden')
    this.hud.el.startBtn.textContent = 'START MATCH'
    this._populateLobby() // refresh stats/level after the match
    this._connectPresence() // back online in the lobby
    this.audio.startMusic()
    this._lobbyClock.getDelta() // reset dt
    this._lobbyLoop()
  }

  _resetGameObjects() {
    // Fresh world each run so old enemies/effects are gone.
    this._buildWorld()
    // The camera persists across matches; clear any old viewmodel/muzzle children
    // so they don't accumulate (this caused a leftover "ghost" gun).
    this.camera.clear()
    // Camera must be in the scene graph so the FPS viewmodel (its child) renders.
    this.world.scene.add(this.camera)
    this.particles = new Particles(this.world.scene)
    this.player = new Player({ world: this.world, input: this.input, camera: this.camera })
    this.weapons = new Weapons({ world: this.world, particles: this.particles })
    this.spawner = new Spawner({ world: this.world, assets: this.assets, weapons: this.weapons })
    this.pickups = new Pickups({ world: this.world, assets: this.assets, audio: this.audio })
    this.grenades = []
    this.zone = this.brMode ? new Zone(this.world, this.particles) : null
    this.hnsTime = this.hnsMode ? 110 : 0 // Hide & Seek round timer (seconds)
    this._hnsOver = false
    // Combat mode config (FFA / Gun Game / etc.) — applies online or offline.
    this.modeCfg = SOLO_MODES[this.net ? this.onlineMode : this.soloMode] || null
    this._matchOver = false
    this.ggLevel = 0
    this.jugg = null
    this._surviveTime = this.modeCfg?.survive ?? 0
    this.cars = []
    this.bots = []
    this.kills = 0
    this.driving = null
    this._ePrev = false
    this.ctfMode = this.onlineMode === 'ctf'
    this.flags = this.ctfMode ? new Flags(this.world) : null
    this.ctf = null
    if (this.ctfMode) this._initLocalCtf(); else this.localCtf = null
    this.infectMode = !!this.modeCfg?.infect
    this.playerZombie = false
    this.player.isZombie = false
    this.player.team = null
    this.hud.setZombie?.(false)
    this.kothMode = !!this.modeCfg?.koth
    this.kothYou = 0; this.kothEnemy = 0
    this.hillRadius = 8
    this.score = 0
    this.enemyKills = 0
    this._wonBR = false
    // Apply combat-mode tweaks.
    if (this.modeCfg?.lowHp) { this.player.maxHp = 1; this.player.hp = 1 }
    // Fortnite-style: spawn with just a pistol + knife and loot the rest.
    const loadout = [0, 11] // Pistol, Knife
    if (this.modeCfg?.startWeapon != null && !loadout.includes(this.modeCfg.startWeapon)) loadout.push(this.modeCfg.startWeapon)
    this.weapons.setLoadout(loadout)
    this.weapons.index = this.modeCfg?.startWeapon ?? 0
    this._prevHp = this.player.maxHp
    this._deadHandled = false
    this._lastAttacker = null
    this.remotePlayers = new Map() // id -> RemotePlayer (multiplayer)
    this.player.onJumpPad = () => { this.audio.jumpPad(); this.particles.emit({ x: this.player.position.x, y: 0.3, z: this.player.position.z }, 16, { color: [0.3, 0.9, 1], speed: 7, size: 0.6, life: 0.5, up: 4 }) }
    this.player.onLand = (pos, dbl) => this.particles.emit({ x: pos.x, y: 0.2, z: pos.z }, dbl ? 10 : 8, { color: [0.75, 0.75, 0.7], speed: dbl ? 5 : 3, size: 0.6, life: 0.4, up: 1 })
    this._shake = 0
    this._streak = 0; this._lastKillT = -99; this._matchT = 0
    this.kills = 0; this._recorded = false // stats recorded once per match
    this.pickups.onPickup = (type, wi) => {
      const label = type === 'weapon' ? (this.weapons.defs[wi]?.label || this.weapons.defs[wi]?.key || 'Weapon')
        : type === 'health' ? '+35 Health' : type === 'shield' ? '+50 Shield' : 'Ammo refilled'
      this.hud.addKillFeed(`🟢 ${label}`)
      if (type === 'weapon') this.hud.setOwned(this.weapons.owned)
    }
    this.hud.clearKillFeed()
    this.hud.setStorm(false)
    this.hud.setStormTimer(null)
    this.hud.setCarPrompt(null)
    this.hud.hideScoreboard()
    this.hud.hideVictory()
    this.hud.setTeamScores(0, 0, false)
    this.hud.setObjective('')
    this._applySettings()

    // HUD hooks
    this.weapons.onFire = () => {
      this.hud.setAmmo(this.weapons.ammo, this.weapons.magazine)
      this.player.notifyFired() // drives the shoot animation + aim facing
      if (this.weapons.def.melee) this.audio.whoosh()
      else this.audio.shoot(this.weapons.def.key)
    }
    this.weapons.onReloadStart = () => { this.hud.setReloading(true); this.audio.reload() }
    this.weapons.onReloadEnd = () => {
      this.hud.setReloading(false)
      this.hud.setAmmo(this.weapons.ammo, this.weapons.magazine)
    }
    this.spawner.onWaveStart = (w) => this.hud.setWave(w)
    this.spawner.onKill = (pos) => {
      this.score += 10
      this.enemyKills = (this.enemyKills || 0) + 1
      this.hud.setScore(this.score)
      if (pos) this.pickups.rollDrop(pos.x, pos.z)
    }
    this.weapons.onSwitch = (def, i) => {
      this._setWeaponViewmodel(def)
      this.player.setWeapon(def)
      this.hud.setWeapon(def, i)
      this.hud.setAmmo(this.weapons.ammo, this.weapons.magazine)
      this.hud.setReloading(false)
    }

    this.hud.setHp(this.player.hp, this.player.maxHp)
    this.hud.setScore(0)
    this.hud.setWave(1)
    this.hud.initWeapons(this.weapons.defs)
    this.hud.setOwned(this.weapons.owned)
    this.hud.setWeapon(this.weapons.def, this.weapons.index)
    this.hud.setAmmo(this.weapons.ammo, this.weapons.magazine)
    this.hud.setReloading(false)

    // Kick off asset loading; start() / onWelcome await this with a loading screen.
    this._ready = this._loadOptionalModels()
  }

  async _loadOptionalModels() {
    // Preload every weapon model so switching is instant, then mount the current.
    this.hud.setLoading('LOADING WEAPONS…', 20)
    await Promise.all(this.weapons.defs.map((d) =>
      this.assets.loadModel(`models/guns/${d.model}.gltf`)))
    this._setWeaponViewmodel(this.weapons.def)
    this.player.setWeapon(this.weapons.def)

    // Enemies are spawned over time, so the spawner clones this per enemy.
    this.spawner.enemyModelPath = 'models/characters/Character_Enemy.gltf'

    // Preload the character models so bots/enemies appear instantly (not after
    // "world loaded"). These are cached for every later clone.
    this.hud.setLoading('LOADING CHARACTERS…', 40)
    await Promise.all([
      this.assets.loadModel('models/characters/Character_Soldier.gltf'),
      this.assets.loadModel('models/characters/Character_Enemy.gltf'),
      this.assets.loadModel('models/characters/Character_Hazmat.gltf'),
    ])

    // Build the map (Battle Royale loads the big city).
    this.hud.setLoading(this.brMode ? 'BUILDING THE CITY…' : 'BUILDING WORLD…', 60)
    const { LevelBuilder } = await import('../systems/LevelBuilder.js')
    const mapKey = this.brMode ? 'royale' : this.selectedMap
    await new LevelBuilder({ world: this.world, assets: this.assets }).build(mapKey)

    // Spawn drivable cars (await their models so none pop in after load).
    this.hud.setLoading('DEPLOYING VEHICLES…', 82)
    await this._spawnCars()

    // Loot: BR gets weapons + shield/health; other combat modes get supply drops.
    const HALF = this.world.arenaRadius
    const drop = (type, n, minR = 8) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, r = minR + Math.random() * (HALF - minR - 4)
        this.pickups.spawn(type, Math.cos(a) * r, Math.sin(a) * r)
      }
    }
    // Every mode scatters weapon loot now (all guns are pickups).
    if (this.brMode) {
      this.pickups.scatterWeapons(this.weapons.defs, 22, HALF)
      drop('shield', 7); drop('health', 7); drop('ammo', 6)
    } else {
      this.pickups.scatterWeapons(this.weapons.defs, 16, HALF)
      drop('health', 6); drop('shield', 5); drop('ammo', 6)
    }

    // CPU players fill the match (online or offline) for bot modes.
    if (this.brMode) await this._spawnBots(12, 'fighter')
    else if (this.hnsMode) await this._spawnBots(8, 'hider')
    else if (this.ctfMode) await this._spawnCtfBots()
    else if (this.modeCfg) {
      if (this.modeCfg.jugg) await this._spawnJuggernaut()
      else if (this.modeCfg.infect) await this._spawnInfectBots(this.modeCfg.bots || 10, this.modeCfg.startZombies || 2)
      else await this._spawnBots(this.modeCfg.bots || 7, this.modeCfg.role || 'fighter')
    }

    // King of the Hill: a glowing capture ring at the center; bots contest it.
    if (this.kothMode) {
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(this.hillRadius, this.hillRadius, 0.3, 40, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
      )
      ring.position.set(0, 1.5, 0)
      this.world.scene.add(ring)
      this._hillMesh = ring
      const disc = new THREE.Mesh(
        new THREE.TorusGeometry(this.hillRadius, 0.18, 8, 48),
        new THREE.MeshBasicMaterial({ color: 0xffd24a })
      )
      disc.rotation.x = Math.PI / 2; disc.position.y = 0.12
      this.world.scene.add(disc)
      this.bots.forEach((b) => { b.objective = { x: 0, z: 0 } }) // bots fight over the hill
    }
    this.hud.setLoading('FINALIZING…', 96)
  }

  // Capture-the-Flag CPUs: enemy reds rush your flag, ally blues fight with you.
  async _spawnCtfBots() {
    this.myTeam = 'blue'
    this.player.team = 'blue'
    const NAMES = ['Ace', 'Blaze', 'Cyborg', 'Drift', 'Echo', 'Fang', 'Ghost', 'Havoc', 'Iris', 'Jolt', 'Kilo', 'Lynx']
    const baseOf = (t) => this.world.bases.find((b) => b.team === t)
    const ready = []
    let n = 0
    const spawnTeam = (team, count, char) => {
      const base = baseOf(team)
      const cx = base ? base.x : (team === 'red' ? this.world.arenaRadius * 0.6 : -this.world.arenaRadius * 0.6)
      const cz = base ? base.z : 0
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2
        const pos = new THREE.Vector3(cx + Math.cos(a) * 6, 0, cz + Math.sin(a) * 6)
        const bot = new Bot({ world: this.world, assets: this.assets, fx: this.weapons, name: NAMES[n++ % NAMES.length], position: pos, role: 'fighter', team, char: `models/characters/${char}.gltf` })
        bot.onDeath = (b, attacker) => this._onBotDeath(b, attacker)
        if (bot.ready) ready.push(bot.ready)
        this.bots.push(bot)
      }
    }
    spawnTeam('red', 4, 'Character_Enemy')  // enemies — go for YOUR flag
    spawnTeam('blue', 3, 'Character_Soldier') // allies — fight alongside you
    await Promise.all(ready)
  }

  // Infection: a couple of starting zombies (green, knife only) hunt the human
  // survivors; anyone stabbed to death turns. Last human standing wins.
  async _spawnInfectBots(count, startZombies) {
    this.player.team = 'human'
    this.playerZombie = false
    const NAMES = ['Ace', 'Blaze', 'Cyborg', 'Drift', 'Echo', 'Fang', 'Ghost', 'Havoc', 'Iris', 'Jolt', 'Kilo', 'Lynx']
    const HALF = this.world.arenaRadius
    const chars = ['Character_Soldier', 'Character_Hazmat', 'Character_Enemy']
    const ready = []
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.3
      const r = HALF * (0.35 + Math.random() * 0.5)
      const pos = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)
      const isZombie = i < startZombies
      const bot = new Bot({ world: this.world, assets: this.assets, fx: this.weapons, name: NAMES[i % NAMES.length], position: pos, role: isZombie ? 'zombie' : 'fighter', team: isZombie ? null : 'human', hp: isZombie ? 200 : 100, char: `models/characters/${chars[i % chars.length]}.gltf` })
      bot.onDeath = (b, attacker) => this._onBotDeath(b, attacker)
      if (isZombie) { bot.speed = 7.6; if (bot.ready) bot.ready.then(() => applyTint(bot.group, 0x55dd55)) }
      if (bot.ready) ready.push(bot.ready)
      this.bots.push(bot)
    }
    await Promise.all(ready)
  }

  // Turn a human bot into a zombie (green, knife-melee AI) without killing it.
  _infectBot(bot) {
    bot.alive = true; bot.dying = false; bot.removeTimer = 0
    bot.role = 'zombie'; bot.team = null; bot.hp = bot.maxHp; bot.tag.visible = true
    bot.objective = null; bot.forceGoal = null; bot.carrying = null
    applyTint(bot.group, 0x55dd55)
    bot.animator?.play?.('Idle', { fade: 0.1 })
    this.hud.addKillFeed(`🧟 ${bot.name} got infected!`)
  }

  // ---- Lobby presence: show who's online + what they're playing ----
  _serverUrl() {
    return (document.getElementById('mp-server')?.value || 'wss://toon-shooter-server.onrender.com').trim()
  }
  _connectPresence() {
    if (this._presenceWs && this._presenceWs.readyState <= 1) return
    let ws
    try { ws = new WebSocket(this._serverUrl()) } catch { return }
    this._presenceWs = ws
    ws.addEventListener('open', () => {
      const name = localStorage.getItem('ts_name') || document.getElementById('mp-name')?.value || 'Player'
      ws.send(JSON.stringify({ t: 'hello', name }))
    })
    ws.addEventListener('message', (e) => {
      let m; try { m = JSON.parse(e.data) } catch { return }
      if (m.t === 'presence') this._renderOnline(m.list)
    })
    ws.addEventListener('close', () => {
      if (this._presenceWs === ws) this._presenceWs = null
      if (this.state === STATE.MENU) setTimeout(() => { if (this.state === STATE.MENU) this._connectPresence() }, 4000)
    })
    ws.addEventListener('error', () => {})
  }
  _closePresence() {
    if (this._presenceWs) { try { this._presenceWs.close() } catch {} this._presenceWs = null }
  }
  _renderOnline(list) {
    const el = document.getElementById('online-list')
    const cnt = document.getElementById('online-count')
    if (cnt) cnt.textContent = list.length
    if (!el) return
    const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
    if (!list.length) { el.innerHTML = '<li class="on-empty">No one online right now.</li>'; return }
    el.innerHTML = list.map((p) => {
      const joinable = p.inMatch && p.room
      return `<li><span class="on-dot ${p.inMatch ? 'in' : ''}"></span><span class="on-name">${esc(p.name)}</span><span class="on-mode">${esc(p.modeLabel)}</span>${joinable ? `<button class="on-join" data-room="${esc(p.room)}" data-mode="${esc(p.mode)}">JOIN</button>` : ''}</li>`
    }).join('')
    el.querySelectorAll('.on-join').forEach((b) => b.addEventListener('click', () => {
      document.getElementById('mp-room').value = b.dataset.room
      const tile = document.querySelector(`.event-tile[data-mode="${b.dataset.mode}"]`)
      if (tile) { document.querySelectorAll('.event-tile').forEach((t) => t.classList.remove('active')); tile.classList.add('active') }
      this.startOnline(b.dataset.mode)
    }))
  }
  _onKicked(reason) {
    const msg = reason === 'banned' ? 'You were banned from this room.' : 'You were kicked by the host.'
    this._disconnect()
    if (this.state !== STATE.MENU) this._toLobby()
    window.alert(msg)
  }

  // ---- In-game Claude assistant ----
  _wireAssistant() {
    const $ = (id) => document.getElementById(id)
    const panel = $('ai-panel'), log = $('ai-log')
    const PASSWORD = '115243'
    const unlocked = () => localStorage.getItem('ts_ai_unlocked') === '1'
    const reveal = () => {
      $('ai-lock').classList.add('hidden'); $('ai-main').classList.remove('hidden')
      if (!this.assistant.hasKey()) $('ai-keybox').open = true
    }
    if (unlocked()) reveal()
    if (this.assistant.hasKey()) $('ai-key').value = localStorage.getItem('ts_anthropic_key')

    const addMsg = (cls, text) => {
      const d = document.createElement('div'); d.className = 'ai-msg ' + cls; d.textContent = text
      log.appendChild(d); log.scrollTop = log.scrollHeight
    }
    const open = () => {
      panel.classList.remove('hidden'); this._aiOpen = true
      if (this.state === STATE.PLAYING && !this.input.isTouch) this.input.exitLock()
      ;(unlocked() ? $('ai-input') : $('ai-pass'))?.focus()
    }
    const close = () => {
      panel.classList.add('hidden'); this._aiOpen = false
      if (this.state === STATE.PLAYING && !this.input.isTouch && !this.input.locked) this.input.requestLock()
    }
    this._toggleAi = () => panel.classList.contains('hidden') ? open() : close()
    $('ai-btn').addEventListener('click', this._toggleAi)
    $('ai-close').addEventListener('click', close)

    const tryUnlock = () => {
      if ($('ai-pass').value.trim() === PASSWORD) { localStorage.setItem('ts_ai_unlocked', '1'); $('ai-lock-msg').textContent = ''; reveal(); $('ai-input').focus() }
      else $('ai-lock-msg').textContent = 'Incorrect password.'
    }
    $('ai-unlock').addEventListener('click', tryUnlock)
    $('ai-pass').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.code === 'Enter') tryUnlock() })

    $('ai-key-save').addEventListener('click', () => {
      const k = $('ai-key').value.trim()
      if (k) { localStorage.setItem('ts_anthropic_key', k); $('ai-keybox').open = false; addMsg('ai-bot', '✅ API key saved. Ask me anything — I can control the game.') }
    })
    $('ai-key').addEventListener('keydown', (e) => e.stopPropagation())

    const send = () => {
      const t = $('ai-input').value.trim(); if (!t) return
      $('ai-input').value = ''; addMsg('ai-user', t)
      this.assistant.send(t, (txt) => addMsg('ai-bot', txt), (tool) => addMsg('ai-tool', '⚙ ' + tool))
    }
    $('ai-send').addEventListener('click', send)
    $('ai-input').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.code === 'Enter') send() })
  }

  // Execute an assistant tool against the live game.
  async _aiExec(name, input = {}) {
    const W = this.weapons
    switch (name) {
      case 'get_state': return {
        state: this.state, mode: this.onlineMode || this.soloMode || null, online: !!this.net,
        hp: this.player?.hp, maxHp: this.player?.maxHp, shield: this.player?.shield, alive: this.player?.alive,
        weapon: W?.def?.key, ownedWeapons: [...(W?.owned || [])].map((i) => W.defs[i]?.key),
        coins: this._coins(), character: this.character, bots: this.bots?.length || 0,
        kills: this.kills || this.enemyKills || 0, settings: this.settings,
      }
      case 'start_match': this.startOnline(input.mode); return 'Starting ' + input.mode
      case 'set_setting': this.settings[input.key] = input.value; localStorage.setItem('ts_settings', JSON.stringify(this.settings)); this._applySettings(); return `${input.key} = ${input.value}`
      case 'give_weapon': {
        const i = W.defs.findIndex((d) => d.key.toLowerCase() === String(input.weapon).toLowerCase())
        if (i < 0) return 'No weapon named ' + input.weapon
        W.give(i); this.hud.setOwned(W.owned); return 'Gave ' + W.defs[i].key
      }
      case 'give_all_weapons': W.defs.forEach((d, i) => W.owned.add(i)); W.ammoByWeapon = W.defs.map((d) => d.mag); this.hud.setOwned(W.owned); return 'Gave all weapons'
      case 'set_health': this.player.hp = Math.max(0, Math.min(this.player.maxHp, input.hp)); this.hud.setHp(this.player.hp, this.player.maxHp); return 'HP = ' + this.player.hp
      case 'set_shield': this.player.shield = Math.max(0, Math.min(100, input.shield)); this.hud.setShield(this.player.shield); return 'Shield = ' + this.player.shield
      case 'god_mode': this._god = !!input.on; if (this._god) { this.player.hp = this.player.maxHp; this.player.shield = 100 } return 'God mode ' + (this._god ? 'ON' : 'off')
      case 'spawn_bots': await this._spawnBots(Math.max(1, Math.min(20, input.count || 4)), input.role || 'fighter'); return `Spawned ${input.count} bots`
      case 'add_coins': this._setCoins(this._coins() + input.amount); this._populateLobby(); return 'Coins = ' + this._coins()
      case 'unlock_skin': { const o = this._ownedSkins(); o.push(input.id); this._saveOwned(o); this._renderLocker(); this._renderStore(); return 'Unlocked ' + input.id }
      case 'set_skin': this.character = input.id; localStorage.setItem('ts_char', this.character); this._setLobbyCharacter(this.character); this._populateLobby(); return 'Skin = ' + input.id
      case 'announce': this.hud.addKillFeed('🤖 ' + input.text); return 'Announced'
      case 'eval_js': {
        const game = this // eslint-disable-line no-unused-vars
        // eslint-disable-next-line no-eval
        const r = eval(input.code)
        return r === undefined ? '(ok)' : (typeof r === 'object' ? JSON.stringify(r) : String(r))
      }
      default: return 'Unknown tool: ' + name
    }
  }

  async _toggleVoice() {
    if (!this.voice) { this.hud.addChat('System', 'Voice needs an online match.', { self: true }); return }
    const on = await this.voice.toggle()
    document.getElementById('mic-btn')?.classList.toggle('on', on)
    this.hud.addChat('System', on ? '🎤 Voice ON — talk to nearby players (M to mute).' : '🔇 Voice off.', { self: true })
  }

  _openChat() {
    this._chatOpen = true
    if (!this.input.isTouch) this.input.exitLock() // free the cursor to type (guarded: no pause)
    this.hud.openChatInput()
  }
  _closeChat() {
    this._chatOpen = false
    this.hud.closeChatInput()
    // Re-grab the pointer so you can keep playing (desktop).
    if (this.state === STATE.PLAYING && !this.input.isTouch && !this.input.locked) this.input.requestLock()
  }
  _sendChat(text) {
    if (!text) return
    if (this.net) this.net.sendChat(text)
    else this.hud.addChat(this._selfName || 'You', text, { self: true, near: true }) // offline echo
  }

  // Drop the current weapon as loot (X / DROP button). Keeps knife + grapple.
  _discardWeapon() {
    const i = this.weapons.index
    const def = this.weapons.defs[i]
    if (!def || def.melee || def.tool) return
    if (this.weapons.discard(i)) {
      const p = this.player.position
      this.pickups.spawnWeapon({ index: i, model: def.model, key: def.key }, p.x + 2.5, p.z)
      this.hud.setOwned(this.weapons.owned)
      this.hud.addKillFeed(`🗑 Dropped ${def.label || def.key}`)
    }
  }

  // The player got stabbed to death → respawn as a knife-only zombie.
  _infectPlayer() {
    this.playerZombie = true
    this.player.isZombie = true
    this.player.alive = true
    this.player.hp = this.player.maxHp
    this.player.team = null
    this.weapons.setLoadout([11]) // knife only
    this.weapons.switchTo(11)
    this.hud.setOwned(this.weapons.owned)
    this.hud.setZombie?.(true)
    this.hud.addKillFeed('🧟 YOU WERE INFECTED — hunt the survivors! (knife only)')
  }

  async _spawnJuggernaut() {
    const pos = new THREE.Vector3(0, 0, -this.world.arenaRadius * 0.4)
    const jug = new Bot({ world: this.world, assets: this.assets, fx: this.weapons, name: 'JUGGERNAUT', position: pos, role: 'fighter', hp: 1600, scale: 2.0 })
    jug.damage = 16; jug.speed = 4
    jug.onDeath = (b, attacker) => this._onBotDeath(b, attacker)
    this.jugg = jug; this.bots.push(jug)
    if (jug.ready) await jug.ready
  }

  async _spawnBots(count, role = 'fighter') {
    const NAMES = ['Ace', 'Blaze', 'Cyborg', 'Drift', 'Echo', 'Fang', 'Ghost', 'Havoc', 'Iris', 'Jolt', 'Kilo', 'Lynx', 'Nova', 'Onyx', 'Pyro', 'Rook']
    const HALF = this.world.arenaRadius
    const ready = []
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.3
      const r = HALF * (0.35 + Math.random() * 0.5)
      const pos = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)
      const chars = ['Character_Soldier', 'Character_Hazmat', 'Character_Enemy']
      const char = `models/characters/${chars[i % chars.length]}.gltf`
      const bot = new Bot({ world: this.world, assets: this.assets, fx: this.weapons, name: NAMES[i % NAMES.length], position: pos, role, char })
      bot.onDeath = (b, attacker) => this._onBotDeath(b, attacker)
      if (bot.ready) ready.push(bot.ready)
      this.bots.push(bot)
    }
    await Promise.all(ready) // wait for bot models before the match starts
  }

  _onBotDeath(bot, attacker) {
    // Infection: a human stabbed to death by a zombie (bot or zombie-player)
    // converts instead of dying.
    if (this.infectMode && bot.role === 'fighter') {
      const byZombie = attacker ? attacker.role === 'zombie' : this.playerZombie
      if (byZombie) { this._infectBot(bot); return }
    }
    const killer = attacker ? attacker.name : (this._selfName || 'You')
    this.hud.addKillFeed(`${killer} ▸ ${bot.name}`)
    if (attacker && attacker.kills != null) attacker.kills++
    if (!attacker) {
      this.kills = (this.kills || 0) + 1 // player kill (no bot attacker)
      this.hud.showKillBanner(`ELIMINATED ${bot.name}`)
      // Gun Game: each kill hands you a random gun (melee/grapple excluded — your
      // knife stays as a constant backup).
      if (this.modeCfg?.gungame) {
        this.ggLevel++
        const pool = this.weapons.defs.map((d, i) => i).filter((i) => {
          const d = this.weapons.defs[i]; return !d.tool && !d.melee
        })
        const idx = pool[Math.floor(Math.random() * pool.length)]
        this.weapons.give(idx)
        this.hud.setOwned(this.weapons.owned)
      }
    }
  }

  // Floating damage number at a world point.
  _damageNumber(worldPos, amount, head) {
    const v = worldPos.clone().project(this.camera)
    if (v.z > 1) return
    const x = (v.x * 0.5 + 0.5) * window.innerWidth
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight
    this.hud.damageNumber(x, y, amount, head)
  }

  // Track kill streaks and show a banner (Double/Triple/Multi/Rampage Kill).
  _playerKill() {
    const now = performance.now() / 1000
    this._streak = (now - this._lastKillT < 4) ? this._streak + 1 : 1
    this._lastKillT = now
    if (this._streak >= 2) this.hud.killStreak(this._streak)
    // Live kills counter: online shows k/d (handled in _onKilled), co-op shows
    // score points; every other solo mode shows your kill tally up top.
    const mode = this.onlineMode || this.soloMode
    if (!this.net && mode !== 'coop') this.hud.setScore(this.kills || 0)
  }

  async _spawnCars() {
    this._carLoads = []
    const spots = this.world.carSpawns
    if (!spots || !spots.length) return
    // Cars from the uploaded pack (.dae). City car dropped per request.
    const paths = ['models/cars/Models/Car 1.dae', 'models/cars/Models/Car 2.dae']
    const MAX = Math.min(spots.length, 14) // cap cars for performance
    for (let i = 0; i < MAX; i++) {
      const s = spots[Math.floor((i / MAX) * spots.length)]
      const car = new Vehicle({ world: this.world, x: s.x, z: s.z, heading: (i * 1.3) % (Math.PI * 2) })
      this.cars.push(car)
      const path = paths[i % paths.length]
      const loaded = path.endsWith('.glb')
        ? this.assets.loadModel(path).then((m) => m && m.scene)
        : this.assets.loadCollada(path)
      this._carLoads.push(loaded.then((scene) => { if (scene) car.setModel(scene) }))
    }
    await Promise.all(this._carLoads) // models ready before the match starts
  }

  // Quick melee: short-range strike in front of you.
  _melee() {
    this._meleeCd = 0.5
    this.player.recoil = Math.min(0.22, (this.player.recoil || 0) + 0.16) // viewmodel kick
    this.audio?.hit?.()
    const aim = this.player.getAimRay()
    this._meleeRay = this._meleeRay || new THREE.Raycaster()
    this._meleeRay.set(aim.origin, aim.dir); this._meleeRay.far = 4
    const targets = [...this.spawner.enemies, ...this.bots]
    const remotes = this.net ? [...this.remotePlayers.values()] : []
    const meshes = []
    for (const t of targets) if (t.alive && t.hitMesh) meshes.push(t.hitMesh)
    for (const r of remotes) if (r.hitMesh) meshes.push(r.hitMesh)
    const hits = this._meleeRay.intersectObjects(meshes, true)
    if (!hits.length) return
    const obj = hits[0].object
    const enemy = targets.find((t) => t.hitMesh === obj)
    this.particles.emit(hits[0].point, 6, { color: [1, 0.9, 0.5], speed: 4, size: 0.5, life: 0.25 })
    if (enemy) {
      const killed = enemy.takeHit(60)
      if (killed) { this.hud.hitMarker(true); this.audio.kill() } else this.hud.hitMarker(false)
    } else {
      const rp = obj.userData?.remote
      if (rp && this.net && this._relationTo(rp.team) !== 'ally') { this.net.sendHit(rp.id, 60); this.hud.hitMarker(false) }
    }
  }

  // Grapple: zip to wherever you're aiming (props, ground).
  _fireGrapple() {
    const aim = this.player.getAimRay()
    this._grappleRay = this._grappleRay || new THREE.Raycaster()
    this._grappleRay.set(aim.origin, aim.dir)
    this._grappleRay.far = 140
    const meshes = this.world.obstacles.map((o) => o.mesh).filter(Boolean)
    const hits = this._grappleRay.intersectObjects(meshes, true)
    let point = null
    if (hits.length) point = hits[0].point.clone()
    else if (aim.dir.y < -0.02) { // fall back to the ground plane
      const t = (this.world.groundY - aim.origin.y) / aim.dir.y
      if (t > 1 && t < 140) point = aim.origin.clone().addScaledVector(aim.dir, t)
    }
    if (!point) return
    point.y += 1.2
    const muzzle = this.player.getMuzzleWorldPosition(this._muzzle)
    this.weapons.beam(muzzle, point, 0x66ffcc, 0.3) // zipline line
    this.particles.emit(point, 8, { color: [0.4, 1, 0.8], speed: 4, size: 0.5, life: 0.4 })
    this.player.startGrapple(point)
    this.audio?.jumpPad?.()
  }

  // Enter the nearest car, or exit the one being driven (toggled by E).
  _toggleCar() {
    if (this.driving) {
      const car = this.driving
      this.driving = null
      car.occupied = false
      const sx = Math.cos(car.heading), sz = -Math.sin(car.heading)
      this.player.position.set(car.position.x + sx * 2.8, 0, car.position.z + sz * 2.8)
      this.player.velocity.set(0, 0, 0)
      if (this.player.gun) this.player.gun.visible = true
      return
    }
    let best = null, bd = 3.6
    for (const car of this.cars) {
      const d = Math.hypot(this.player.position.x - car.position.x, this.player.position.z - car.position.z)
      if (d < bd) { bd = d; best = car }
    }
    if (best) {
      this.driving = best
      best.occupied = true
      if (this.player.gun) this.player.gun.visible = false
    }
  }

  _driveUpdate(dt) {
    const car = this.driving
    this.input.consumeMouseDelta() // discard look-deltas so FPS cam doesn't snap on exit
    let throttle = 0, steer = 0
    if (this.input.isDown('KeyW')) throttle += 1
    if (this.input.isDown('KeyS')) throttle -= 1
    if (this.input.isDown('KeyD')) steer += 1
    if (this.input.isDown('KeyA')) steer -= 1
    throttle += this.input.touchMove.y || 0
    steer += this.input.touchMove.x || 0
    throttle = Math.max(-1, Math.min(1, throttle))
    steer = Math.max(-1, Math.min(1, steer))
    car.update(dt, { throttle, steer })
    // The player rides along (keeps storm damage, score, networking working).
    this.player.position.set(car.position.x, 0, car.position.z)
    this.player.velocity.set(0, 0, 0)
    this.player.onGround = true
    this._driveCamera(dt, car)
  }

  // Third-person chase camera behind the car.
  _driveCamera(dt, car) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading)
    this._camTarget = this._camTarget || new THREE.Vector3()
    this._camTarget.set(car.position.x - fx * 9, 6.5, car.position.z - fz * 9)
    this.camera.position.lerp(this._camTarget, Math.min(1, dt * 6))
    this.camera.lookAt(car.position.x + fx * 4, 2, car.position.z + fz * 4)
  }

  // Swap the FPS viewmodel to the given weapon def (cached load -> instant).
  _setWeaponViewmodel(def) {
    this.assets.loadModel(`models/guns/${def.model}.gltf`).then((m) => {
      if (m && this.weapons.def === def) this.player.setViewmodel(m.scene)
    })
  }

  async start(mode = 'coop') {
    this.audio.resume()
    this.audio.stopMusic()
    this._closePresence()
    this.onlineMode = null // solo
    this.soloMode = mode
    this.brMode = mode === 'br'
    this.hnsMode = mode === 'hns' // Hide & Seek: you're the seeker vs bot hiders
    if (SOLO_MODES[mode]?.map) this.selectedMap = SOLO_MODES[mode].map // each mode its own world
    this._disconnect() // solo play: drop any prior connection
    this.hud.showVoteToggle(false)
    this.state = STATE.LOADING
    this._stopLobby()
    this.hud.hideOverlay()
    this.hud.showLoading()
    this._resetGameObjects() // sets this._ready
    await this._ready        // wait for world + assets, with the loading screen up
    await this._dropIn()     // "WORLD FOUND" -> click to drop in (locks the mouse)
    this.state = STATE.PLAYING
    this.hud.show()
    this.hud.setPlayerCount(null) // solo: no online counter
    this.clock.getDelta() // reset dt
    this._loop()
  }

  // Show "WORLD FOUND AND LOADED" then wait for a click to drop in. The click is
  // a real user gesture, so pointer lock (and therefore shooting/aiming) works.
  async _dropIn() {
    this.hud.loadingReady()
    if (this.input.isTouch) { await wait(700); this.hud.hideLoading(); return }
    this.hud.setLoading('▶ CLICK TO DROP IN')
    await new Promise((res) => {
      const onClick = () => { this.hud.el.loading.removeEventListener('click', onClick); res() }
      this.hud.el.loading.addEventListener('click', onClick)
    })
    this.input.requestLock() // within the click's user-activation window
    this.hud.hideLoading()
  }

  // Connect to the relay server, then drop in once joined. Works for every mode
  // (bot modes spawn CPUs to fill; PvP modes wait for humans).
  startOnline(modeOverride) {
    this.audio.resume()
    this.audio.stopMusic()
    this._closePresence() // the match connection registers presence instead
    const status = document.getElementById('mp-status')
    const name = (document.getElementById('mp-name').value || '').trim() || `Player${Math.floor(Math.random() * 1000)}`
    const roomName = (document.getElementById('mp-room').value || 'lobby').trim()
    const url = (document.getElementById('mp-server').value || 'wss://toon-shooter-server.onrender.com').trim()
    const mode = modeOverride || document.querySelector('.event-tile.active')?.dataset.mode || document.querySelector('.mode-btn.active')?.dataset.mode || 'coop'
    this.onlineMode = mode
    this.brMode = mode === 'br'
    this.hnsMode = mode === 'hns'
    if (SOLO_MODES[mode]?.map) this.selectedMap = SOLO_MODES[mode].map
    this._fellBack = false
    // Separate room per event so modes never mix.
    const room = `${mode}:${roomName}`
    status.textContent = 'Connecting…'

    this._disconnect()
    this.state = STATE.LOADING
    this._stopLobby()
    this.hud.hideOverlay()
    this.hud.showLoading()
    this.hud.setLoading('CONNECTING TO SERVER…', 30)
    this._resetGameObjects()

    this.net = new Net({
      url, name, room, mode: this.onlineMode,
      handlers: {
        onRtc: (fromId, data) => this.voice?.onSignal(fromId, data),
        onWelcome: async (id, peers, team) => {
          status.textContent = ''
          this.myTeam = team
          this.peerNames.set(id, this._selfName)
          this.kills = 0; this.deaths = 0
          this.hud.setScore('0/0')
          // Scoreboard: id -> { name, kills, deaths, team }
          this.board = new Map()
          this.board.set(id, { name: this._selfName, kills: 0, deaths: 0, team })
          for (const peer of peers) {
            this._addRemote(peer.id, peer.name, peer.p, peer.team)
            this.board.set(peer.id, { name: peer.name, kills: 0, deaths: 0, team: peer.team })
          }
          this.hud.setLoading('LOADING WORLD…', 70)
          await this._ready
          await this._dropIn()
          this.state = STATE.PLAYING
          this.hud.hideOverlay()
          this.hud.show()
          this.hud.showVoteToggle(true)
          this.hud.setPlayerCount(this.remotePlayers.size + 1)
          if (this.isAdmin) this.hud.addChat('System', "You're the host — type /ban <name> or /kick <name>", { self: true })
          if (this.ctfMode) { this._needBaseSpawn = true; this.hud.setTeamScores(0, 0, true) }
          this.clock.getDelta()
          this._loop()
        },
        onPeerJoin: (id, pname, team) => {
          this._addRemote(id, pname, null, team)
          this.board?.set(id, { name: pname, kills: 0, deaths: 0, team })
          this.hud.setPlayerCount(this.remotePlayers.size + 1)
          this.hud.addChat('System', `${pname} joined`, { self: true })
        },
        onPeerLeave: (id) => {
          this.remotePlayers.get(id)?.dispose()
          this.remotePlayers.delete(id)
          this.board?.delete(id)
          this.hud.setPlayerCount(this.remotePlayers.size + 1)
        },
        onState: (id, p) => this.remotePlayers.get(id)?.setState(p),
        onShoot: (id, from, to) => {
          if (from && to) {
            const a = new THREE.Vector3(from[0], from[1], from[2])
            this.weapons.beam(a, new THREE.Vector3(to[0], to[1], to[2]), 0x9ad0ff, 0.06)
            this.weapons.flash(a, 0xffd24a) // muzzle flash at the shooter
          }
        },
        onChat: (id, name, text, p) => {
          // Proximity: in a match, dim/mark messages from far-away players.
          let near = true
          if (this.state === STATE.PLAYING && p && this.player) {
            near = Math.hypot(this.player.position.x - p[0], this.player.position.z - p[2]) < 45
          }
          this.hud.addChat(name, text, { self: id === this.net?.id, near })
        },
        onPresence: (list) => this._renderOnline(list),
        onAdmin: (v) => { this.isAdmin = v },
        onKicked: (reason) => this._onKicked(reason),
        onHit: (fromId, dmg) => {
          if (!this.player.alive) return
          this._lastAttacker = fromId
          this.player.takeDamage(dmg)
        },
        onKilled: (byId, victimId) => this._onKilled(byId, victimId),
        onVotes: (tally) => this.hud.setVotes(tally),
        onMapChange: (map) => this._applyMapChange(map),
        onCtf: (ctf) => {
          this.ctf = ctf
          this.flags?.setState(ctf)
          this.hud.setTeamScores(ctf.scores.red, ctf.scores.blue, this.ctfMode)
        },
        onWin: (msg) => this._onWin(msg),
        onError: () => {
          // Server unreachable: fall back to an offline match so you still drop in.
          if (this._fellBack || this.state === STATE.PLAYING) return
          this._fellBack = true
          status.textContent = 'Server offline — playing solo with bots.'
          this._disconnect()
          this.start(mode)
        },
        onClose: () => { if (this.state === STATE.PLAYING) status.textContent = 'Disconnected.' },
      },
    })
    this.peerNames = new Map([[this.net?.id, name]]) // updated on welcome
    this._selfName = name
    this.voice = new Voice(this.net) // proximity mic chat (opt-in via 🎤)
  }

  _addRemote(id, name, state, team) {
    if (this.remotePlayers.has(id)) return
    const rp = new RemotePlayer({ world: this.world, assets: this.assets, name, id, fx: this.particles })
    rp.team = team
    if (state) rp.setState(state)
    rp.setTeamColor(this._relationTo(team))
    this.remotePlayers.set(id, rp)
    this.peerNames?.set(id, name)
  }

  // ally / enemy / null — teams matter in Team Deathmatch and CTF.
  _relationTo(team) {
    if ((this.onlineMode !== 'team' && this.onlineMode !== 'ctf') || !team || !this.myTeam) return null
    return team === this.myTeam ? 'ally' : 'enemy'
  }

  _handleMpDeath() {
    if (this._deadHandled) return
    this._deadHandled = true
    this.net.sendKilled(this._lastAttacker ?? null)
    this.kills = this.kills || 0
    this.deaths = (this.deaths || 0) + 1
    this.hud.setScore(`${this.kills}/${this.deaths}`)
    // CTF: drop the enemy flag where you died.
    if (this.ctfMode && this.ctf && this.myTeam) {
      const enemyColor = this.myTeam === 'red' ? 'blue' : 'red'
      if (this.ctf.flags[enemyColor]?.holder === this.net.id) {
        this.net.sendFlagDrop(enemyColor, this.player.position.x, this.player.position.z)
      }
    }
    // Battle royale = no respawn; you're eliminated.
    if (this.brMode) {
      this.state = STATE.DEAD
      if (!this.input.isTouch) this.input.exitLock()
      this._recordMatch(false)
      this.hud.showMatchSummary(this._summary)
      this.hud.showPause('ELIMINATED', `Kills: ${this.kills}.`, 'PLAY AGAIN')
      return
    }
    setTimeout(() => this._respawn(), 1800)
  }

  _respawn() {
    // CTF/team: respawn at your base; otherwise a random edge.
    const base = (this.ctfMode || this.onlineMode === 'team') && this.world.bases.find((b) => b.team === this.myTeam)
    if (base) {
      this.player.position.set(base.x + (Math.random() - 0.5) * 6, 0, base.z + (Math.random() - 0.5) * 6)
    } else {
      const a = Math.random() * Math.PI * 2
      const r = this.world.arenaRadius - 6
      this.player.position.set(Math.cos(a) * r, 0, Math.sin(a) * r)
    }
    this.player.velocity.set(0, 0, 0)
    this.player.hp = this.player.maxHp
    this.player.alive = true
    this._prevHp = this.player.hp
    this._deadHandled = false
    this._lastAttacker = null
  }

  // A vote finished: rebuild the world on the winning map without dropping the
  // network connection; re-add the known peers.
  _applyMapChange(map) {
    this.selectedMap = map
    this.hud.hideVotePanel()
    this.hud.addKillFeed(`Map vote → ${map}`)
    const peers = [...this.remotePlayers.values()].map((rp) => ({ id: rp.id, name: rp.name, team: rp.team }))
    this._resetGameObjects() // rebuilds world/camera/player; leaves this.net intact
    for (const p of peers) this._addRemote(p.id, p.name, null, p.team)
    this.hud.showVoteToggle(true)
    if (this.state === STATE.PLAYING && !this.input.isTouch) this.input.requestLock()
  }

  // Show the victory/defeat screen and stop play.
  _winMatch(title, sub, win = true) {
    this.state = STATE.DEAD
    if (!this.input.isTouch) this.input.exitLock()
    this._recordMatch(win)
    this.hud.showMatchSummary(this._summary)
    this.hud.showVictory(title, sub, win)
  }

  _onWin(msg) {
    if (msg.reason === 'ctf') {
      const won = msg.team === this.myTeam
      this._winMatch(won ? 'VICTORY' : 'DEFEAT', `${String(msg.team).toUpperCase()} team wins the flag battle!`, won)
    } else if (msg.reason === 'br') {
      const won = msg.id === this.net?.id
      this._winMatch(won ? '#1 VICTORY ROYALE' : 'Match Over', won ? "You're the last one standing." : 'Better luck next drop.', won)
    }
  }

  _doBaseSpawn() {
    const b = this.world.bases.find((bb) => bb.team === this.myTeam)
    if (b) { this.player.position.set(b.x, 0, b.z); this.player.velocity.set(0, 0, 0) }
  }

  _flagCtx() {
    return { localId: this.net?.id, localPos: this.player.position, remotePlayers: this.remotePlayers }
  }

  // Self-contained CTF vs CPUs (used when no human opponents are present). Two
  // flags, local pickup/capture, bots that rush and carry flags, first to 3 wins.
  _initLocalCtf() {
    this.localCtf = {
      flags: { red: { state: 'home', x: 0, z: 0, holder: null }, blue: { state: 'home', x: 0, z: 0, holder: null } },
      scores: { red: 0, blue: 0 },
    }
    this._ctfRot = 0
  }

  _updateLocalCtf(dt) {
    const lc = this.localCtf
    if (!lc || !this.flags) return
    const baseOf = (t) => { const b = this.world.bases.find((bb) => bb.team === t); return b ? { x: b.x, z: b.z } : { x: t === 'red' ? 40 : -40, z: 0 } }
    const home = { red: baseOf('red'), blue: baseOf('blue') }
    const flagPos = (t) => {
      const f = lc.flags[t]
      if (f.state === 'carried' && f.holder) return { x: f.holder.position.x, z: f.holder.position.z }
      if (f.state === 'dropped') return { x: f.x, z: f.z }
      return home[t]
    }
    const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz)

    // A carrier that died drops the flag where it fell.
    for (const t of ['red', 'blue']) {
      const f = lc.flags[t]
      if (f.state === 'carried' && (!f.holder || !f.holder.alive)) {
        const fp = flagPos(t)
        f.state = 'dropped'; f.x = fp.x; f.z = fp.z
        if (f.holder && f.holder !== this.player) { f.holder.carrying = null; f.holder.forceGoal = null }
        f.holder = null
        this.hud.addKillFeed(`🏳 The ${t.toUpperCase()} flag was dropped`)
      }
    }

    // Player (blue) — grab the red flag, run it home, return your own.
    const P = this.player, mine = 'blue', enemy = 'red'
    const ef = lc.flags[enemy], mf = lc.flags[mine]
    if (P.alive) {
      if (ef.state !== 'carried') {
        const fp = flagPos(enemy)
        if (dist2(P.position.x, P.position.z, fp.x, fp.z) < 3) { ef.state = 'carried'; ef.holder = P; this.hud.addKillFeed('🚩 You grabbed the RED flag!') }
      }
      if (ef.holder === P && dist2(P.position.x, P.position.z, home[mine].x, home[mine].z) < 5.5) {
        lc.scores.blue++; ef.state = 'home'; ef.holder = null
        this.hud.addKillFeed(`🏁 You captured! BLUE ${lc.scores.blue}`)
      }
      if (mf.state === 'dropped' && dist2(P.position.x, P.position.z, mf.x, mf.z) < 3) { mf.state = 'home'; mf.holder = null; this.hud.addKillFeed('↩ You returned your flag') }
    }

    // Bots — reds attack your flag, blues attack theirs; carriers run home.
    for (const bot of this.bots) {
      if (!bot.alive || !bot.team) continue
      const bt = bot.team, ot = bt === 'red' ? 'blue' : 'red'
      const of = lc.flags[ot], ownf = lc.flags[bt]
      if (bot.carrying) {
        bot.forceGoal = home[bt]
        if (dist2(bot.position.x, bot.position.z, home[bt].x, home[bt].z) < 5.5) {
          lc.scores[bt]++; of.state = 'home'; of.holder = null
          bot.carrying = null; bot.forceGoal = null; bot.objective = null
          this.hud.addKillFeed(`🏴 ${bot.name} captured the ${ot.toUpperCase()} flag!`)
        }
      } else {
        bot.forceGoal = null
        if (of.state !== 'carried' && of.holder !== bot) {
          const fp = flagPos(ot); bot.objective = fp
          if (dist2(bot.position.x, bot.position.z, fp.x, fp.z) < 2.5) {
            of.state = 'carried'; of.holder = bot; bot.carrying = ot
            this.hud.addKillFeed(`🚩 ${bot.name} took the ${ot.toUpperCase()} flag!`)
          }
        } else {
          bot.objective = home[bt] // defend home when the flag is already taken
        }
      }
    }

    // Render both flags.
    this._ctfRot += dt * 1.2
    for (const t of ['red', 'blue']) {
      const fp = flagPos(t), m = this.flags.flags[t]
      m.position.set(fp.x, lc.flags[t].state === 'carried' ? 0.2 : 0, fp.z)
      m.rotation.y = this._ctfRot
    }

    // HUD + win.
    this.hud.setTeamScores(lc.scores.red, lc.scores.blue, true)
    let obj = 'Capture the RED flag →'
    if (ef.holder === P) obj = '🚩 You have the RED flag — run it to base!'
    else if (mf.state !== 'home') obj = '⚠ Your flag is taken — stop them!'
    this.hud.setObjective(obj)
    const TARGET = 3
    if (!this._matchOver) {
      for (const t of ['red', 'blue']) {
        if (lc.scores[t] >= TARGET) {
          this._matchOver = true
          const won = t === mine
          this._winMatch(won ? 'VICTORY' : 'DEFEAT', `${t.toUpperCase()} wins the flag battle ${lc.scores.blue}–${lc.scores.red}!`, won)
        }
      }
    }
  }

  // Capture-the-Flag interactions (run each frame in CTF). Server is authoritative;
  // we just send intents based on proximity and render flags.
  _updateCtf(dt) {
    if (this._needBaseSpawn && this.world.bases.length) { this._doBaseSpawn(); this._needBaseSpawn = false }
    const id = this.net?.id
    if (this.ctf && this.myTeam && id != null) {
      const myColor = this.myTeam, enemyColor = myColor === 'red' ? 'blue' : 'red'
      const ef = this.ctf.flags[enemyColor], mf = this.ctf.flags[myColor]
      const p = this.player.position
      const homePos = (team) => { const b = this.world.bases.find((bb) => bb.team === team); return b ? { x: b.x, z: b.z } : { x: 0, z: 0 } }
      const carrying = ef.holder === id

      if (this.player.alive && !carrying && ef.state !== 'carried') {
        const fp = ef.state === 'dropped' ? ef : homePos(enemyColor)
        if (Math.hypot(p.x - fp.x, p.z - fp.z) < 3) this.net.sendFlagTake(enemyColor)
      }
      if (this.player.alive && carrying && mf.state === 'home') {
        const b = homePos(myColor)
        if (Math.hypot(p.x - b.x, p.z - b.z) < 5.5) this.net.sendFlagCapture(enemyColor)
      }
      if (this.player.alive && mf.state === 'dropped' && Math.hypot(p.x - mf.x, p.z - mf.z) < 3) {
        this.net.sendFlagReturn(myColor)
      }

      // Objective hint.
      let msg = 'Grab the enemy flag →'
      if (carrying) msg = '🚩 You have the enemy flag — run it to your base!'
      else if (mf.state !== 'home') msg = '⚠ Your flag was taken — get it back!'
      this.hud.setObjective(msg)
    }
    this.flags?.update(dt, this._flagCtx())
  }

  _onKilled(byId, victimId) {
    const killer = byId != null ? (this.peerNames?.get(byId) || `Player${byId}`) : 'the world'
    const victim = victimId === this.net?.id ? this._selfName : (this.peerNames?.get(victimId) || `Player${victimId}`)
    this.hud.addKillFeed(`${killer} ▸ ${victim}`)
    // Scoreboard tallies (consistent on every client — all receive 'killed').
    if (this.board) {
      if (byId != null && byId !== victimId && this.board.has(byId)) this.board.get(byId).kills++
      if (this.board.has(victimId)) this.board.get(victimId).deaths++
    }
    if (byId === this.net?.id && victimId !== this.net?.id) {
      this.kills = (this.kills || 0) + 1
      this.deaths = this.deaths || 0
      this.hud.setScore(`${this.kills}/${this.deaths}`)
      this.hud.showKillBanner(`ELIMINATED ${victim}`)
    }
  }

  // Build sorted scoreboard rows (online: from this.board; solo: just you).
  _scoreboardRows() {
    if (this.board && this.net) {
      return [...this.board.entries()]
        .map(([id, r]) => ({ ...r, you: id === this.net.id }))
        .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
    }
    // Solo: you + any CPU bots, ranked by kills.
    const rows = [{ name: this._selfName || 'You', kills: this.kills || this.enemyKills || 0, deaths: this.player?.alive ? 0 : 1, you: true }]
    for (const b of this.bots) rows.push({ name: b.name, kills: b.kills || 0, deaths: b.alive ? 0 : 1 })
    return rows.sort((a, b) => b.kills - a.kills)
  }

  _disconnect() {
    if (this.voice) { this.voice.disable(); this.voice = null }
    if (this.net) { this.net.close(); this.net = null }
    if (this.remotePlayers) {
      for (const rp of this.remotePlayers.values()) rp.dispose()
      this.remotePlayers.clear()
    }
  }

  pause() {
    if (this.state !== STATE.PLAYING) return
    this.state = STATE.PAUSED
    this.hud.showMatchSummary(null) // no recap on a normal pause
    this.hud.showPause('PAUSED', 'Click to lock the mouse and keep fighting.', 'RESUME')
  }

  resume() {
    if (this.state !== STATE.PAUSED) return
    this.state = STATE.PLAYING
    this.hud.hidePause()
    if (!this.input.isTouch) this.input.requestLock()
    this.clock.getDelta()
    this._loop()
  }

  gameOver() {
    this.state = STATE.DEAD
    this.input.exitLock()
    this._recordMatch(false)
    this.hud.showMatchSummary(this._summary)
    this.hud.showPause('YOU FELL', `Wave ${this.spawner.wave}. Score: ${this.score}.`, 'PLAY AGAIN')
  }

  _loop() {
    if (this.state !== STATE.PLAYING) return
    requestAnimationFrame(() => this._loop())

    try {
    const dt = Math.min(0.05, this.clock.getDelta())

    if (this._god && this.player) { this.player.hp = this.player.maxHp; this.player.shield = 100 } // AI god mode

    // Enter / exit a car with E (edge-triggered).
    const eDown = this.input.isDown('KeyE')
    if (eDown && !this._ePrev) this._toggleCar()
    this._ePrev = eDown

    // Grapple / zipline with F.
    const fDown = this.input.isDown('KeyF')
    if (fDown && !this._fPrev && this.player.alive && !this.driving) this._fireGrapple()
    this._fPrev = fDown

    // Melee with V (quick short-range hit).
    this._meleeCd = Math.max(0, (this._meleeCd || 0) - dt)
    const vDown = this.input.isDown('KeyV')
    if (vDown && !this._vPrev && this.player.alive && !this.driving && this._meleeCd <= 0) this._melee()
    this._vPrev = vDown

    // Weapon switching: number keys + mouse wheel.
    for (let i = 0; i < this.weapons.defs.length; i++) {
      if (this.input.isDown(`Digit${i + 1}`)) this.weapons.switchTo(i)
    }
    const wheel = this.input.consumeWheel()
    if (wheel) this.weapons.cycle(wheel)

    // Reload (R).
    if (this.input.isDown('KeyR')) this.weapons.startReload()

    // Grenade (G) — not while driving.
    this._grenadeCd = Math.max(0, this._grenadeCd - dt)
    if (this.input.isDown('KeyG') && !this.driving) this.throwGrenade()

    // Aim-down-sights (right mouse) — not while driving.
    const ads = this.input.mouse.right && this.player.alive && !this.driving
    this.player.setADS(ads)
    this.hud.setAds(this.player.adsAmount > 0.5)

    // Shooting: auto weapons fire while held; semi-auto fire once per click.
    let firedThisFrame = false
    const click = this.input.consumeClick()
    const wantFire = (this.weapons.auto ? this.input.mouse.down : click) && !this.driving
    if (wantFire && this.player.alive) {
      const muzzle = this.player.getMuzzleWorldPosition(this._muzzle)
      const remotes = this.net ? [...this.remotePlayers.values()] : []
      // Bots are shootable too (Enemy-like hitMesh/takeHit).
      const targets = this.bots.length ? [...this.spawner.enemies, ...this.bots] : this.spawner.enemies
      const res = this.weapons.tryFire(this.player.getAimRay(), targets, muzzle, ads, remotes)
      if (res.fired) {
        firedThisFrame = true
        if (this.weapons.def.melee) this.player.meleeSwing() // knife slash motion
        if (res.tool === 'grapple') { this._fireGrapple() }
        // Floating damage number (white, gold on headshot).
        if (res.dmg > 0 && res.hitPos) this._damageNumber(res.hitPos, Math.round(res.dmg), res.headshot)
        if (res.headshot) this.audio.headshot()
        if (res.killed) { this.hud.hitMarker(res.headshot ? 'kill' : true); this.audio.kill(); this._playerKill() }
        else if (res.hit) { this.hud.hitMarker(res.headshot); this.audio.hit() }
        if (res.playerHit != null && this.net) {
          // Friendly fire off: don't damage teammates in Team Deathmatch.
          const victim = this.remotePlayers.get(res.playerHit)
          const friendly = this._relationTo(victim?.team) === 'ally'
          if (!friendly) {
            this.net.sendHit(res.playerHit, this.weapons.def.damage)
            this.hud.hitMarker(false); this.audio.hit()
          }
        }
        if (res.barrel) this.explode(res.barrel)
        // Grenade launcher: lobbed explosive shell.
        if (res.projectile === 'grenade') {
          const v = res.dir.clone().multiplyScalar(42); v.y += 2
          this.grenades.push(new Grenade({
            world: this.world, assets: this.assets, position: res.origin.clone(), velocity: v, fuse: 3.0, impact: true,
            onExplode: (p) => this.explodeAt(p, { radius: 8, damage: 120 }),
          }))
        }
        // Rocket launcher: fast, flat, big boom on impact.
        if (res.projectile === 'rocket') {
          const v = res.dir.clone().multiplyScalar(70)
          this.grenades.push(new Grenade({
            world: this.world, assets: this.assets, position: res.origin.clone(), velocity: v, fuse: 3.0, impact: true,
            onExplode: (p) => this.explodeAt(p, { radius: 11, damage: 170 }),
          }))
        }
        // Broadcast the shot so other players see a tracer.
        if (this.net) {
          const aim = this.player.getAimRay()
          const to = aim.origin.clone().addScaledVector(aim.dir, 60)
          this.net.sendShoot([muzzle.x, muzzle.y, muzzle.z], [to.x, to.y, to.z])
        }
      }
    }

    if (this.driving) this._driveUpdate(dt)
    else this.player.update(dt)
    // Footstep sounds while moving on the ground.
    if (!this.driving && this.player.moving && this.player.onGround && this.player.alive) {
      this._stepCd = (this._stepCd || 0) - dt
      if (this._stepCd <= 0) { this.audio.footstep(); this._stepCd = this.player.sprinting ? 0.27 : 0.4 }
    }
    // Screen shake (explosions / taking damage).
    if (this._shake > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * this._shake
      this.camera.position.y += (Math.random() - 0.5) * this._shake
      this._shake *= Math.max(0, 1 - dt * 6)
    }
    // Idle cars still settle (friction); the driven one is updated in _driveUpdate.
    for (const car of this.cars) if (car !== this.driving) car.update(dt)

    // CPU bots: BR fighters target each other + you; Hide&Seek hiders flee you.
    if (this.bots.length) {
      const live = this.bots.filter((b) => b.alive)
      const combatants = [this.player, ...live]
      const ctx = { combatants, camera: this.camera, seeker: this.player }
      for (let i = this.bots.length - 1; i >= 0; i--) {
        if (this.bots[i].update(dt, ctx)) this.bots.splice(i, 1)
      }
      // BR (no human opponents present): last one standing wins.
      if (this.brMode && this.remotePlayers.size === 0 && !this._wonBR && this.player.alive && live.length === 0 && this.bots.length === 0) {
        this._wonBR = true
        this._winMatch('#1 VICTORY ROYALE', `Last one standing. Eliminations: ${this.kills || 0}.`)
      }
    }

    // Hide & Seek: hunt all hiders before the timer expires.
    if (this.hnsMode && !this._hnsOver) {
      const hiders = this.bots.filter((b) => b.alive).length
      this.hnsTime = Math.max(0, this.hnsTime - dt)
      const m = Math.floor(this.hnsTime / 60), s = String(Math.floor(this.hnsTime % 60)).padStart(2, '0')
      this.hud.setStormTimer(`🔍 HIDERS LEFT: ${hiders}   ⏱ ${m}:${s}`)
      if (hiders === 0) { this._hnsOver = true; this._winMatch('HIDERS FOUND!', `You hunted them all with ${Math.ceil(this.hnsTime)}s to spare.`) }
      else if (this.hnsTime <= 0) { this._hnsOver = true; this._winMatch('TIME UP', `${hiders} hider(s) escaped.`, false) }
    }

    // Solo combat modes (FFA / Gun Game / OITC / Juggernaut / Infection).
    if (this.modeCfg && !this._matchOver) {
      const cfg = this.modeCfg
      if (cfg.survive != null) {
        this._surviveTime = Math.max(0, this._surviveTime - dt)
        const left = this.bots.filter((b) => b.alive).length
        const m = Math.floor(this._surviveTime / 60), s = String(Math.floor(this._surviveTime % 60)).padStart(2, '0')
        this.hud.setStormTimer(`🧟 SURVIVE  ⏱ ${m}:${s}   Zombies: ${left}`)
        if (this._surviveTime <= 0) { this._matchOver = true; this._winMatch('SURVIVED!', 'You outlasted the infection.') }
      } else if (cfg.gungame) {
        this.hud.setStormTimer(`🔫 GUN GAME  ☠ ${this.kills} / ${cfg.killTarget}  ·  random guns`)
        if (this.kills >= cfg.killTarget) { this._matchOver = true; this._winMatch('GUN GAME WIN', `${cfg.killTarget} eliminations with random guns!`) }
      } else if (cfg.killTarget) {
        this.hud.setStormTimer(`☠ KILLS ${this.kills} / ${cfg.killTarget}`)
        if (this.kills >= cfg.killTarget) { this._matchOver = true; this._winMatch('VICTORY', `${cfg.killTarget} eliminations!`) }
      } else if (cfg.jugg) {
        if (this.jugg && !this.jugg.alive) { this._matchOver = true; this._winMatch('JUGGERNAUT DOWN', 'You took down the juggernaut!') }
      } else if (cfg.koth) {
        const R = this.hillRadius
        const inHill = (x, z) => (x * x + z * z) < R * R
        const youIn = this.player.alive && inHill(this.player.position.x, this.player.position.z)
        const botIn = this.bots.some((b) => b.alive && inHill(b.position.x, b.position.z))
        if (youIn && !botIn) this.kothYou += dt * 9
        else if (botIn && !youIn) this.kothEnemy += dt * 9
        const tag = youIn && botIn ? 'CONTESTED' : youIn ? 'HOLDING' : botIn ? 'ENEMY HELD' : 'OPEN'
        this.hud.setObjective('👑 Capture the hill at the center!')
        this.hud.setStormTimer(`👑 ${tag}  —  You ${Math.floor(this.kothYou)} · Enemy ${Math.floor(this.kothEnemy)}  / 100`)
        if (this._hillMesh) this._hillMesh.material.color.setHex(youIn && botIn ? 0xff5a5a : youIn ? 0x4ade80 : botIn ? 0xff5a5a : 0xffd24a)
        if (this.kothYou >= 100) { this._matchOver = true; this._winMatch('HILL CONQUERED', 'You held the hill!') }
        else if (this.kothEnemy >= 100) { this._matchOver = true; this._winMatch('DEFEAT', 'The enemy held the hill.', false) }
      } else if (cfg.infect) {
        this._matchT = (this._matchT || 0) + dt
        const humanBots = this.bots.filter((b) => b.alive && b.role === 'fighter').length
        const zombies = this.bots.filter((b) => b.alive && b.role === 'zombie').length + (this.playerZombie ? 1 : 0)
        const humans = humanBots + (this.playerZombie ? 0 : 1)
        this.hud.setStormTimer(`🧟 INFECTION   Survivors: ${humans}   Zombies: ${zombies}`)
        // Grace period so the match can't resolve before everyone has spawned in.
        if (this._matchT > 4) {
          if (zombies === 0) { this._matchOver = true; this._winMatch('SURVIVORS WIN', 'Every zombie was eliminated!', !this.playerZombie) }
          else if (humans === 0) { this._matchOver = true; this._winMatch('INFECTION COMPLETE', 'Everyone was turned.', false) }
          else if (humans === 1) { this._matchOver = true; const won = !this.playerZombie; this._winMatch(won ? 'LAST SURVIVOR' : 'INFECTED', won ? 'You were the last one standing!' : 'A survivor outlasted you.', won) }
        }
      }
    }

    // Car prompt.
    if (this.cars.length) {
      if (this.driving) this.hud.setCarPrompt('Press E to exit')
      else {
        let near = false
        for (const car of this.cars) {
          if (Math.hypot(this.player.position.x - car.position.x, this.player.position.z - car.position.z) < 3.6) { near = true; break }
        }
        this.hud.setCarPrompt(near ? 'Press E to drive' : null)
      }
    }

    this.particles.update(dt)
    this.pickups.update(dt, this.player, this.weapons)

    // Grenades.
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      if (this.grenades[i].update(dt)) this.grenades.splice(i, 1)
    }

    // Hurt feedback when HP drops: sound + shake + red flash.
    if (this.player.hp < this._prevHp) { this.audio.hurt(); this._shake = Math.max(this._shake || 0, 0.35); this._hurtFlash = 0.6 }
    this._prevHp = this.player.hp
    // Hurt vignette = damage flash + persistent low-HP glow.
    this._hurtFlash = Math.max(0, (this._hurtFlash || 0) - dt * 1.5)
    const lowHp = this.player.hp < 35 ? (1 - this.player.hp / 35) * 0.5 : 0
    this.hud.setHurt(Math.max(this._hurtFlash, lowHp))

    // Crosshair turns red when aiming at a target.
    this._aimRay = this._aimRay || new THREE.Raycaster()
    const aimR = this.player.getAimRay(); this._aimRay.set(aimR.origin, aimR.dir); this._aimRay.far = 200
    const aimMeshes = []
    for (const e of this.spawner.enemies) if (e.alive && e.hitMesh) aimMeshes.push(e.hitMesh)
    for (const b of this.bots) if (b.alive && b.hitMesh) aimMeshes.push(b.hitMesh)
    if (this.net) for (const rp of this.remotePlayers.values()) if (rp.hitMesh) aimMeshes.push(rp.hitMesh)
    this.hud.setCrosshairEnemy(aimMeshes.length > 0 && this._aimRay.intersectObjects(aimMeshes, true).length > 0)

    // Multiplayer: broadcast local state + interpolate remote players.
    if (this.net) {
      this.net.sendState({
        x: this.player.position.x, y: this.player.position.y, z: this.player.position.z,
        yaw: this.player.yaw, pitch: this.player.pitch, hp: this.player.hp,
        wpn: this.weapons.index, moving: this.player.moving, skin: this.character, voice: !!this.voice?.on,
      }, performance.now())
      for (const rp of this.remotePlayers.values()) rp.update(dt, this.camera)
      this.voice?.update(this.player.position, this.remotePlayers)
    }

    // Fortnite-style dynamic reticle: bloom out when moving/firing/airborne.
    let spread = 0
    if (this.player.moving) spread += this.player.sprinting ? 16 : 9
    if (!this.player.onGround) spread += 10
    if (firedThisFrame || this.weapons.reloading) spread += 12
    this.hud.setCrosshairSpread(spread)
    this.weapons.update(dt)
    // Enemies: on in solo (incl. solo BR storm) and online co-op; off in PvP modes.
    // Waves only in Co-op (solo or online).
    const coopWaves = this.net ? this.onlineMode === 'coop' : this.soloMode === 'coop'
    if (coopWaves) this.spawner.update(dt, this.player, this.camera)
    if (this.ctfMode) { if (this.remotePlayers.size === 0) this._updateLocalCtf(dt); else this._updateCtf(dt) }
    if (this.zone) {
      this.hud.setStorm(this.zone.update(dt, this.player))
      this.hud.setStormTimer(this.zone.statusText())
      // Battle Royale: survive until the storm fully closes -> Victory Royale.
      if (this.remotePlayers.size === 0 && this.player.alive && !this._wonBR && this.zone.radius <= this.zone.minR + 0.3) {
        this._wonBR = true
        this._winMatch('#1 VICTORY ROYALE', `You outlasted the storm. Kills: ${this.enemyKills || 0}.`)
      }
    }

    this.hud.setHp(this.player.hp, this.player.maxHp)
    this.hud.setShield(this.player.shield)
    this.hud.setCompass(this.player.yaw)
    this.hud.setAmmo(this.weapons.ammo, this.weapons.magazine)

    if (!this.player.alive && this.state === STATE.PLAYING) {
      if (this.infectMode && !this.playerZombie) this._infectPlayer() // stabbed → turn
      else if (this.net) this._handleMpDeath()
      else this.gameOver()
    }

    this._drawMinimap()
    } catch (e) {
      if (!this._loopErr) { console.error('[loop]', e); this._loopErr = true }
    }
    // Always render so the game never freezes on a stale frame.
    this.renderer.render(this.world.scene, this.camera)
  }

  // Explode a barrel (FX + area damage + chain reactions).
  explode(barrel, depth = 0) {
    if (!barrel.alive) return
    this.world.removeBarrel(barrel)
    this.explodeAt(new THREE.Vector3(barrel.x, 1.0, barrel.z), { radius: 9, damage: 140, depth })
  }

  // Generic explosion at a point — used by barrels and grenades.
  explodeAt(pos, { radius = 8, damage = 120, depth = 0 } = {}) {
    this.particles.emit(pos, 64, { color: [1, 0.55, 0.12], speed: 15, spread: 11, size: 2.4, life: 0.5, gravity: -2, drag: 3, up: 4 })
    this.particles.emit(pos, 28, { color: [1, 0.92, 0.45], speed: 22, spread: 14, size: 1.0, life: 0.32, gravity: -2, drag: 4 })
    this.particles.emit(pos, 40, { color: [0.18, 0.18, 0.18], speed: 6, spread: 5, size: 3.6, life: 1.2, gravity: 1.4, drag: 1.4, up: 3 })
    this.weapons.impact(pos, 0xffa030)
    this.audio.explosion()
    const pdShake = Math.hypot(this.player.position.x - pos.x, this.player.position.z - pos.z)
    if (pdShake < radius * 2) this._shake = Math.max(this._shake || 0, 0.5 * (1 - pdShake / (radius * 2)))

    for (const e of this.spawner.enemies) {
      if (!e.alive) continue
      const d = Math.hypot(e.group.position.x - pos.x, e.group.position.z - pos.z)
      if (d < radius) {
        const killed = e.takeHit(damage * (1 - d / radius))
        if (killed) {
          this.score += 10; this.hud.setScore(this.score)
          this.pickups.rollDrop(e.group.position.x, e.group.position.z)
        }
      }
    }
    const pd = Math.hypot(this.player.position.x - pos.x, this.player.position.z - pos.z)
    if (pd < radius && this.player.alive) this.player.takeDamage((damage * 0.36) * (1 - pd / radius))

    // Chain nearby barrels.
    if (depth < 6) {
      for (const b of this.world.barrels) {
        if (b.alive) {
          const d = Math.hypot(b.x - pos.x, b.z - pos.z)
          if (d < radius + b.radius) this.explode(b, depth + 1)
        }
      }
    }
  }

  throwGrenade() {
    if (this._grenadeCd > 0 || !this.player.alive) return
    this._grenadeCd = 1.0
    const aim = this.player.getAimRay()
    const start = aim.origin.clone().addScaledVector(aim.dir, 0.8)
    const vel = aim.dir.clone().multiplyScalar(20)
    vel.y += 4 // slight lob
    this.grenades.push(new Grenade({
      world: this.world, assets: this.assets, position: start, velocity: vel, fuse: 3.0, impact: true,
      onExplode: (p) => this.explodeAt(p, { radius: 7, damage: 110 }),
    }))
  }

  _applySettings() {
    // Audio + renderer settings apply even before a player exists.
    if (this.settings.volume != null) this.audio.setVolume(this.settings.volume)
    if (this.settings.shadows != null) this.renderer.shadowMap.enabled = this.settings.shadows
    if (this.settings.fov != null) {
      this.camera.fov = this.settings.fov; this.camera.updateProjectionMatrix()
    }
    if (!this.player) return
    this.player.mouseSensitivity = 0.0022 * this.settings.sens
    this.player.invertY = this.settings.invertY
    if (this.settings.fov != null) this.player.baseFov = this.settings.fov
    this.player.setThirdPerson(!!this.settings.thirdPerson)
    // Lazily load the player body model when third-person is first enabled.
    if (this.settings.thirdPerson && !this.player.body) {
      const skin = skinOf(this.character)
      this.assets.loadModel(`models/characters/${skin.base}.gltf`).then((m) => {
        if (m && this.player) { applyTint(m.scene, skin.tint); this.player.setBody(m.scene, m.animations) }
      })
    }
  }

  // Top-down radar: player (heading), enemies, remote players, pickups.
  _drawMinimap() {
    const ctx = this.minimapCtx
    if (!ctx) return
    const W = this.minimap.width, H = this.minimap.height
    const cx = W / 2, cy = H / 2
    const HALF = this.world.arenaRadius
    const R = (W / 2) - 10
    const sx = (x) => cx + (x / HALF) * R
    const sz = (z) => cy + (z / HALF) * R

    ctx.clearRect(0, 0, W, H)
    // Arena bounds.
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.lineWidth = 2
    ctx.strokeRect(sx(-HALF), sz(-HALF), R * 2, R * 2)

    // Battle-royale safe zone circle.
    if (this.zone) {
      ctx.strokeStyle = '#39c6ff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(sx(this.zone.cx), sz(this.zone.cz), (this.zone.radius / HALF) * R, 0, Math.PI * 2)
      ctx.stroke()
    }

    const dot = (x, z, color, r = 3) => {
      ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(sx(x), sz(z), r, 0, Math.PI * 2); ctx.fill()
    }
    for (const it of this.pickups.items) dot(it.x, it.z, it.type === 'health' ? '#4ade80' : it.type === 'shield' ? '#3da9fc' : it.type === 'weapon' ? '#9ad0ff' : '#ffcb3d', 2.5)
    for (const e of this.spawner.enemies) if (e.alive) dot(e.group.position.x, e.group.position.z, '#ff5555')
    for (const b of this.bots) if (b.alive) dot(b.group.position.x, b.group.position.z, b.role === 'hider' ? '#ffd24a' : '#ff7a3d')
    if (this.net) for (const rp of this.remotePlayers.values()) dot(rp.group.position.x, rp.group.position.z, '#5ab0ff')

    // Player as a heading triangle.
    const px = sx(this.player.position.x), py = sz(this.player.position.z)
    const a = -this.player.yaw // screen z+ is down
    ctx.save(); ctx.translate(px, py); ctx.rotate(a)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill()
    ctx.restore()
  }

  _renderOnce() {
    this.renderer.render(this.world.scene, this.camera)
  }

  _resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    if (this.lobbyCam) { this.lobbyCam.aspect = this.camera.aspect; this.lobbyCam.updateProjectionMatrix() }
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }
}

export { STATE }
