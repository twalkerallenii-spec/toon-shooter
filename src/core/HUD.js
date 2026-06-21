// Thin wrapper around the DOM HUD elements declared in index.html.
export class HUD {
  constructor() {
    this.el = {
      hud: document.getElementById('hud'),
      crosshair: document.getElementById('crosshair'),
      hpFill: document.getElementById('hp-fill'),
      shFill: document.getElementById('sh-fill'),
      hurt: document.getElementById('hurt-vignette'),
      killstreak: document.getElementById('killstreak'),
      dmgLayer: document.getElementById('dmg-layer'),
      compassStrip: document.getElementById('compass-strip'),
      score: document.getElementById('score'),
      wave: document.getElementById('wave'),
      ammo: document.getElementById('ammo'),
      ammoMax: document.getElementById('ammo-max'),
      reloadHint: document.getElementById('reload-hint'),
      weaponName: document.getElementById('weapon-name'),
      weaponList: document.getElementById('weapon-list'),
      killfeed: document.getElementById('killfeed'),
      stormWarning: document.getElementById('storm-warning'),
      stormTimer: document.getElementById('storm-timer'),
      carPrompt: document.getElementById('car-prompt'),
      teamScores: document.getElementById('team-scores'),
      tsRed: document.getElementById('ts-red'),
      tsBlue: document.getElementById('ts-blue'),
      tsMsg: document.getElementById('ts-msg'),
      voteToggle: document.getElementById('vote-toggle'),
      votePanel: document.getElementById('vote-panel'),
      adsVignette: document.getElementById('ads-vignette'),
      scoreboard: document.getElementById('scoreboard'),
      sbBody: document.getElementById('sb-body'),
      victory: document.getElementById('victory'),
      vicTitle: document.getElementById('vic-title'),
      vicSub: document.getElementById('vic-sub'),
      overlay: document.getElementById('overlay'),
      overlayMsg: document.getElementById('overlay-msg'),
      startBtn: document.getElementById('start-btn'),
      cardMode: document.getElementById('card-mode'),
      loading: document.getElementById('loading'),
      loadFill: document.getElementById('load-fill'),
      loadStatus: document.getElementById('load-status'),
      pausebox: document.getElementById('pausebox'),
      pauseTitle: document.getElementById('pause-title'),
      pauseMsg: document.getElementById('pause-msg'),
      pauseResume: document.getElementById('pause-resume'),
    }
    this._buildCompass()
  }

  _buildCompass() {
    if (!this.el.compassStrip) return
    const dirs = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE']
    let html = ''
    // Repeat across -360..720 deg so it never runs out while panning (2px/deg).
    for (let deg = -360; deg <= 720; deg += 45) {
      const label = dirs[((deg / 45) % 8 + 8) % 8]
      html += `<span style="position:absolute;left:${deg * 2}px">${label}</span>`
    }
    this.el.compassStrip.innerHTML = html
  }

  show() { this.el.hud.classList.remove('hidden') }
  hide() { this.el.hud.classList.add('hidden') }

  setHp(hp, maxHp) {
    const k = Math.max(0, hp / maxHp)
    this.el.hpFill.style.width = `${k * 100}%`
    this.el.hpFill.style.background = k < 0.3 ? 'var(--hp-low)' : 'var(--hp)'
  }

  setShield(sh) { this.el.shFill.style.width = `${Math.max(0, Math.min(100, sh))}%` }
  setHurt(v) { this.el.hurt.style.opacity = Math.max(0, Math.min(1, v)) }
  setCrosshairEnemy(on) { this.el.crosshair.classList.toggle('enemy', !!on) }

