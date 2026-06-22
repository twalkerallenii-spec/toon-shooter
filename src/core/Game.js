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
  infect: { label: 'INFECTION', infect: true, bots: 0, startZombies: 0, map: 'outpost' }, // players only — one zombie
  koth: { label: 'KING OF THE HILL', koth: true, bots: 7, role: 'fighter', map: 'arena' },
  dom: { label: 'DOMINATION', dom: true, bots: 8, role: 'fighter', map: 'outpost' },
  snd: { label: 'SEARCH & DESTROY', snd: true, bots: 6, role: 'fighter', oneLife: true, map: 'outpost' },
  disaster: { label: 'NATURAL DISASTERS', disaster: true, bots: 0, map: 'outpost' }, // build a fort, survive 30 disasters
}

// Weapons buyable in the Armory (index = position in the WEAPONS roster). Bought
// weapons spawn in your loadout every match.
const WEAPON_SHOP = [
  { i: 1, label: 'AK-47', ico: '🔫', price: 400 },
  { i: 2, label: 'SMG', ico: '🔫', price: 350 },
  { i: 3, label: 'Shotgun', ico: '💥', price: 300 },
  { i: 8, label: 'Burst Rifle', ico: '🔫', price: 450 },
  { i: 5, label: 'Revolver', ico: '🔫', price: 550 },
  { i: 7, label: 'Marksman', ico: '🎯', price: 650 },
  { i: 4, label: 'Sniper', ico: '🎯', price: 800 },
  { i: 9, label: 'Grenade Launcher', ico: '🧨', price: 900 },
  { i: 6, label: 'Minigun', ico: '🌀', price: 1200 },
  { i: 10, label: 'Rocket Launcher', ico: '🚀', price: 1500 },
  { i: 13, label: 'SUPER GUN', ico: '🔵', price: 100000 }, // legendary energy cannon
  // God-tier weapons — each stronger than the last. Buyable for huge sums, and
  // the host/admin can grab them all instantly with /arsenal.
  { i: 14, label: 'Plasma Cannon', ico: '🟢', price: 150000 },
  { i: 15, label: 'Ion Storm', ico: '🔷', price: 250000 },
  { i: 16, label: 'Void Ripper', ico: '🟣', price: 400000 },
  { i: 17, label: 'Nova Blaster', ico: '🌸', price: 600000 },
  { i: 18, label: 'Singularity Gun', ico: '🟪', price: 900000 },
  { i: 19, label: 'Antimatter Rifle', ico: '🔴', price: 1300000 },
  { i: 20, label: 'Quasar Cannon', ico: '🟠', price: 1800000 },
  { i: 21, label: 'Hyperbeam', ico: '🟦', price: 2500000 },
  { i: 22, label: 'Apocalypse', ico: '🟥', price: 3500000 },
  { i: 23, label: 'Omega Annihilator', ico: '⚪', price: 5000000 },
  { i: 24, label: 'WORLD ANNIHILATOR', ico: '🌍', price: 10000000 }, // deletes everything
]

// Grenade arsenal — cycle with H, throw with G.
// Hand grenades bounce + detonate on a fuse (never on impact — only gun-fired
// projectiles like the GL/RPG explode on contact).
const NADE_TYPES = [
  { name: 'Frag', fn: '_nadeFrag', fuse: 2.2, impact: false, speed: 22 },
  { name: 'Sticky Bomb', fn: '_nadeSticky', fuse: 1.6, impact: false, speed: 24 },
  { name: 'Cluster', fn: '_nadeCluster', fuse: 2.0, impact: false, speed: 20 },
  { name: 'Smoke', fn: '_nadeSmoke', fuse: 1.4, impact: false, speed: 18 },
  { name: 'Flashbang', fn: '_nadeFlash', fuse: 1.4, impact: false, speed: 18 },
  { name: 'Boogie Bomb', fn: '_nadeBoogie', fuse: 1.4, impact: false, speed: 18 },
]