  killStreak(n) {
    const names = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'MULTI KILL', 5: 'RAMPAGE', 6: 'UNSTOPPABLE', 7: 'GODLIKE' }
    this.el.killstreak.textContent = names[Math.min(n, 7)] || 'GODLIKE'
    this.el.killstreak.classList.remove('hidden')
    void this.el.killstreak.offsetWidth
    this.el.killstreak.classList.add('pop')
    clearTimeout(this._ksT)
    this._ksT = setTimeout(() => { this.el.killstreak.classList.add('hidden'); this.el.killstreak.classList.remove('pop') }, 1300)
  }

  damageNumber(x, y, amount, head) {
    const d = document.createElement('div')
    d.className = 'dmg-num' + (head ? ' head' : '')
    d.textContent = head ? `${amount}!` : `${amount}`
    d.style.left = `${x}px`; d.style.top = `${y}px`
    this.el.dmgLayer.appendChild(d)
    setTimeout(() => d.remove(), 800)
  }

  setCompass(yaw) {
    // yaw 0 faces +Z (south). Shift the strip so the heading sits centered.
    const deg = (yaw * 180 / Math.PI)
    this.el.compassStrip.style.transform = `translateX(${-deg * 2}px)`
  }

  setScore(v) { this.el.score.textContent = v }
  setWave(v) { this.el.wave.textContent = v }

  setAmmo(ammo, max) {
    this.el.ammo.textContent = ammo
    this.el.ammoMax.textContent = max
    this.el.ammo.style.color = ammo <= Math.ceil(max * 0.25) ? '#ff5a5a' : '#fff' // low-ammo warning
  }

  setReloading(on) {
    this.el.reloadHint.classList.toggle('hidden', !on)
  }

  // Build the Fortnite-style weapon hotbar once from the roster.
  initWeapons(defs) {
    this.el.weaponList.innerHTML = defs
      .map((d, i) => `<div class="wpn rar-${d.rarity || 'common'}" data-i="${i}">
        <span class="wpn-slot">${i + 1}</span>
        <span class="wpn-ico">${d.ico || '🔫'}</span>
        <span class="wpn-key">${d.key}</span>
      </div>`)
      .join('')
    this._wpnEls = [...this.el.weaponList.querySelectorAll('.wpn')]
  }

  // Mark which slots are owned (picked up) vs locked.
  setOwned(owned) {
    if (!this._wpnEls) return
    this._wpnEls.forEach((el, i) => el.classList.toggle('locked', !owned.has(i)))
  }

  // Green full-screen tint while the player is a zombie (Infection).
  setZombie(on) {
    document.getElementById('zombie-tint')?.classList.toggle('on', !!on)
  }

  setWeapon(def, index) {
    this.el.weaponName.textContent = def.label || def.key
    if (this._wpnEls) {
      this._wpnEls.forEach((el, i) => el.classList.toggle('active', i === index))
      // Keep the active slot scrolled into view (the bar can be wider than screen).
      this._wpnEls[index]?.scrollIntoView?.({ inline: 'center', block: 'nearest' })
    }
  }

  setAds(on) {
    this.el.adsVignette.classList.toggle('on', on)
  }

  // Add a kill-feed line; auto-expires after a few seconds.
  addKillFeed(text) {
    const el = document.createElement('div')
    el.className = 'kf'
    el.textContent = text
    this.el.killfeed.appendChild(el)
    setTimeout(() => el.remove(), 4500)
    while (this.el.killfeed.childElementCount > 5) this.el.killfeed.firstChild.remove()
  }

  clearKillFeed() { this.el.killfeed.innerHTML = '' }

  setStorm(on) { this.el.stormWarning.classList.toggle('hidden', !on) }
  setStormTimer(text) {
    if (!text) { this.el.stormTimer.classList.add('hidden'); return }
    this.el.stormTimer.textContent = text
    this.el.stormTimer.classList.remove('hidden')
  }
  setCarPrompt(text) {
    if (!text) { this.el.carPrompt.classList.add('hidden'); return }
    this.el.carPrompt.textContent = text
    this.el.carPrompt.classList.remove('hidden')
  }

  setTeamScores(red, blue, show) {
    this.el.teamScores.classList.toggle('hidden', !show)
    if (show) { this.el.tsRed.textContent = red; this.el.tsBlue.textContent = blue }
  }
  setObjective(text) { this.el.tsMsg.textContent = text || '' }

  // Scoreboard: rows = [{ name, kills, deaths, team, you }] (already sorted).
  showScoreboard(rows) {
    this.el.sbBody.innerHTML = rows.map((r, i) => {
      const tc = r.team === 'red' ? 't-red' : r.team === 'blue' ? 't-blue' : ''
      return `<tr class="${r.you ? 'you' : ''}"><td>${i + 1}</td><td class="${tc}">${escapeHtml(r.name)}${r.you ? ' (you)' : ''}</td><td>${r.kills}</td><td>${r.deaths}</td></tr>`
    }).join('')
    this.el.scoreboard.classList.remove('hidden')
  }
  hideScoreboard() { this.el.scoreboard.classList.add('hidden') }

  // Victory / defeat screen. win=true -> gold, false -> red.
  showVictory(title, sub, win = true) {
    this.el.vicTitle.textContent = title
    this.el.vicSub.textContent = sub || ''
    this.el.victory.classList.toggle('defeat', !win)
    this.el.victory.classList.remove('hidden')
  }
  hideVictory() { this.el.victory.classList.add('hidden') }

  showVoteToggle(on) {
    this.el.voteToggle.classList.toggle('hidden', !on)
    if (!on) this.el.votePanel.classList.add('hidden')
  }
  toggleVotePanel() { this.el.votePanel.classList.toggle('hidden') }
  hideVotePanel() { this.el.votePanel.classList.add('hidden') }
  setVotes(tally) {
    for (const m of Object.keys(tally)) {
      const el = this.el.votePanel.querySelector(`[data-c="${m}"]`)
      if (el) el.textContent = tally[m]
    }
  }

  // Dynamic reticle bloom: 0 = tight, larger = wider gap. Smoothed toward target.
  setCrosshairSpread(extra) {
    const base = 7
    this._spread = (this._spread ?? base)
    const target = base + Math.max(0, extra)
    this._spread += (target - this._spread) * 0.35 // ease toward target
    this.el.crosshair.style.setProperty('--gap', `${this._spread.toFixed(1)}px`)
  }

  // Flash the X hitmarker. isKill makes it red + a touch longer.
  hitMarker(isKill) {
    const ch = this.el.crosshair
    const cls = isKill ? 'kill' : 'hit'
    ch.classList.remove('hit', 'kill')
    // Force reflow so the animation restarts even on rapid consecutive hits.
    void ch.offsetWidth
    ch.classList.add(cls)
  }

  showOverlay(msg, buttonLabel = 'PLAY') {
    this.el.overlayMsg.textContent = msg
    this.el.startBtn.textContent = buttonLabel
    this.el.overlay.classList.remove('hidden')
  }

  hideOverlay() {
    this.el.overlay.classList.add('hidden')
  }

  setLobbyMode(label, sub) {
    if (this.el.cardMode) this.el.cardMode.textContent = label
    if (sub) this.el.overlayMsg.textContent = sub
  }

  // ---- Loading screen ----
  showLoading() {
    this.el.loading.classList.remove('hidden', 'ready')
    this.el.loadFill.style.width = '0%'
    this.el.loadStatus.textContent = 'SEARCHING FOR WORLD…'
  }
  setLoading(text, pct) {
    if (text) this.el.loadStatus.textContent = text
    if (pct != null) this.el.loadFill.style.width = `${pct}%`
  }
  loadingReady() {
    this.el.loading.classList.add('ready')
    this.el.loadFill.style.width = '100%'
    this.el.loadStatus.textContent = 'WORLD FOUND AND LOADED'
  }
  hideLoading() { this.el.loading.classList.add('hidden') }

  showPause(title, msg, btn = 'RESUME') {
    this.el.pauseTitle.textContent = title
    this.el.pauseMsg.textContent = msg || ''
    this.el.pauseResume.textContent = btn
    this.el.pausebox.classList.remove('hidden')
  }
  hidePause() { this.el.pausebox.classList.add('hidden') }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}