// 30 natural disasters (one strikes every 2:00 in Disaster mode). Each maps to an
// effect "kind" with params; build forts + grab high ground to survive.
const DISASTERS = [
  { n: 'Meteor Shower', i: '☄️', k: 'meteor', p: { count: 10 } },
  { n: 'Earthquake', i: '🫨', k: 'quake', p: {} },
  { n: 'Tornado', i: '🌪️', k: 'tornado', p: {} },
  { n: 'Flood', i: '🌊', k: 'flood', p: { h: 2.2 } },
  { n: 'Tsunami', i: '🌊', k: 'flood', p: { h: 3.4 } },
  { n: 'Lightning Storm', i: '⚡', k: 'lightning', p: { strikes: 8 } },
  { n: 'Volcanic Eruption', i: '🌋', k: 'meteor', p: { count: 14, col: 0xff5a00 } },
  { n: 'Wildfire', i: '🔥', k: 'fire', p: {} },
  { n: 'Hurricane', i: '🌀', k: 'wind', p: { force: 16 } },
  { n: 'Hailstorm', i: '🧊', k: 'meteor', p: { count: 18, radius: 4, col: 0x9fd0ff } },
  { n: 'Acid Rain', i: '🧪', k: 'fire', p: { col: 0x88ff00, dps: 12 } },
  { n: 'Sinkhole', i: '🕳️', k: 'nova', p: { radius: 30 } },
  { n: 'Blizzard', i: '❄️', k: 'freeze', p: {} },
  { n: 'Sandstorm', i: '🏜️', k: 'wind', p: { force: 10, blind: true } },
  { n: 'Asteroid Impact', i: '💥', k: 'asteroid', p: {} },
  { n: 'Solar Flare', i: '🌞', k: 'flash', p: {} },
  { n: 'Supernova', i: '✨', k: 'nova', p: { radius: 65 } },
  { n: 'Black Hole', i: '⚫', k: 'tornado', p: { pull: 60, kill: true } },
  { n: 'Plague Cloud', i: '☣️', k: 'fire', p: { col: 0x66ff66, dps: 10 } },
  { n: 'Avalanche', i: '🏔️', k: 'wind', p: { force: 22 } },
  { n: 'Firestorm', i: '🔥', k: 'meteor', p: { count: 16, col: 0xff3000 } },
  { n: 'Ice Age', i: '🧊', k: 'freeze', p: { dur: 8 } },
  { n: 'Magnetic Storm', i: '🧲', k: 'lightning', p: { strikes: 12 } },
  { n: 'Gas Explosions', i: '💨', k: 'meteor', p: { count: 8, radius: 10 } },
  { n: 'Cyclone', i: '🌬️', k: 'tornado', p: {} },
  { n: 'Heat Wave', i: '🥵', k: 'fire', p: { col: 0xff8800, dps: 8, mapwide: true } },
  { n: 'Rockslide', i: '🪨', k: 'meteor', p: { count: 20, radius: 3 } },
  { n: 'Thunderstorm', i: '🌩️', k: 'lightning', p: { strikes: 10 } },
  { n: 'Mega Quake', i: '🌍', k: 'quake', p: { dur: 6, dmg: 18 } },
  { n: 'APOCALYPSE', i: '☠️', k: 'apocalypse', p: {} },
]

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

    // Claim buttons on daily challenges (event delegation; list is re-rendered).
    document.getElementById('challenge-list')?.addEventListener('click', (e) => {
      const b = e.target.closest('.ch-claim'); if (!b) return
      this._claimDaily(parseInt(b.dataset.ci, 10))
    })
    document.getElementById('bp-claim')?.addEventListener('click', () => this._claimBattlePass())

    // Animated lobby scene behind the menu.
    this._buildLobby()
    this._lobbyLoop()
    this._populateLobby()
    this._connectPresence() // appear online + see who else is on
    this._promptPermanentName() // first-time players must pick a permanent name
  }

  // Lock the name field once a name is set — it's permanent.
  _lockNameInput() {
    const n = document.getElementById('mp-name'); if (!n) return
    const name = localStorage.getItem('ts_name')
    if (name) { n.value = name; n.readOnly = true; n.title = 'Your name is permanent'; n.classList.add('locked') }
  }

  // First-time gate: force a permanent name choice before playing.
  _promptPermanentName() {
    if (localStorage.getItem('ts_name')) { this._lockNameInput(); return false }
    if (document.getElementById('name-gate')) return true
    const ov = document.createElement('div'); ov.id = 'name-gate'
    ov.innerHTML = `<div class="ng-card">
        <h2>CHOOSE YOUR NAME</h2>
        <p>⚠ This name is <b>PERMANENT</b>. You cannot change it later — choose carefully.</p>
        <input id="ng-input" maxlength="16" placeholder="Enter name" autocomplete="off" spellcheck="false" />
        <button id="ng-go">LOCK IT IN</button>
        <div id="ng-err"></div>
      </div>`
    document.body.appendChild(ov)
    const input = ov.querySelector('#ng-input'), err = ov.querySelector('#ng-err')
    setTimeout(() => input.focus(), 50)
    const submit = () => {
      const v = input.value.trim()
      if (v.length < 2) { err.textContent = 'Name must be at least 2 characters.'; return }
      localStorage.setItem('ts_name', v)
      this._lockNameInput(); ov.remove(); this._populateLobby()
    }
    ov.querySelector('#ng-go').addEventListener('click', submit)
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
    return true
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
    document.getElementById('pause-quit').addEventListener('click', () => this._quitToLobby())

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
    nameInput.addEventListener('change', () => {
      if (localStorage.getItem('ts_name')) return // name is permanent
      const v = nameInput.value.trim(); if (v.length < 2) return
      localStorage.setItem('ts_name', v); this._lockNameInput(); this._populateLobby()
    })
    this._lockNameInput()
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
    this._renderWeaponStore()
    document.getElementById('weapon-grid')?.addEventListener('click', (e) => {
      const card = e.target.closest('.char-card'); if (!card || card.dataset.weapon == null) return
      this._buyWeapon(parseInt(card.dataset.weapon, 10))
    })
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
      if (!this.input.isTouch && !locked && this.state === STATE.PLAYING && !this._chatOpen) this.pause()
    }

    // Pointer lock can't be requested right after an async load (no user
    // gesture), so clicking the game re-acquires it.
    this.canvas.addEventListener('click', () => {
      if (this.state === STATE.PLAYING && !this.input.isTouch && !this.input.locked) this.input.requestLock()
    })

    // Bank kills/XP if the player leaves mid-match (close, refresh, navigate away).
    const saveOnExit = () => { if (this.state === STATE.PLAYING) this._recordMatch(false) }
    window.addEventListener('pagehide', saveOnExit)
    window.addEventListener('beforeunload', saveOnExit)

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
      // Q = ping a location, T = spray a tag on the surface you're aiming at.
      if (e.code === 'KeyQ' && this.state === STATE.PLAYING && !e.repeat) this._placePing()
      if (e.code === 'KeyT' && this.state === STATE.PLAYING && !e.repeat) this._placeSpray()
      // B = toggle build mode; 1/2/3 pick wall/floor/ramp while building.
      if (e.code === 'KeyB' && this.state === STATE.PLAYING && !e.repeat) this._toggleBuild()
      if (this.buildMode && this.state === STATE.PLAYING && !e.repeat) {
        if (e.code === 'Digit1') this._setBuildPiece('wall')
        else if (e.code === 'Digit2') this._setBuildPiece('floor')
        else if (e.code === 'Digit3') this._setBuildPiece('ramp')
        else if (e.code === 'Digit4') this._setBuildPiece('window')
        else if (e.code === 'Escape') this._toggleBuild()
      }
      // H cycles grenade type (Frag / Sticky / Cluster / Smoke / Flash / Boogie).
      if (e.code === 'KeyH' && this.state === STATE.PLAYING && !e.repeat) this._cycleGrenade()
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
    // MAP_SCALE enlarges every map (all sizes derive from arenaRadius).
    const MAP_SCALE = 2 // ~4x the play area (2x wider each way)
    const radius = (this.brMode ? 190 : this.hnsMode ? 95 : 75) * MAP_SCALE
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
      infect: ['INFECTION', 'Players only — a spinning tag picks one Zombie. Get stabbed and you turn.'],
      koth: ['KING OF THE HILL', 'Hold the glowing hill at the center. First to 100 wins.'],
      dom: ['DOMINATION', 'Capture and hold A/B/C points for ticking score.'],
      snd: ['SEARCH & DESTROY', 'One life — plant or defuse the bomb.'],
      disaster: ['NATURAL DISASTERS', 'Build a fort and survive a disaster every 2:00. 30 events!'],
    }
    const [label, sub] = info[mode] || info.coop
    this.hud.setLobbyMode(label, sub)
  }

  // Every game drops into an online match (bots fill it; friends can join the
  // same room). Falls back to offline if the server can't be reached.
  _startSelectedMode() {
    if (this._promptPermanentName()) return // must pick a permanent name first
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
  // Credit a kill to saved career stats IMMEDIATELY (not batched at match end),
  // so kills can never be lost by how a match ends. +30 XP each.
  _creditKill(n = 1) {
    const s = this._stats()
    s.kills = (s.kills || 0) + n
    s.xp = (s.xp || 0) + 30 * n
    localStorage.setItem('ts_stats', JSON.stringify(s))
    this._dailyProgress('kills', n)
    this._populateLobby()
  }

  _recordMatch(won) {
    if (this._recorded) return // once per match (win, death, or quit)
    this._recorded = true
    const s = this._stats()
    const k = this.kills || this.enemyKills || 0
    s.matches = (s.matches || 0) + 1
    // kills are credited live in _creditKill — only count matches/wins/win-XP here
    s.wins = (s.wins || 0) + (won ? 1 : 0)
    s.xp = (s.xp || 0) + (won ? 500 : 200)
    localStorage.setItem('ts_stats', JSON.stringify(s))
    this._dailyProgress('matches'); if (won) this._dailyProgress('wins')
    this._recordHistory(won)
    // Coins: earn from kills + a win bonus.
    const coinGain = k * 10 + (won ? 100 : 25)
    this._setCoins(this._coins() + coinGain)
    // Stash this match's recap for the end screen.
    const deaths = this.net ? (this.deaths || 0) : (this.player?.alive ? 0 : 1)
    const xpGain = (won ? 500 : 200) + k * 30
    this._summary = { kills: k, deaths, kd: (k / Math.max(1, deaths)).toFixed(2), xp: xpGain, coins: coinGain, won }
    this._showSaving(k, xpGain, coinGain) // visible "saving kills & XP" confirmation
    this._populateLobby() // refresh lobby stats immediately (even on Play Again)
  }

  // Brief overlay confirming the match was banked to the browser.
  _showSaving(kills, xp, coins) {
    let el = document.getElementById('save-toast')
    if (!el) { el = document.createElement('div'); el.id = 'save-toast'; document.body.appendChild(el) }
    el.innerHTML = `<span class="st-spin">💾</span> SAVING…<small>+${kills} kills · +${xp} XP · +${coins} ◆</small>`
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show')
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

  // ---- Purchasable weapons (spawn in your loadout every match) ----
  _ownedWeapons() {
    try { const a = JSON.parse(localStorage.getItem('ts_owned_weapons') || '[]'); return Array.isArray(a) ? a : [] } catch { return [] }
  }
  _saveOwnedWeapons(a) { localStorage.setItem('ts_owned_weapons', JSON.stringify([...new Set(a)])) }

  _renderWeaponStore() {
    const grid = document.getElementById('weapon-grid'); if (!grid) return
    const owned = this._ownedWeapons()
    grid.innerHTML = WEAPON_SHOP.map((w) => {
      if (owned.includes(w.i)) return `<button class="char-card owned"><span class="cc-ico">${w.ico}</span>${w.label}<small>OWNED</small></button>`
      return `<button class="char-card buy" data-weapon="${w.i}"><span class="cc-ico">${w.ico}</span>${w.label}<small>◆ ${w.price}</small></button>`
    }).join('')
  }

  _buyWeapon(i) {
    const w = WEAPON_SHOP.find((x) => x.i === i); if (!w) return
    const owned = this._ownedWeapons()
    if (owned.includes(i)) return
    const free = !!this.isAdmin // host/admin unlocks weapons for free
    if (!free && this._coins() < w.price) { this.hud.addKillFeed?.(`Not enough ◆ for ${w.label}`); return }
    if (!free) this._setCoins(this._coins() - w.price)
    owned.push(i); this._saveOwnedWeapons(owned)
    this.audio?.pickup?.()
    this._renderWeaponStore(); this._populateLobby()
  }

  // ---- Rotating daily challenges ----
  _dailies() {
    const today = new Date().toISOString().slice(0, 10)
    let d = null
    try { d = JSON.parse(localStorage.getItem('ts_daily') || 'null') } catch {}
    if (!d || d.day !== today || !Array.isArray(d.ch)) {
      d = { day: today, ch: this._rollDailies(today) }
      localStorage.setItem('ts_daily', JSON.stringify(d))
    }
    return d
  }

  _rollDailies(seedStr) {
    const POOL = [
      { id: 'kills', t: 'Get {n} eliminations', n: [8, 12, 15], xp: 200, coins: 120 },
      { id: 'wins', t: 'Win {n} match', n: [1, 2], xp: 300, coins: 220 },
      { id: 'matches', t: 'Play {n} matches', n: [3, 5], xp: 150, coins: 80 },
      { id: 'chests', t: 'Open {n} loot chests', n: [5, 8], xp: 180, coins: 110 },
      { id: 'headshots', t: 'Land {n} headshots', n: [5, 10], xp: 220, coins: 150 },
    ]
    let seed = 0; for (const c of seedStr) seed = (seed * 31 + c.charCodeAt(0)) | 0
    const rng = mulberryLobby(seed)
    const idx = POOL.map((_, i) => i)
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[idx[i], idx[j]] = [idx[j], idx[i]] }
    return idx.slice(0, 3).map((i) => {
      const c = POOL[i]; const target = c.n[Math.floor(rng() * c.n.length)]
      return { id: c.id, t: c.t.replace('{n}', target), target, prog: 0, claimed: false, xp: c.xp, coins: c.coins }
    })
  }

  _dailyProgress(id, n = 1) {
    const d = this._dailies()
    let changed = false
    for (const c of d.ch) if (c.id === id && !c.claimed && c.prog < c.target) { c.prog = Math.min(c.target, c.prog + n); changed = true }
    if (changed) { localStorage.setItem('ts_daily', JSON.stringify(d)); if (this.state === STATE.MENU) this._populateLobby() }
  }

  _claimDaily(i) {
    const d = this._dailies()
    const c = d.ch[i]
    if (!c || c.claimed || c.prog < c.target) return
    c.claimed = true
    localStorage.setItem('ts_daily', JSON.stringify(d))
    const s = this._stats(); s.xp = (s.xp || 0) + c.xp; localStorage.setItem('ts_stats', JSON.stringify(s))
    this._setCoins(this._coins() + (c.coins || 0))
    this.audio?.pickup?.()
    this._populateLobby()
  }

  // ---- Battle Pass: a reward track tied to your XP tier ----
  _bpReward(tier) {
    const WPN = { 10: 1, 15: 2, 20: 3, 25: 8, 30: 7, 40: 4, 50: 13 } // tier -> weapon index
    if (WPN[tier] != null) { const w = WEAPON_SHOP.find((x) => x.i === WPN[tier]); return { label: w ? w.label : 'Weapon', coins: 200, weapon: WPN[tier] } }
    if (tier % 5 === 0) return { label: 'Coin Cache', coins: 400 }
    return { label: 'Coins', coins: 80 + tier * 10 }
  }

  _bpTier() { return 1 + Math.floor((this._stats().xp || 0) / 500) }
  _bpClaimed() { return parseInt(localStorage.getItem('ts_bp_claimed') || '0', 10) || 0 }

  _renderBattlePass() {
    const track = document.getElementById('bp-track'); if (!track) return
    const tier = this._bpTier(), claimed = this._bpClaimed()
    let html = ''
    for (let t = Math.max(1, tier - 1); t < tier + 5; t++) {
      const r = this._bpReward(t)
      const cls = t <= claimed ? 'got' : (t <= tier ? 'ready' : '')
      const ico = r.weapon != null ? '🔫' : r.coins >= 400 ? '💰' : '🪙'
      html += `<div class="bp-tier ${cls}"><span class="bp-n">${t}</span><span class="bp-r">${ico} ${r.label}</span></div>`
    }
    track.innerHTML = html
    const btn = document.getElementById('bp-claim')
    if (btn) { const n = Math.max(0, tier - claimed); btn.classList.toggle('hidden', n <= 0); btn.textContent = `CLAIM ${n} REWARD${n > 1 ? 'S' : ''}` }
  }

  _claimBattlePass() {
    const tier = this._bpTier(), claimed = this._bpClaimed()
    if (tier <= claimed) return
    let coins = 0; const owned = this._ownedWeapons(); const gained = []
    for (let t = claimed + 1; t <= tier; t++) { const r = this._bpReward(t); coins += r.coins; if (r.weapon != null && !owned.includes(r.weapon)) { owned.push(r.weapon); gained.push(r.label) } }
    this._setCoins(this._coins() + coins); this._saveOwnedWeapons(owned)
    localStorage.setItem('ts_bp_claimed', String(tier))
    this.audio?.pickup?.()
    this._renderWeaponStore(); this._populateLobby()
    this.hud.addKillFeed?.(`Battle Pass: +${coins}🪙${gained.length ? ' · unlocked ' + gained.join(', ') : ''}`)
  }

  // ---- Match history (last 10) ----
  _recordHistory(won) {
    let h = []; try { h = JSON.parse(localStorage.getItem('ts_history') || '[]') } catch {}
    const mode = (this.net ? this.onlineMode : this.soloMode) || 'coop'
    h.unshift({ m: mode, k: this.kills || this.enemyKills || 0, w: !!won })
    localStorage.setItem('ts_history', JSON.stringify(h.slice(0, 10)))
  }

  _renderHistory() {
    const el = document.getElementById('history-list'); if (!el) return
    let h = []; try { h = JSON.parse(localStorage.getItem('ts_history') || '[]') } catch {}
    if (!h.length) { el.innerHTML = '<li class="on-empty">No matches yet</li>'; return }
    el.innerHTML = h.map((x) => `<li><span class="h-mode">${String(x.m).toUpperCase()}</span><span class="h-k">${x.k} elims</span><span class="h-r ${x.w ? 'win' : 'loss'}">${x.w ? 'WIN' : 'LOSS'}</span></li>`).join('')
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
    // Rotating DAILY challenges with live progress + claimable rewards.
    const d = this._dailies()
    const list = $('challenge-list')
    if (list) list.innerHTML = d.ch.map((c, i) => {
      const done = c.prog >= c.target
      const right = c.claimed ? '<span class="ch-claimed">✓ CLAIMED</span>'
        : done ? `<button class="ch-claim" data-ci="${i}">CLAIM +${c.xp}</button>`
          : `<span class="xp">+${c.xp}</span>`
      return `<li><div class="ch-row"><span>${c.t}</span>${right}</div>
       <div class="ch-bar"><i style="width:${Math.min(100, (c.prog / c.target) * 100)}%"></i></div>
       <div style="font-size:10px;opacity:.6">${Math.min(c.prog, c.target)}/${c.target} · +${c.coins}🪙</div></li>`
    }).join('')

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
    this._renderBattlePass()
    this._renderHistory()
  }

  // Quit from pause → finalize this match and show a recap (kills/XP gained +
  // new career total) before returning to the lobby. Proves it banked.
  _quitToLobby() {
    this.hud.hidePause()
    if (this.state !== STATE.PLAYING && this.state !== STATE.PAUSED) { this._toLobby(); return }
    this._recordMatch(false) // credit the match (kills already live-saved); builds _summary
    this.state = STATE.DEAD
    if (!this.input.isTouch) this.input.exitLock()
    const total = this._stats().kills || 0
    const k = this._summary?.kills ?? (this.kills || this.enemyKills || 0)
    document.getElementById('victory-btn').textContent = 'BACK TO LOBBY'
    this.hud.showMatchSummary(this._summary)
    this.hud.showVictory('MATCH SUMMARY', `This match: ${k} kills · +${this._summary?.xp || 0} XP    ·    Career kills: ${total}`, false)
  }

  // Return to the lobby menu (from victory/game-over).
  _toLobby() {
    this._recordMatch(false) // save kills/XP/coins even if you just quit (deduped)
    const vb = document.getElementById('victory-btn'); if (vb) vb.textContent = 'PLAY AGAIN'
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
    this.disasterMode = !!this.modeCfg?.disaster
    this._disasterT = this.disasterMode ? 120 : 0 // 2:00 until first disaster
    this._disasterN = 0 // how many survived
    this._disasterPending = null
    this._roleShown = false // infection role reveal spinner shows once
    this.hillRadius = 8
    this.domMode = !!this.modeCfg?.dom
    this.domYou = 0; this.domEnemy = 0; this._domPoints = []
    this.sndMode = !!this.modeCfg?.snd
    this._sndSite = null
    this._snd = this.sndMode ? { state: 'arming', plantT: 0, defuseT: 0, timer: 30 } : null
    this.score = 0
    this.enemyKills = 0
    this._wonBR = false
    this._brArmed = false // BR last-standing win only arms once bots have spawned
    // Apply combat-mode tweaks.
    if (this.modeCfg?.lowHp) { this.player.maxHp = 1; this.player.hp = 1 }
    // Fortnite-style: spawn with just a pistol + knife and loot the rest.
    // Pistol + Knife always, plus any weapons bought in the Armory.
    const loadout = [...new Set([0, 11, ...this._ownedWeapons().filter((i) => i >= 0 && i < this.weapons.defs.length)])]
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
    this._fx = [] // pings/sprays (old ones die with the rebuilt scene)
    this._supplyTimer = 38 // BR supply-drop countdown
    this.buildMode = false; this._builds = []; this._buildGhost = null; this._buildGhostPiece = null
    this._buildsById = {}; this._buildSeq = 0 // networked-build registry + id counter
    this.pickups.onPickup = (type, wi) => {
      if (type === 'chest') { this._dailyProgress('chests'); return }
      const label = type === 'weapon' ? (this.weapons.defs[wi]?.label || this.weapons.defs[wi]?.key || 'Weapon')
        : type === 'health' ? '+35 Health' : type === 'medkit' ? 'Full Health' : type === 'shield' ? '+50 Shield'
          : type === 'bigshield' ? 'Full Shield' : 'Ammo refilled'
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
      this._creditKill() // save to career immediately
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
    // ALL weapons come from loot chests now — no floating gun pickups.
    this.pickups.weaponDefs = this.weapons.defs
    const chests = (n) => { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * (HALF - 16); this.pickups.spawnChest(Math.cos(a) * r, Math.sin(a) * r) } }
    if (this.brMode) {
      drop('shield', 7); drop('health', 7); drop('ammo', 6); chests(20)
    } else {
      drop('health', 6); drop('shield', 5); drop('ammo', 6); chests(14)
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

    // Domination: three capture points (A/B/C). Hold them to tick score.
    if (this.domMode) {
      this._domPoints = []
      const R = this.world.arenaRadius * 0.52
      const names = ['A', 'B', 'C']
      for (let i = 0; i < 3; i++) {
        const ang = -Math.PI / 2 + i * (Math.PI * 2 / 3)
        const x = Math.cos(ang) * R, z = Math.sin(ang) * R
        const ring = new THREE.Mesh(
          new THREE.CylinderGeometry(6, 6, 0.3, 36, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
        )
        ring.position.set(x, 1.4, z); this.world.scene.add(ring)
        const disc = new THREE.Mesh(new THREE.TorusGeometry(6, 0.16, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffd24a }))
        disc.rotation.x = Math.PI / 2; disc.position.set(x, 0.12, z); this.world.scene.add(disc)
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.pickups._iconTex(names[i]), depthTest: false, transparent: true }))
        spr.scale.set(2.4, 2.4, 1); spr.position.set(x, 4, z); spr.renderOrder = 990; this.world.scene.add(spr)
        this._domPoints.push({ x, z, name: names[i], owner: null, mesh: ring, disc })
      }
      this.bots.forEach((b, i) => { b.objective = { x: this._domPoints[i % 3].x, z: this._domPoints[i % 3].z } })
    }

    // Search & Destroy: a single bomb site to plant/defend.
    if (this.sndMode) {
      const R = this.world.arenaRadius * 0.45
      const ang = Math.PI * 0.25
      const x = Math.cos(ang) * R, z = Math.sin(ang) * R
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(5, 5, 0.3, 32, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xff9f1c, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false })
      )
      ring.position.set(x, 1.4, z); this.world.scene.add(ring)
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.pickups._iconTex('💣'), depthTest: false, transparent: true }))
      spr.scale.set(2.6, 2.6, 1); spr.position.set(x, 4, z); spr.renderOrder = 990; this.world.scene.add(spr)
      this._sndSite = { x, z, mesh: ring }
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
    // Admin cheat: /supergun gives the blue energy Super Gun (handled locally,
    // not broadcast).
    if (text.toLowerCase() === '/supergun') {
      const i = this.weapons.defs.findIndex((d) => d.key === 'SuperGun')
      if (i >= 0 && this.state === STATE.PLAYING) {
        this.weapons.give(i); this.hud.setOwned(this.weapons.owned)
        this.hud.addChat('System', '🔵 SUPER GUN equipped — fire blue energy blasts!', { self: true })
      } else {
        this.hud.addChat('System', 'Start a match first, then /supergun.', { self: true })
      }
      return
    }
    // Admin/host: /arsenal grants the SuperGun + all 10 god-tier weapons at once.
    if (text.toLowerCase() === '/arsenal') {
      if (!this.isAdmin && this.net) { this.hud.addChat('System', 'Only the host can use /arsenal.', { self: true }); return }
      if (this.state !== STATE.PLAYING) { this.hud.addChat('System', 'Start a match first, then /arsenal.', { self: true }); return }
      const GOD = ['SuperGun', 'Plasma', 'Ion', 'Void', 'Nova', 'Singular', 'Antimat', 'Quasar', 'Hyper', 'Apoc', 'Omega', 'WorldEnd']
      for (const key of GOD) { const i = this.weapons.defs.findIndex((d) => d.key === key); if (i >= 0) this.weapons.give(i) }
      this.hud.setOwned(this.weapons.owned)
      this.hud.addChat('System', '☠ ADMIN ARSENAL granted — all god-tier weapons equipped!', { self: true })
      return
    }
    // Admin/host: /add [n] spawns AI bots into the match (up to 12 at a time).
    if (text.toLowerCase().startsWith('/add')) {
      if (!this.isAdmin && this.net) { this.hud.addChat('System', 'Only the host can use /add.', { self: true }); return }
      if (this.state !== STATE.PLAYING) { this.hud.addChat('System', 'Start a match first, then /add.', { self: true }); return }
      const n = Math.max(1, Math.min(12, parseInt(text.split(/\s+/)[1], 10) || 1))
      this._spawnBots(n, 'fighter')
      this.hud.addChat('System', `🤖 Added ${n} AI bot${n > 1 ? 's' : ''}.`, { self: true })
      return
    }
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
      this._creditKill() // save to career immediately
      this.hud.showKillBanner(`ELIMINATED ${bot.name}`)
      // Gun Game: each kill hands you a random gun (melee/grapple excluded — your
      // knife stays as a constant backup).
      if (this.modeCfg?.gungame) {
        this.ggLevel++
        const pool = this.weapons.defs.map((d, i) => i).filter((i) => {
          const d = this.weapons.defs[i]; return !d.tool && !d.melee && !d.secret
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
        onFx: (id, name, fx) => this._onFx(name, fx),
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
    // Battle royale + Search & Destroy = one life, no respawn.
    if (this.brMode || this.modeCfg?.oneLife) {
      this.state = STATE.DEAD
      if (!this.input.isTouch) this.input.exitLock()
      this._matchOver = true
      this._recordMatch(false)
      this.hud.showMatchSummary(this._summary)
      this.hud.showPause(this.brMode ? 'ELIMINATED' : 'YOU DIED', `Kills: ${this.kills}.`, 'PLAY AGAIN')
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
      this._creditKill() // save to career immediately
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
    // Build mode: click places the current piece instead of firing.
    if (this.buildMode) { this._updateBuildGhost(); if (click && this.player.alive) this._placeBuild() }
    const wantFire = (this.weapons.auto ? this.input.mouse.down : click) && !this.driving && !this.buildMode
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
        if (res.headshot) { this.audio.headshot(); this._dailyProgress('headshots') }
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
        if (res.buildHit) this._damageBuild(res.buildHit, res.dmg || this.weapons.def.damage || 25)
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
        // Super Gun: a huge blue energy blast.
        if (res.projectile === 'energy') this._fireGodWeapon(res.origin.clone(), res.dir.clone(), this.weapons.def.energyMode || 'orb')
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
      // BR (no human opponents present): last one standing wins. Only after bots
      // have actually spawned (`_brArmed`) — otherwise the first frames of a fresh
      // match (bots still loading) would instantly re-declare victory.
      if (this.bots.length > 0) this._brArmed = true
      if (this.brMode && this._brArmed && this.remotePlayers.size === 0 && !this._wonBR && this.player.alive && live.length === 0 && this.bots.length === 0) {
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
    // Infection role reveal (random) on the first frame of the match.
    if (this.infectMode && !this._roleShown) { this._roleShown = true; this._rollZombieRole() }
    // Natural Disasters mode.
    if (this.disasterMode) this._updateDisasters(dt)

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
      } else if (cfg.dom) {
        const R2 = 36 // 6u radius squared
        let mine = 0, theirs = 0
        for (const pt of this._domPoints) {
          const youIn = this.player.alive && (this.player.position.x - pt.x) ** 2 + (this.player.position.z - pt.z) ** 2 < R2
          const botIn = this.bots.some((b) => b.alive && (b.position.x - pt.x) ** 2 + (b.position.z - pt.z) ** 2 < R2)
          if (youIn && !botIn) pt.owner = 'you'
          else if (botIn && !youIn) pt.owner = 'enemy'
          if (pt.owner === 'you') mine++; else if (pt.owner === 'enemy') theirs++
          const col = (youIn && botIn) ? 0xffa500 : pt.owner === 'you' ? 0x4ade80 : pt.owner === 'enemy' ? 0xff5a5a : 0xffd24a
          pt.mesh.material.color.setHex(col); pt.disc.material.color.setHex(col)
        }
        this.domYou += dt * mine * 5
        this.domEnemy += dt * theirs * 5
        const tag = this._domPoints.map((p) => p.name + (p.owner === 'you' ? '🟢' : p.owner === 'enemy' ? '🔴' : '⚪')).join(' ')
        this.hud.setObjective('🚩 Capture and HOLD the points!')
        this.hud.setStormTimer(`🚩 You ${Math.floor(this.domYou)} · Enemy ${Math.floor(this.domEnemy)} / 200    ${tag}`)
        if (this.domYou >= 200) { this._matchOver = true; this._winMatch('DOMINATION', 'You dominated the map!') }
        else if (this.domEnemy >= 200) { this._matchOver = true; this._winMatch('DEFEAT', 'The enemy dominated.', false) }
      } else if (cfg.snd) {
        const s = this._snd, st = this._sndSite, R2 = 25 // 5u radius squared
        const youIn = this.player.alive && st && (this.player.position.x - st.x) ** 2 + (this.player.position.z - st.z) ** 2 < R2
        const botIn = st && this.bots.some((b) => b.alive && (b.position.x - st.x) ** 2 + (b.position.z - st.z) ** 2 < R2)
        const aliveBots = this.bots.filter((b) => b.alive).length
        if (aliveBots === 0 && s.state !== 'done') {
          s.state = 'done'; this._matchOver = true; this._winMatch('ENEMY ELIMINATED', 'You wiped out the defenders!')
        } else if (s.state === 'arming') {
          if (youIn) s.plantT += dt; else s.plantT = Math.max(0, s.plantT - dt * 0.5)
          this.hud.setObjective('💣 Reach the site and PLANT the bomb (stand on it)')
          this.hud.setStormTimer(youIn ? `💣 PLANTING…  ${Math.max(0, Math.ceil(2 - s.plantT))}` : `💣 Defenders: ${aliveBots}  —  get to the bomb site`)
          if (s.plantT >= 2) {
            s.state = 'planted'; s.timer = 30
            this.hud.addKillFeed('💣 Bomb planted — defend it!')
            if (st.mesh) st.mesh.material.color.setHex(0xff3030)
            this.bots.forEach((b) => { b.forceGoal = { x: st.x, z: st.z } }) // rush to defuse
          }
        } else if (s.state === 'planted') {
          s.timer -= dt
          if (botIn) s.defuseT += dt; else s.defuseT = Math.max(0, s.defuseT - dt)
          this.hud.setObjective('🛡️ DEFEND the bomb until it detonates!')
          this.hud.setStormTimer(s.defuseT > 0.2 ? `⚠️ DEFUSING!  ${Math.max(0, Math.ceil(6 - s.defuseT))}` : `💣 ARMED  ⏱ ${Math.ceil(s.timer)}   Defenders: ${aliveBots}`)
          if (s.defuseT >= 6) { s.state = 'done'; this._matchOver = true; this._winMatch('DEFEAT', 'The defenders defused the bomb.', false) }
          else if (s.timer <= 0) {
            s.state = 'done'; this._matchOver = true
            if (st) this.particles.emit({ x: st.x, y: 1, z: st.z }, 80, { color: [1, 0.5, 0.1], speed: 14, spread: 3, size: 2.4, life: 1.1, gravity: 6, up: 6 })
            this._winMatch('DETONATED!', 'The bomb went off — objective complete!')
          }
        }
      } else if (cfg.infect) {
        // Players-only infection (no AI). Other players are counted via the relay.
        this._matchT = (this._matchT || 0) + dt
        const remotes = this.net ? this.remotePlayers.size : 0
        const opponents = this.bots.filter((b) => b.alive).length + remotes
        const zombies = this.bots.filter((b) => b.alive && b.role === 'zombie').length + (this.playerZombie ? 1 : 0)
        const humans = this.bots.filter((b) => b.alive && b.role === 'fighter').length + remotes + (this.playerZombie ? 0 : 1)
        this.hud.setStormTimer(`🧟 INFECTION   You: ${this.playerZombie ? 'ZOMBIE 🧟' : 'INNOCENT 😇'}   Survivors: ${humans}   Zombies: ${zombies}`)
        // Only resolve once there are real opponents (else solo is a free sandbox).
        if (this._matchT > 4 && opponents > 0) {
          if (zombies === 0) { this._matchOver = true; this._winMatch('SURVIVORS WIN', 'Every zombie was eliminated!', !this.playerZombie) }
          else if (humans === 0) { this._matchOver = true; this._winMatch('INFECTION COMPLETE', 'Everyone was turned.', false) }
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
    this._updateFx(dt)
    this.pickups.update(dt, this.player, this.weapons)

    // Grenades.
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      if (this.grenades[i].update(dt)) this.grenades.splice(i, 1)
    }

    // Hurt feedback when HP drops: sound + shake + red flash + direction arc.
    if (this.player.hp < this._prevHp) {
      this.audio.hurt(); this._shake = Math.max(this._shake || 0, 0.35); this._hurtFlash = 0.6
      // Point a red arc toward whoever hurt us (remote shooter, else nearest threat).
      let src = null
      if (this.net && this._lastAttacker != null && this.remotePlayers.has(this._lastAttacker)) src = this.remotePlayers.get(this._lastAttacker).group?.position
      if (!src) {
        let bd = Infinity
        const consider = [...this.bots, ...this.spawner.enemies]
        for (const e of consider) {
          if (!e.alive) continue
          const ep = e.position || e.group?.position; if (!ep) continue
          const d = (ep.x - this.player.position.x) ** 2 + (ep.z - this.player.position.z) ** 2
          if (d < bd) { bd = d; src = ep }
        }
      }
      if (src) {
        const P = this.player.position
        const ang = Math.atan2(src.x - P.x, src.z - P.z)
        const aim = this.player.getAimRay()
        const face = Math.atan2(aim.dir.x, aim.dir.z)
        this.hud.damageFrom(ang - face)
      }
    }
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
      // Periodic supply drops: a chest parachutes into the current safe zone.
      this._supplyTimer = (this._supplyTimer ?? 38) - dt
      if (this._supplyTimer <= 0) {
        this._supplyTimer = 42
        const a = Math.random() * Math.PI * 2, r = Math.random() * this.zone.radius * 0.7
        this.pickups.spawnChest(this.zone.cx + Math.cos(a) * r, this.zone.cz + Math.sin(a) * r, true)
        this.hud.addKillFeed('📦 Supply drop incoming!')
      }
      // Bots flee the storm: run to the safe-zone centre near/over the edge, and
      // take storm damage if caught outside (so they don't camp the storm).
      const Z = this.zone
      for (const b of this.bots) {
        if (!b.alive) continue
        const d = Math.hypot(b.position.x - Z.cx, b.position.z - Z.cz)
        if (d > Z.radius * 0.82) {
          b.forceGoal = { x: Z.cx, z: Z.cz }
          if (d > Z.radius) b.applyDamage?.(Z.damage * dt, { name: 'the storm' }) // not a player kill
        } else if (b.forceGoal && b.forceGoal.x === Z.cx && b.forceGoal.z === Z.cz) {
          b.forceGoal = null // safely inside → resume normal AI
        }
      }
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
  explodeAt(pos, { radius = 8, damage = 120, depth = 0, energy = false } = {}) {
    if (energy) {
      this.particles.emit(pos, 90, { color: [0.3, 0.7, 1], speed: 20, spread: 13, size: 3.0, life: 0.55, gravity: -1, drag: 3, up: 5 })
      this.particles.emit(pos, 44, { color: [0.7, 0.95, 1], speed: 28, spread: 16, size: 1.2, life: 0.35, gravity: -1, drag: 4 })
      this.weapons.impact(pos, 0x44aaff)
    } else {
      this.particles.emit(pos, 64, { color: [1, 0.55, 0.12], speed: 15, spread: 11, size: 2.4, life: 0.5, gravity: -2, drag: 3, up: 4 })
      this.particles.emit(pos, 28, { color: [1, 0.92, 0.45], speed: 22, spread: 14, size: 1.0, life: 0.32, gravity: -2, drag: 4 })
      this.particles.emit(pos, 40, { color: [0.18, 0.18, 0.18], speed: 6, spread: 5, size: 3.6, life: 1.2, gravity: 1.4, drag: 1.4, up: 3 })
      this.weapons.impact(pos, 0xffa030)
    }
    this.audio.explosion()
    const pdShake = Math.hypot(this.player.position.x - pos.x, this.player.position.z - pos.z)
    if (pdShake < radius * 2) this._shake = Math.max(this._shake || 0, 0.5 * (1 - pdShake / (radius * 2)))

    for (const e of this.spawner.enemies) {
      if (!e.alive) continue
      const d = Math.hypot(e.group.position.x - pos.x, e.group.position.z - pos.z)
      if (d < radius) e.takeHit(damage * (1 - d / radius)) // counted by the spawner
    }
    // Bots (FFA/BR/etc.) — count as player kills.
    for (const b of this.bots) {
      if (!b.alive) continue
      const d = Math.hypot(b.position.x - pos.x, b.position.z - pos.z)
      if (d < radius) b.applyDamage?.(damage * (1 - d / radius), null)
    }
    // Remote players (online): claim hits.
    if (this.net) for (const rp of this.remotePlayers.values()) {
      const d = Math.hypot(rp.group.position.x - pos.x, rp.group.position.z - pos.z)
      if (d < radius) this.net.sendHit(rp.id, damage * (1 - d / radius))
    }
    const pd = Math.hypot(this.player.position.x - pos.x, this.player.position.z - pos.z)
    if (pd < radius && this.player.alive && !energy) this.player.takeDamage((damage * 0.36) * (1 - pd / radius))

    // Destroy/damage nearby builds.
    if (this._builds && this._builds.length) {
      for (const rec of [...this._builds]) {
        const d = Math.hypot(rec.x - pos.x, rec.z - pos.z)
        if (d < radius + 1.5) this._damageBuild(rec, damage * (1 - d / (radius + 1.5)))
      }
    }

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

  // Super Gun projectile: a giant glowing blue energy orb (3x) that PIERCES
  // everything (walls included) and one-shots anything it passes through, leaving
  // a heavy particle trail. Duck-typed into this.grenades.
  _fireEnergy(origin, dir) {
    // Tier scales the power: bigger orb, wider one-shot radius, bigger final blast,
    // faster travel. SuperGun = tier 1; the Armory god-guns are tiers 2..11.
    const tier = this.weapons.def?.energyTier || 1
    const col = this.weapons.def?.energyColor || 0x44aaff
    const r0 = 1.35 * (1 + (tier - 1) * 0.18)
    const r1 = 2.85 * (1 + (tier - 1) * 0.18)
    const KILL_R = 4.5 + (tier - 1) * 2.2 // wider one-shot radius at higher tiers
    const blastR = 14 + (tier - 1) * 5
    const speed = 80 + (tier - 1) * 6
    const core = new THREE.Color(col).lerp(new THREE.Color(0xffffff), 0.55)
    const grp = new THREE.Group()
    grp.add(new THREE.Mesh(new THREE.SphereGeometry(r0, 18, 18), new THREE.MeshBasicMaterial({ color: core })))
    grp.add(new THREE.Mesh(new THREE.SphereGeometry(r1, 18, 18), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.3, depthWrite: false })))
    grp.add(new THREE.PointLight(col, 4 + tier, 30 + tier * 4))
    grp.position.copy(origin)
    this.world.scene.add(grp)
    const vel = dir.clone().multiplyScalar(speed)
    const cv = new THREE.Color(col)
    const game = this
    const blast = {
      pos: origin.clone(), life: 3.0, _t: 0, group: grp,
      dispose() { if (grp.parent) grp.parent.remove(grp); grp.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.() }) },
      update(dt) {
        this._t += dt
        this.pos.addScaledVector(vel, dt); grp.position.copy(this.pos)
        grp.children[0].scale.setScalar(1 + Math.sin(this._t * 30) * 0.12)
        game.particles.emit(this.pos, 10 + tier, { color: [cv.r, cv.g, cv.b], speed: 6, spread: 2.6, size: 3.0, life: 0.4, drag: 4 })
        // Pierce + one-shot anything within range each frame (walls don't stop it).
        for (const b of game.bots) {
          if (b.alive && Math.hypot(b.position.x - this.pos.x, b.position.z - this.pos.z) < KILL_R) b.applyDamage?.(1e9, null)
        }
        for (const e of game.spawner.enemies) {
          if (e.alive && Math.hypot(e.group.position.x - this.pos.x, e.group.position.z - this.pos.z) < KILL_R) {
            if (e.takeHit(1e9)) { game.score += 10; game.hud.setScore(game.score) }
          }
        }
        if (game.net) for (const rp of game.remotePlayers.values()) {
          if (Math.hypot(rp.group.position.x - this.pos.x, rp.group.position.z - this.pos.z) < KILL_R) game.net.sendHit(rp.id, 1e9)
        }
        this.life -= dt
        if (this.life <= 0 || this.pos.y < 0.2) {
          game.explodeAt(this.pos, { radius: blastR, damage: 1e9, energy: true })
          this.dispose(); return true
        }
        return false
      },
    }
    this.grenades.push(blast)
  }

  // Unified list of everything killable, with a kill() that one-shots it.
  _godTargets() {
    const list = []
    for (const b of this.bots) if (b.alive) list.push({ pos: b.position, kill: () => b.applyDamage?.(1e9, null) })
    for (const e of this.spawner.enemies) if (e.alive) list.push({ pos: e.group.position, kill: () => { if (e.takeHit(1e9)) { this.score += 10; this.hud.setScore(this.score) } } })
    if (this.net) for (const rp of this.remotePlayers.values()) list.push({ pos: rp.group.position, kill: () => this.net.sendHit(rp.id, 1e9) })
    return list
  }

  _rgb(col) { const c = new THREE.Color(col); return [c.r, c.g, c.b] }

  // Dispatch each god-tier weapon to its OWN effect.
  _fireGodWeapon(origin, dir, mode) {
    const col = this.weapons.def?.energyColor || 0x44aaff
    const flat = new THREE.Vector3(dir.x, 0, dir.z); if (flat.lengthSq() < 1e-4) flat.set(0, 0, 1); else flat.normalize()
    switch (mode) {
      case 'spread': for (let i = -1; i <= 1; i++) { const d = dir.clone(); d.x += i * 0.13; d.normalize(); this._fireEnergy(origin.clone(), d) } return
      case 'chain': return this._godChain(origin, col)
      case 'blackhole': return this._godWell(flat, col, 12, 1.4)
      case 'well': return this._godWell(flat, col, 18, 3.2)
      case 'nova': return this._godNova(col, 28)
      case 'omega': return this._godNova(col, 75)
      case 'rail': return this._godRail(origin, dir, col)
      case 'beam': return this._godBeam(origin, dir, col)
      case 'meteor': return this._godMeteor(this.player.position.clone().addScaledVector(flat, 20), 8, 24, col)
      case 'storm': return this._godMeteor(new THREE.Vector3(0, 0, 0), 24, this.world.arenaRadius, col)
      case 'worldend': return this._godWorldEnd(col)
      default: return this._fireEnergy(origin, dir)
    }
  }

  // Delayed one-shot explosion (used by meteor storms / world end).
  _delayBlast(pos, radius, col, delay) {
    const game = this; let t = 0
    this.grenades.push({ update(dt) { t += dt; if (t >= delay) { game.explodeAt(pos, { radius, damage: 1e9, energy: true }); return true } return false }, dispose() {} })
  }

  // Ion Storm: chain lightning that arcs between the nearest foes and zaps them.
  _godChain(origin, col) {
    const pp = this.player.position
    const near = this._godTargets().map((t) => ({ t, d: t.pos.distanceTo(pp) })).filter((o) => o.d < 90).sort((a, b) => a.d - b.d).slice(0, 8)
    let from = origin.clone()
    for (const { t } of near) {
      this.weapons.beam(from, t.pos.clone(), col); this.weapons.beam(from, t.pos.clone(), 0xffffff)
      this.particles.emit(t.pos, 14, { color: this._rgb(col), speed: 8, spread: 2, size: 1.0, life: 0.4 })
      t.kill(); from = t.pos.clone()
    }
    this.audio?.hit?.(); if (!near.length) this.audio?.shoot?.('Pistol')
  }

  // Antimatter Rifle: instant railgun line — deletes everything along the beam.
  _godRail(origin, dir, col) {
    const end = origin.clone().addScaledVector(dir, 500)
    this.weapons.beam(origin, end, col); this.weapons.beam(origin, end, 0xffffff)
    for (const t of this._godTargets()) {
      const v = t.pos.clone().sub(origin); const proj = v.dot(dir); if (proj < 0) continue
      const closest = origin.clone().addScaledVector(dir, proj)
      if (closest.distanceTo(t.pos) < 5) { t.kill(); this.particles.emit(t.pos, 12, { color: this._rgb(col), speed: 7, spread: 2, size: 0.9, life: 0.4 }) }
    }
    this._shake = Math.max(this._shake || 0, 0.5)
  }

  // Hyperbeam: wide cone in front instantly vaporises foes.
  _godBeam(origin, dir, col) {
    const range = 80
    for (const t of this._godTargets()) {
      const v = t.pos.clone().sub(this.player.position); const dist = v.length(); if (dist > range || dist < 0.1) continue
      if (v.normalize().dot(dir) > 0.8) { t.kill(); this.particles.emit(t.pos, 12, { color: this._rgb(col), speed: 7, spread: 2, size: 0.9, life: 0.4 }) }
    }
    for (let i = -3; i <= 3; i++) { const d = dir.clone(); d.x += i * 0.06; d.y += (i % 2) * 0.02; d.normalize(); this.weapons.beam(origin, origin.clone().addScaledVector(d, range), col) }
    this._shake = Math.max(this._shake || 0, 0.6)
  }

  // Nova Blaster / Omega: instant shockwave centred on you + expanding ring.
  _godNova(col, radius) {
    const c = this.player.position.clone(); c.y += 1
    this.explodeAt(c, { radius, damage: 1e9, energy: true })
    this._shake = Math.max(this._shake || 0, Math.min(1.5, 0.5 + radius / 80))
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.5, 8, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, depthWrite: false }))
    ring.rotation.x = Math.PI / 2; ring.position.copy(c); this.world.scene.add(ring)
    let t = 0
    this.grenades.push({ update(dt) { t += dt; const s = 1 + (radius) * (t / 0.5); ring.scale.set(s, s, s); ring.material.opacity = Math.max(0, 0.8 * (1 - t / 0.5)); return t >= 0.5 }, dispose() {}, })
    // ring self-cleans on the same frame it finishes via dispose below
    const game = this
    setTimeout(() => { if (ring.parent) game.world.scene.remove(ring); ring.geometry.dispose(); ring.material.dispose() }, 600)
  }

  // Void Ripper / Singularity: a black hole that drags foes in, then implodes.
  _godWell(flat, col, radius, life) {
    const center = this.player.position.clone().addScaledVector(flat, 18); center.y = 1.5
    const grp = new THREE.Group()
    grp.add(new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 16), new THREE.MeshBasicMaterial({ color: 0x000000 })))
    grp.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 16), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12, depthWrite: false })))
    grp.position.copy(center); this.world.scene.add(grp)
    const game = this; let t = 0
    this.grenades.push({
      dispose() { if (grp.parent) grp.parent.remove(grp); grp.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.() }) },
      update(dt) {
        t += dt; grp.rotation.y += dt * 5
        for (const b of game.bots) { if (!b.alive) continue; const d = Math.hypot(b.position.x - center.x, b.position.z - center.z); if (d < radius) { b.position.x += (center.x - b.position.x) * 0.06; b.position.z += (center.z - b.position.z) * 0.06; if (d < 3.5) b.applyDamage?.(1e9, null) } }
        for (const e of game.spawner.enemies) { if (!e.alive) continue; const gp = e.group.position; const d = Math.hypot(gp.x - center.x, gp.z - center.z); if (d < radius) { gp.x += (center.x - gp.x) * 0.06; gp.z += (center.z - gp.z) * 0.06; if (d < 3.5 && e.takeHit(1e9)) { game.score += 10; game.hud.setScore(game.score) } } }
        if (game.net) for (const rp of game.remotePlayers.values()) { const gp = rp.group.position; if (Math.hypot(gp.x - center.x, gp.z - center.z) < 4) game.net.sendHit(rp.id, 1e9) }
        game.particles.emit(center, 5, { color: game._rgb(col), speed: 3, spread: radius * 0.4, size: 1.4, life: 0.35, drag: 5 })
        if (t >= life) { game.explodeAt(center, { radius, damage: 1e9, energy: true }); this.dispose(); return true }
        return false
      },
    })
  }

  // Quasar (local) / Apocalypse (map-wide): a barrage of staggered meteor blasts.
  _godMeteor(center, count, spread, col) {
    this.hud.showKillBanner('☄ METEOR STORM')
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread
      const pos = new THREE.Vector3(center.x + Math.cos(a) * r, 1, center.z + Math.sin(a) * r)
      this._delayBlast(pos, 12, col, Math.random() * 0.9)
    }
    this._shake = Math.max(this._shake || 0, 0.7)
  }

  // World Annihilator: deletes EVERYTHING on the map at once.
  _godWorldEnd(col) {
    for (const t of this._godTargets()) t.kill()
    if (this._builds) for (const rec of [...this._builds]) this._removeBuild(rec)
    const R = this.world.arenaRadius
    for (let i = 0; i < 36; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * R; this._delayBlast(new THREE.Vector3(Math.cos(a) * r, 1, Math.sin(a) * r), 16, col, Math.random() * 1.4) }
    this._shake = Math.max(this._shake || 0, 1.6)
    this.hud.showKillBanner('🌍 WORLD ANNIHILATED')
    this.audio?.explosion?.()
  }

  // ---- Pings & Sprays ----
  _fxRaycast() {
    const aim = this.player.getAimRay()
    this._fxRay = this._fxRay || new THREE.Raycaster()
    this._fxRay.set(aim.origin, aim.dir); this._fxRay.far = 300
    const hits = this._fxRay.intersectObjects(this.world.obstacles.map((o) => o.mesh), true)
    if (hits.length) return { point: hits[0].point.clone(), normal: hits[0].face ? hits[0].face.normal.clone() : new THREE.Vector3(0, 1, 0) }
    return { point: aim.origin.clone().addScaledVector(aim.dir, 40).setY(0.6), normal: new THREE.Vector3(0, 1, 0) }
  }

  _placePing() {
    const { point } = this._fxRaycast()
    this._spawnPing(point, '📍')
    this.audio?.pickup?.()
    this.hud.addKillFeed('📍 Pinged a location')
    this.net?.sendFx({ kind: 'ping', x: point.x, y: point.y, z: point.z })
  }

  _placeSpray() {
    if (this._sprayCd && performance.now() < this._sprayCd) return
    this._sprayCd = performance.now() + 600
    const SPRAYS = ['😎', '💀', '🔥', '👾', '⭐', '🎯', '😂', '🤖']
    const e = SPRAYS[Math.floor(Math.random() * SPRAYS.length)]
    const { point, normal } = this._fxRaycast()
    this._spawnSpray(point, normal, e)
    this.net?.sendFx({ kind: 'spray', x: point.x, y: point.y, z: point.z, nx: normal.x, ny: normal.y, nz: normal.z, e })
  }

  _onFx(name, fx) {
    if (!fx) return
    if (fx.kind === 'ping') this._spawnPing(new THREE.Vector3(fx.x, fx.y, fx.z), '📍', name)
    else if (fx.kind === 'spray') this._spawnSpray(new THREE.Vector3(fx.x, fx.y, fx.z), new THREE.Vector3(fx.nx, fx.ny, fx.nz), fx.e)
    else if (fx.kind === 'build') { if (!this._buildsById?.[fx.id]) this._spawnBuild(fx.piece, fx.tx, fx.tz, fx.baseY, fx.yaw, !!fx.down, fx.id) }
    else if (fx.kind === 'buildgone') { const rec = this._buildsById?.[fx.id]; if (rec) this._removeBuild(rec, true) }
    else if (fx.kind === 'flash') { const d = Math.hypot(this.player.position.x - fx.x, this.player.position.z - fx.z); if (d < (fx.r || 26)) this._flashScreen(Math.max(0.3, 1 - d / (fx.r || 26))) }
  }

  _emojiTexture(emoji, px = 128) {
    const cv = document.createElement('canvas'); cv.width = cv.height = px
    const ctx = cv.getContext('2d')
    ctx.font = `${px * 0.8}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(emoji, px / 2, px / 2 + px * 0.05)
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t
  }

  _spawnPing(pos, emoji, name) {
    const grp = new THREE.Group(); grp.position.copy(pos)
    const dia = new THREE.Mesh(new THREE.OctahedronGeometry(0.6), new THREE.MeshBasicMaterial({ color: 0x6cf0ff, depthTest: false, transparent: true }))
    dia.renderOrder = 998; dia.position.y = 2.4
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._emojiTexture(emoji), depthTest: false, transparent: true }))
    spr.scale.set(1.4, 1.4, 1); spr.position.y = 3.6; spr.renderOrder = 999
    grp.add(dia, spr)
    this.world.scene.add(grp)
    this.particles?.emit(pos, 16, { color: [0.4, 0.9, 1], speed: 5, spread: 2, size: 1.2, life: 0.5, up: 3 })
    this._fx = this._fx || []
    this._fx.push({ grp, life: 8, kind: 'ping', _t: 0 })
  }

  _spawnSpray(pos, normal, emoji) {
    const n = normal.lengthSq() > 0.001 ? normal.clone().normalize() : new THREE.Vector3(0, 1, 0)
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({ map: this._emojiTexture(emoji), transparent: true, depthWrite: false })
    )
    plane.position.copy(pos).addScaledVector(n, 0.06)
    plane.lookAt(plane.position.clone().add(n))
    this.world.scene.add(plane)
    this._fx = this._fx || []
    this._fx.push({ grp: plane, life: 22, kind: 'spray', _t: 0, mat: plane.material })
  }

  _updateFx(dt) {
    if (!this._fx || !this._fx.length) return
    for (let i = this._fx.length - 1; i >= 0; i--) {
      const f = this._fx[i]; f.life -= dt; f._t += dt
      if (f.kind === 'ping') {
        f.grp.children[0].rotation.y += dt * 2
        f.grp.children[0].position.y = 2.4 + Math.sin(f._t * 3) * 0.18
        if (f.grp.children[1]) f.grp.children[1].quaternion.copy(this.camera.quaternion)
      } else if (f.kind === 'spray' && f.life < 3) {
        f.mat.opacity = Math.max(0, f.life / 3)
      }
      if (f.life <= 0) {
        this.world.scene.remove(f.grp)
        f.grp.traverse?.((o) => { o.geometry?.dispose?.(); o.material?.dispose?.() })
        this._fx.splice(i, 1)
      }
    }
  }

  // ---- Build mode (walls / floors / ramps) ----
  _buildHint() {
    const p = (this.buildPiece || 'wall').toUpperCase()
    this.hud.setObjective(`🔨 BUILD: ${p}  ·  [1] Wall  [2] Floor  [3] Ramp  [4] Window  ·  look down = down-ramp  ·  Click to place  ·  B / Esc exit`)
  }

  _toggleBuild() {
    if (this.driving) return
    this.buildMode = !this.buildMode
    if (this.buildMode) {
      this.buildPiece = this.buildPiece || 'wall'
      this._updateBuildGhost()
      this._buildHint()
    } else {
      if (this._buildGhost) this._buildGhost.visible = false
      this.hud.setObjective('')
    }
  }

  _setBuildPiece(p) {
    this.buildPiece = p
    this._buildGhostPiece = null // force ghost rebuild
    this._updateBuildGhost()
    this._buildHint()
  }

  _makePiece(piece, ghost, down = false) {
    const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.05, transparent: ghost, opacity: ghost ? 0.4 : 1, emissive: ghost ? 0x2a5a8a : 0x000000 })
    let obj
    if (piece === 'wall') {
      obj = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.4), mat(0x8fc4ff)); obj.userData.localY = 2
    } else if (piece === 'floor') {
      obj = new THREE.Mesh(new THREE.BoxGeometry(4, 0.4, 4), mat(0xc9a36a)); obj.userData.localY = -0.2
    } else if (piece === 'window') {
      // A wall with a centred hole you can shoot (and see) through.
      obj = new THREE.Group(); obj.userData.localY = 0
      const c = 0x8fc4ff
      const add = (w, hgt, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, 0.4), mat(c)); m.position.y = y; obj.add(m) }
      add(4, 1.2, 0.6)   // sill
      add(4, 1.2, 3.4)   // header
      const side = (x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 0.4), mat(c)); m.position.set(x, 2, 0); obj.add(m) }
      side(-1.4); side(1.4) // jambs — leaves a ~1.6×1.6 hole in the middle
    } else { // ramp — a tilted plank (walkable slope handled by collision)
      obj = new THREE.Group()
      const plank = new THREE.Mesh(new THREE.BoxGeometry(4, 0.4, 5.66), mat(0xc9a36a))
      plank.rotation.x = down ? Math.PI / 4 : -Math.PI / 4
      obj.add(plank); obj.userData.localY = down ? -2 : 2
    }
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = !ghost; o.receiveShadow = !ghost } })
    return obj
  }

  _buildPlacement() {
    const p = this.player.position
    const baseY = Math.max(0, Math.round(p.y / 4) * 4)
    // Use the REAL camera look direction (where you're aiming), not raw yaw.
    const aim = this.player.getAimRay()
    const fwd = new THREE.Vector3(aim.dir.x, 0, aim.dir.z)
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1); else fwd.normalize()
    const tx = Math.round((p.x + fwd.x * 4) / 4) * 4
    const tz = Math.round((p.z + fwd.z * 4) / 4) * 4
    const yawSnap = Math.round(Math.atan2(fwd.x, fwd.z) / (Math.PI / 2)) * (Math.PI / 2)
    const down = this.buildPiece === 'ramp' && aim.dir.y < -0.3 // looking down → down-ramp
    return { tx, tz, baseY, yawSnap, down }
  }

  _updateBuildGhost() {
    if (!this.buildMode) return
    const { tx, tz, baseY, yawSnap, down } = this._buildPlacement()
    const tag = this.buildPiece + (down ? '-down' : '')
    if (!this._buildGhost || this._buildGhostPiece !== tag) {
      if (this._buildGhost) this.world.scene.remove(this._buildGhost)
      this._buildGhost = this._makePiece(this.buildPiece, true, down)
      this._buildGhostPiece = tag
      this.world.scene.add(this._buildGhost)
    }
    const g = this._buildGhost
    g.visible = true
    g.position.set(tx, baseY + g.userData.localY, tz)
    g.rotation.y = yawSnap
  }

  _placeBuild() {
    if (!this.buildMode) return
    const { tx, tz, baseY, yawSnap, down } = this._buildPlacement()
    const piece = this.buildPiece
    const netId = `${this.net?.id ?? 'me'}_${++this._buildSeq}`
    this._spawnBuild(piece, tx, tz, baseY, yawSnap, down, netId)
    this.audio?.pickup?.()
    // Broadcast so other players SEE / collide with / walk on this build.
    this.net?.sendFx({ kind: 'build', id: netId, piece, tx, tz, baseY, yaw: yawSnap, down: down ? 1 : 0 })
  }

  // Create a build with real colliders (used by local placement AND remote sync).
  _spawnBuild(piece, tx, tz, baseY, yawSnap, down, netId) {
    const obj = this._makePiece(piece, false, down)
    obj.position.set(tx, baseY + obj.userData.localY, tz)
    obj.rotation.y = yawSnap
    this.world.scene.add(obj)
    this._builds = this._builds || []
    const obstacle = { mesh: obj, radius: 2, x: tx, z: tz }
    this.world.obstacles.push(obstacle)
    const plats = []

    if (piece === 'ramp') {
      // Walkable slope: one platform with interpolated support height along the
      // facing axis (collision in Player._resolvePlatforms handles `ramp`).
      const fwd = new THREE.Vector3(Math.sin(yawSnap), 0, Math.cos(yawSnap))
      const axis = Math.abs(fwd.x) > Math.abs(fwd.z) ? 'x' : 'z'
      const dir = axis === 'x' ? Math.sign(fwd.x) || 1 : Math.sign(fwd.z) || 1
      const yLow = down ? baseY - 4 : baseY
      const yHigh = down ? baseY : baseY + 4
      const highTowardDir = !down // up-ramp: high end toward facing; down-ramp: low toward facing
      let yMin, yMax
      if (highTowardDir) { if (dir > 0) { yMin = yLow; yMax = yHigh } else { yMin = yHigh; yMax = yLow } }
      else { if (dir > 0) { yMin = yHigh; yMax = yLow } else { yMin = yLow; yMax = yHigh } }
      const plat = { minX: tx - 2, maxX: tx + 2, minZ: tz - 2, maxZ: tz + 2, top: Math.max(yMin, yMax), bottom: Math.min(yMin, yMax), climbable: true, ramp: { axis, yMin, yMax } }
      this.world.platforms.push(plat); plats.push(plat)
    } else {
      const wb = new THREE.Box3().setFromObject(obj)
      const plat = {
        minX: wb.min.x, maxX: wb.max.x, minZ: wb.min.z, maxZ: wb.max.z,
        top: wb.max.y, bottom: wb.min.y, climbable: piece === 'floor',
      }
      this.world.platforms.push(plat); plats.push(plat)
    }

    // Destructible: builds have HP and can be shot or blown up.
    const maxHp = piece === 'floor' ? 150 : piece === 'ramp' ? 120 : 200
    const rec = { obj, obstacle, plats, hp: maxHp, maxHp, x: tx, y: baseY, z: tz, bar: null, netId }
    obj.traverse((o) => { if (o.isMesh) o.userData.build = rec }) // bullets find it
    this._builds.push(rec)
    if (netId) { this._buildsById = this._buildsById || {}; this._buildsById[netId] = rec }
    this.particles?.emit({ x: tx, y: baseY + 1, z: tz }, 8, { color: [0.5, 0.8, 1], speed: 3, spread: 2, size: 0.8, life: 0.4, up: 2 })
    return rec
  }

  // Damage a placed build; show a health bar; destroy at 0 HP.
  _damageBuild(rec, dmg) {
    if (!rec || rec._dead) return
    rec.hp -= dmg
    this.particles?.emit({ x: rec.x, y: rec.y + 1.5, z: rec.z }, 5, { color: [0.7, 0.85, 1], speed: 4, spread: 1.5, size: 0.4, life: 0.3 })
    if (rec.hp <= 0) { this._removeBuild(rec); return }
    // Health bar billboard above the piece.
    if (!rec.bar) {
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 10
      const tex = new THREE.CanvasTexture(cv)
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
      spr.scale.set(2.4, 0.38, 1); spr.position.set(rec.x, rec.y + 4.6, rec.z); spr.renderOrder = 997
      this.world.scene.add(spr)
      rec.bar = { spr, cv, tex }
    }
    const f = Math.max(0, rec.hp / rec.maxHp)
    const c = rec.bar.cv.getContext('2d')
    c.clearRect(0, 0, 64, 10); c.fillStyle = '#000a'; c.fillRect(0, 0, 64, 10)
    c.fillStyle = f > 0.5 ? '#4ade80' : f > 0.25 ? '#ffcb3d' : '#ff5a5a'; c.fillRect(1, 1, 62 * f, 8)
    rec.bar.tex.needsUpdate = true
  }

  _removeBuild(rec, fromNet = false) {
    if (rec._dead) return
    rec._dead = true
    this.world.scene.remove(rec.obj)
    rec.obj.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.() })
    const oi = this.world.obstacles.indexOf(rec.obstacle); if (oi >= 0) this.world.obstacles.splice(oi, 1)
    for (const pl of rec.plats) { const i = this.world.platforms.indexOf(pl); if (i >= 0) this.world.platforms.splice(i, 1) }
    if (rec.bar) { this.world.scene.remove(rec.bar.spr); rec.bar.tex.dispose() }
    const bi = this._builds.indexOf(rec); if (bi >= 0) this._builds.splice(bi, 1)
    if (rec.netId && this._buildsById) delete this._buildsById[rec.netId]
    // Sync the destruction to everyone (unless this removal came from the network).
    if (!fromNet && rec.netId && this.net) this.net.sendFx({ kind: 'buildgone', id: rec.netId })
    this.audio?.explosion?.()
    this.particles?.emit({ x: rec.x, y: rec.y + 1.5, z: rec.z }, 18, { color: [0.6, 0.75, 1], speed: 7, spread: 2.5, size: 0.7, life: 0.5, up: 2 })
  }

  // Grenade arsenal — cycle with H, throw with G.
  _cycleGrenade() {
    this._nadeType = ((this._nadeType || 0) + 1) % NADE_TYPES.length
    this.hud.addKillFeed?.(`🧨 ${NADE_TYPES[this._nadeType].name} selected`)
  }

  throwGrenade() {
    if (this._grenadeCd > 0 || !this.player.alive) return
    this._grenadeCd = 1.0
    const type = NADE_TYPES[this._nadeType || 0]
    const aim = this.player.getAimRay()
    const start = aim.origin.clone().addScaledVector(aim.dir, 0.8)
    const vel = aim.dir.clone().multiplyScalar(type.speed || 20)
    vel.y += 4 // slight lob
    this.grenades.push(new Grenade({
      world: this.world, assets: this.assets, position: start, velocity: vel,
      fuse: type.fuse, impact: !!type.impact,
      proximity: 3.0, targets: () => this._nadeTargets(), // detonate near enemies
      onExplode: (p) => this[type.fn](p),
    }))
  }

  // Positions of everything a grenade should detonate near (bots, wave enemies, remotes).
  _nadeTargets() {
    const out = []
    for (const b of this.bots) if (b.alive) out.push(b.position)
    for (const e of this.spawner.enemies) if (e.alive) out.push(e.group.position)
    if (this.net) for (const rp of this.remotePlayers.values()) out.push(rp.group.position)
    return out
  }

  // ---- Grenade detonation behaviours ----
  _nadeFrag(p) { this.explodeAt(p, { radius: 7, damage: 110 }) }
  _nadeSticky(p) { this.explodeAt(p, { radius: 9, damage: 170 }) }
  _nadeCluster(p) {
    this.explodeAt(p, { radius: 6, damage: 70 })
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2
      const v = new THREE.Vector3(Math.cos(a) * 9, 7 + Math.random() * 3, Math.sin(a) * 9)
      this.grenades.push(new Grenade({
        world: this.world, assets: this.assets, position: p.clone().add(new THREE.Vector3(0, 0.5, 0)), velocity: v,
        fuse: 0.7 + Math.random() * 0.5, impact: false, onExplode: (q) => this.explodeAt(q, { radius: 5, damage: 70 }),
      }))
    }
  }
  _nadeSmoke(p) {
    this.audio?.explosion?.()
    const game = this; let t = 0
    const c = p.clone(); c.y = 0.5
    this.grenades.push({ update(dt) { t += dt; if (t < 7) { game.particles.emit({ x: c.x + (Math.random() - 0.5) * 5, y: 0.4 + Math.random() * 2.5, z: c.z + (Math.random() - 0.5) * 5 }, 6, { color: [0.7, 0.7, 0.72], speed: 1.2, spread: 2, size: 4.2, life: 1.6, gravity: 0.4, up: 1 }) } return t >= 7 }, dispose() {} })
  }
  _nadeFlash(p) {
    // Blind the player if near & exposed; stun bots in range.
    const R = 26
    const pd = this.player.position.distanceTo(p)
    if (pd < R) this._flashScreen(Math.max(0.25, 1 - pd / R))
    for (const b of this.bots) { if (b.alive && b.position.distanceTo(p) < 18) b._stun = 3 }
    // White out the screens of other players caught in the blast.
    this.net?.sendFx({ kind: 'flash', x: p.x, z: p.z, r: R })
    this.particles.emit(p, 40, { color: [1, 1, 1], speed: 18, spread: 6, size: 1.4, life: 0.4 })
    this.audio?.explosion?.()
  }
  _nadeBoogie(p) {
    for (const b of this.bots) { if (b.alive && b.position.distanceTo(p) < 16) b._boogie = 5 }
    for (let k = 0; k < 30; k++) this.particles.emit({ x: p.x + (Math.random() - 0.5) * 8, y: 0.3 + Math.random() * 2, z: p.z + (Math.random() - 0.5) * 8 }, 2, { color: [Math.random(), Math.random(), Math.random()], speed: 6, spread: 3, size: 1.0, life: 0.8, up: 4 })
    this.hud.addKillFeed?.('🪩 Boogie bomb — enemies are dancing!')
    this.audio?.pickup?.()
  }

  _flashScreen(intensity = 1) {
    let el = document.getElementById('flashbang')
    if (!el) { el = document.createElement('div'); el.id = 'flashbang'; document.body.appendChild(el) }
    el.style.transition = 'none'; el.style.opacity = String(Math.min(1, intensity))
    void el.offsetWidth
    el.style.transition = 'opacity 1.6s ease-out'; el.style.opacity = '0'
  }

  // ---- Role reveal (Infection): a spinning tag that lands on a RANDOM role ----
  _rollZombieRole() {
    const zombie = Math.random() < 0.5 // random per request
    this._showRoleSpinner(zombie ? 'zombie' : 'innocent')
    if (zombie) this._infectPlayer()
  }

  _showRoleSpinner(role) {
    let el = document.getElementById('role-spinner')
    if (!el) { el = document.createElement('div'); el.id = 'role-spinner'; document.body.appendChild(el) }
    el.style.display = 'flex'; el.classList.add('spinning'); el.classList.remove('zombie', 'innocent')
    const words = ['ZOMBIE', 'INNOCENT', 'INNOCENT', 'ZOMBIE', 'INNOCENT']
    let i = 0, spins = 0
    clearInterval(this._roleIv)
    this._roleIv = setInterval(() => {
      el.textContent = words[i++ % words.length]; spins++
      if (spins > 24) {
        clearInterval(this._roleIv)
        el.classList.remove('spinning')
        el.textContent = role === 'zombie' ? '🧟 YOU ARE THE ZOMBIE' : '😇 INNOCENT'
        el.classList.add(role === 'zombie' ? 'zombie' : 'innocent')
        setTimeout(() => { el.style.display = 'none' }, 2400)
      }
    }, 85)
  }

  // ---- Natural Disasters mode ----
  _updateDisasters(dt) {
    if (!this.disasterMode || this._matchOver) return
    if (this._disasterPending) {
      this._disasterPending.t -= dt
      if (this._disasterPending.t <= 0) {
        const d = this._disasterPending.d; this._disasterPending = null
        this._runDisaster(d); this._disasterN++; this._disasterT = 120
        this._dropRelief() // recovery loot so survival is sustainable
        this.hud.addKillFeed?.(`✅ Survived ${this._disasterN} — relief supplies dropped!`)
      } else {
        this.hud.setStormTimer(`⚠️ ${this._disasterPending.d.i} ${this._disasterPending.d.n} INCOMING — ${Math.ceil(this._disasterPending.t)}`)
      }
      return
    }
    this._disasterT -= dt
    const tt = Math.max(0, this._disasterT), mm = Math.floor(tt / 60), ss = String(Math.floor(tt % 60)).padStart(2, '0')
    this.hud.setStormTimer(`🌪️ Survived: ${this._disasterN}  ·  Next disaster ${mm}:${ss}  ·  build a fort (B)!`)
    if (this._disasterT <= 0) {
      const d = DISASTERS[Math.floor(Math.random() * DISASTERS.length)]
      this._disasterPending = { d, t: 4 }
      this.hud.showKillBanner(`${d.i} ${d.n.toUpperCase()} INCOMING!`)
      this.audio?.explosion?.()
    }
  }

  _runDisaster(d) {
    this.hud.showKillBanner(`${d.i} ${d.n.toUpperCase()}`)
    const p = d.p || {}
    switch (d.k) {
      case 'meteor': return this._disMeteor(p.count || 10, p.radius || 7, p.col || 0xff7a30)
      case 'quake': return this._disQuake(p.dur || 4, p.dmg || 12)
      case 'tornado': return this._disTornado(!!p.kill)
      case 'flood': return this._disFlood(p.h || 2.2)
      case 'lightning': return this._disLightning(p.strikes || 8)
      case 'fire': return this._disFire(p.col || 0xff5a00, p.dps || 14, !!p.mapwide)
      case 'wind': return this._disWind(p.force || 16, !!p.blind)
      case 'nova': return this._disNova(p.radius || 35)
      case 'freeze': return this._disFreeze(p.dur || 6)
      case 'asteroid': return this._disAsteroid()
      case 'flash': this._flashScreen(0.9); this._shake = Math.max(this._shake || 0, 0.4); return
      case 'apocalypse': this._disMeteor(20, 8, 0xff3000); this._disQuake(6, 16); this._disNova(50); return
    }
  }

  // Telegraphed ground blast that hurts the player.
  _disasterBlast(pos, radius, delay, col) {
    const game = this; let t = 0
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.9, 0.4, 6, 28), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, depthWrite: false }))
    ring.rotation.x = Math.PI / 2; ring.position.set(pos.x, 0.1, pos.z); this.world.scene.add(ring)
    this.grenades.push({
      dispose() { if (ring.parent) game.world.scene.remove(ring); ring.geometry.dispose(); ring.material.dispose() },
      update(dt) { t += dt; ring.material.opacity = 0.3 + 0.5 * Math.abs(Math.sin(t * 10)); if (t >= delay) { game.explodeAt(new THREE.Vector3(pos.x, 0.5, pos.z), { radius, damage: 120 }); this.dispose(); return true } return false },
    })
  }

  _disMeteor(count, radius, col) {
    const R = this.world.arenaRadius
    for (let i = 0; i < count; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * R * 0.95; this._disasterBlast(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), radius, 0.6 + Math.random() * 2, col) }
  }

  _disQuake(dur, dmg) {
    const game = this; let t = 0, tick = 0
    this.grenades.push({ update(dt) { t += dt; game._shake = Math.max(game._shake || 0, 0.6); tick -= dt; if (tick <= 0) { tick = 0.5; if (game.player.alive && game.player.position.y < 1.6) game.player.takeDamage(dmg * 0.5) } return t >= dur }, dispose() {} })
  }

  _disFlood(h) {
    const game = this; let t = 0, tick = 0; const dur = 8
    const span = game.world.arenaRadius * 2.2
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(span, span), new THREE.MeshStandardMaterial({ color: 0x2a6cff, transparent: true, opacity: 0.55, depthWrite: false }))
    plane.rotation.x = -Math.PI / 2; plane.position.y = 0.05; this.world.scene.add(plane)
    this.grenades.push({
      dispose() { if (plane.parent) game.world.scene.remove(plane); plane.geometry.dispose(); plane.material.dispose() },
      update(dt) { t += dt; const rise = Math.min(h, h * (t / 2)); plane.position.y = rise; tick -= dt; if (tick <= 0) { tick = 0.5; if (game.player.alive && game.player.position.y < rise + 0.2) game.player.takeDamage(10) } if (t >= dur) { this.dispose(); return true } return false },
    })
  }

  _disLightning(strikes) {
    const game = this; let n = 0, t = 0
    this.grenades.push({ update(dt) { t += dt; if (t >= 0.4) { t = 0; n++; const pp = game.player.position; const a = Math.random() * Math.PI * 2, r = Math.random() * 18; game._disasterBlast(new THREE.Vector3(pp.x + Math.cos(a) * r, 0, pp.z + Math.sin(a) * r), 6, 0.5, 0x9fe7ff) } return n >= strikes }, dispose() {} })
  }

  _disTornado(kill) {
    const game = this; let t = 0; const dur = 9
    const c = new THREE.Vector3((Math.random() - 0.5) * game.world.arenaRadius, 0, (Math.random() - 0.5) * game.world.arenaRadius)
    const grp = new THREE.Group()
    grp.add(new THREE.Mesh(new THREE.ConeGeometry(5, 16, 16, 1, true), new THREE.MeshBasicMaterial({ color: kill ? 0x110022 : 0x888899, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })))
    grp.children[0].position.y = 8; grp.position.copy(c); this.world.scene.add(grp)
    this.grenades.push({
      dispose() { if (grp.parent) game.world.scene.remove(grp); grp.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.() }) },
      update(dt) {
        t += dt; grp.rotation.y += dt * 6
        c.x += Math.sin(t * 0.7) * 8 * dt; c.z += Math.cos(t * 0.9) * 8 * dt; game.world.clampToArena(c); grp.position.set(c.x, 0, c.z)
        const pp = game.player.position, dx = c.x - pp.x, dz = c.z - pp.z, d = Math.hypot(dx, dz)
        if (d < 14 && game.player.alive) { const k = 1 - d / 14; pp.x += dx * k * 0.04; pp.z += dz * k * 0.04; if (d < 4) game.player.takeDamage(kill ? 50 : 18 * dt) }
        game.particles.emit({ x: c.x + (Math.random() - 0.5) * 8, y: Math.random() * 12, z: c.z + (Math.random() - 0.5) * 8 }, 3, { color: kill ? [0.3, 0.1, 0.4] : [0.6, 0.6, 0.7], speed: 4, spread: 3, size: 1.6, life: 0.5, up: 6 })
        return t >= dur
      },
    })
  }

  _disFire(col, dps, mapwide) {
    const game = this; let t = 0, tick = 0; const dur = 8
    const R = game.world.arenaRadius
    const zones = []
    const count = mapwide ? 1 : 6
    for (let i = 0; i < count; i++) zones.push(mapwide ? { x: 0, z: 0, r: R } : { x: (Math.random() - 0.5) * R * 1.6, z: (Math.random() - 0.5) * R * 1.6, r: 8 + Math.random() * 6 })
    this.grenades.push({
      dispose() {},
      update(dt) {
        t += dt; tick -= dt
        for (const z of zones) for (let k = 0; k < (mapwide ? 6 : 2); k++) game.particles.emit({ x: z.x + (Math.random() - 0.5) * z.r * 2, y: 0.4 + Math.random() * 1.5, z: z.z + (Math.random() - 0.5) * z.r * 2 }, 2, { color: game._rgb(col), speed: 2, spread: 1.5, size: 1.4, life: 0.5, up: 3 })
        if (tick <= 0) { tick = 0.5; const pp = game.player.position; for (const z of zones) { if (Math.hypot(pp.x - z.x, pp.z - z.z) < z.r) { if (game.player.alive) game.player.takeDamage(dps * 0.5); break } } }
        return t >= dur
      },
    })
  }

  _disWind(force, blind) {
    const game = this; let t = 0; const dur = 6
    const a = Math.random() * Math.PI * 2, dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
    if (blind) this._flashScreen(0.5)
    this.grenades.push({ update(dt) { t += dt; if (game.player.alive) { game.player.position.x += dir.x * force * dt; game.player.position.z += dir.z * force * dt; game.world.clampToArena(game.player.position) } game.particles.emit({ x: game.player.position.x - dir.x * 6, y: 1 + Math.random() * 2, z: game.player.position.z - dir.z * 6 }, 3, { color: [0.8, 0.78, 0.7], speed: force, spread: 2, size: 1.2, life: 0.4 }); return t >= dur }, dispose() {} })
  }

  _disNova(radius) {
    const game = this; let t = 0; const dur = 1.6, speed = radius / dur
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 1.0, 8, 48), new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.7, depthWrite: false }))
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.5; this.world.scene.add(ring)
    let hit = false
    this.grenades.push({
      dispose() { if (ring.parent) game.world.scene.remove(ring); ring.geometry.dispose(); ring.material.dispose() },
      update(dt) { t += dt; const rad = speed * t; ring.scale.set(rad, rad, rad); ring.material.opacity = Math.max(0, 0.7 * (1 - t / dur)); if (!hit && game.player.alive) { const pd = Math.hypot(game.player.position.x, game.player.position.z); if (Math.abs(pd - rad) < 4) { hit = true; game.player.takeDamage(45); game._shake = Math.max(game._shake || 0, 0.7) } } if (t >= dur) { this.dispose(); return true } return false },
    })
  }

  _disFreeze(dur) {
    const game = this; let t = 0, tick = 0
    this._flashScreen(0.25)
    this.grenades.push({ update(dt) { t += dt; tick -= dt; if (tick <= 0) { tick = 0.6; if (game.player.alive) game.player.takeDamage(6) } game.particles.emit({ x: game.player.position.x + (Math.random() - 0.5) * 4, y: 1 + Math.random() * 2, z: game.player.position.z + (Math.random() - 0.5) * 4 }, 2, { color: [0.7, 0.9, 1], speed: 1, spread: 1, size: 0.8, life: 0.6, up: 1 }); return t >= dur }, dispose() {} })
  }

  _disAsteroid() {
    const R = this.world.arenaRadius, a = Math.random() * Math.PI * 2, r = Math.random() * R * 0.6
    this._disasterBlast(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), 26, 2.5, 0xff3000)
    this._shake = Math.max(this._shake || 0, 1.2)
  }

  // Recovery supplies near the player after surviving a disaster.
  _dropRelief() {
    const p = this.player.position
    const near = (t, n) => { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 14; this.pickups.spawn(t, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r) } }
    near('health', 3); near('shield', 2); near('medkit', 1)
    const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 10
    this.pickups.spawnChest(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r)
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
