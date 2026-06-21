import Anthropic from '@anthropic-ai/sdk'

const MODEL = 'claude-opus-4-8'

const SYSTEM = `You are the in-game AI assistant for "Vertex", a Fortnite-style browser FPS built with Three.js (Vite, deployed on GitHub Pages, multiplayer via a Render WebSocket relay).

You help the player understand the game, debug problems, and you can directly CONTROL the running game through tools. You're running live inside the player's browser tab.

Capabilities via tools:
- get_state: read the current game state (mode, hp, weapons, coins, settings, bots, etc.) — call this first when diagnosing.
- start_match, set_setting, give_weapon, give_all_weapons, set_health, set_shield, god_mode, spawn_bots, add_coins, unlock_skin, set_skin, announce.
- eval_js: run arbitrary JavaScript in the live game for anything the other tools don't cover (inspecting/fixing state at runtime). The global \`game\` is the Game instance; \`THREE\` is available. Use it to investigate bugs and apply live fixes. Return a value to see it.

Be concise and action-oriented. When the player asks you to change something, just do it with a tool and confirm in one short line. When they report a bug, use get_state / eval_js to investigate, explain the likely cause briefly, and fix it live if you can. Modes: coop, br, dm, team, ctf, hns, ffa, gungame, oitc, jugg, infect, koth.`

const TOOLS = [
  { name: 'get_state', description: 'Read current game state (mode, player hp/shield, owned weapons, coins, settings, bot count, online status).', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'start_match', description: 'Start/drop into a match for the given mode.', input_schema: { type: 'object', properties: { mode: { type: 'string', description: 'coop|br|dm|team|ctf|hns|ffa|gungame|oitc|jugg|infect|koth' } }, required: ['mode'], additionalProperties: false } },
  { name: 'set_setting', description: 'Change a game setting.', input_schema: { type: 'object', properties: { key: { type: 'string', enum: ['sens', 'invertY', 'thirdPerson', 'fov', 'volume', 'shadows'] }, value: { type: ['number', 'boolean'] } }, required: ['key', 'value'], additionalProperties: false } },
  { name: 'give_weapon', description: 'Give the player a weapon by key (e.g. Sniper, RPG, Minigun, AK, Shotgun, Knife) and equip it.', input_schema: { type: 'object', properties: { weapon: { type: 'string' } }, required: ['weapon'], additionalProperties: false } },
  { name: 'give_all_weapons', description: 'Give the player every weapon.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'set_health', description: 'Set the player\'s current HP.', input_schema: { type: 'object', properties: { hp: { type: 'number' } }, required: ['hp'], additionalProperties: false } },
  { name: 'set_shield', description: 'Set the player\'s shield (0-100).', input_schema: { type: 'object', properties: { shield: { type: 'number' } }, required: ['shield'], additionalProperties: false } },
  { name: 'god_mode', description: 'Toggle invulnerability for the player.', input_schema: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'], additionalProperties: false } },
  { name: 'spawn_bots', description: 'Spawn CPU bots into the current match.', input_schema: { type: 'object', properties: { count: { type: 'number' }, role: { type: 'string', enum: ['fighter', 'hider', 'zombie'] } }, required: ['count'], additionalProperties: false } },
  { name: 'add_coins', description: 'Add (or subtract) lobby coins.', input_schema: { type: 'object', properties: { amount: { type: 'number' } }, required: ['amount'], additionalProperties: false } },
  { name: 'unlock_skin', description: 'Unlock a Locker skin id for free (e.g. Soldier_Gold, Alien_Void).', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { name: 'set_skin', description: 'Equip a character/skin id.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { name: 'announce', description: 'Show a message in the in-game feed.', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } },
  { name: 'eval_js', description: 'Run JavaScript in the live game (global `game` = Game instance, `THREE` available). Returns the result. Use for inspection and live fixes beyond the other tools.', input_schema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'], additionalProperties: false } },
]

// Conversational agent with a manual tool-use loop. Uses the player's own
// Anthropic API key (stored locally) — never a shared/hardcoded key.
export class Assistant {
  constructor(api) {
    this.api = api // { exec(name, input): Promise<any|string> }
    this.messages = []
    this.client = null
    this._key = null
    this.busy = false
  }

  hasKey() { return !!localStorage.getItem('ts_anthropic_key') }

  _client() {
    const key = (localStorage.getItem('ts_anthropic_key') || '').trim()
    if (!key) return null
    if (!this.client || this._key !== key) {
      this.client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true })
      this._key = key
    }
    return this.client
  }

  // onText(str) renders an assistant line; onTool(label) shows a tool action.
  async send(text, onText, onTool) {
    const client = this._client()
    if (!client) { onText('⚠️ Add your Anthropic API key first (the field below). It stays in your browser.'); return }
    if (this.busy) { onText('…still working on the previous request.'); return }
    this.busy = true
    this.messages.push({ role: 'user', content: text })
    try {
      for (let step = 0; step < 8; step++) {
        const res = await client.messages.create({ model: MODEL, max_tokens: 4096, system: SYSTEM, tools: TOOLS, messages: this.messages })
        this.messages.push({ role: 'assistant', content: res.content })
        for (const b of res.content) if (b.type === 'text' && b.text.trim()) onText(b.text.trim())
        if (res.stop_reason !== 'tool_use') break
        const results = []
        for (const b of res.content) {
          if (b.type !== 'tool_use') continue
          onTool?.(b.name)
          let out
          try { out = await this.api.exec(b.name, b.input || {}) }
          catch (e) { out = 'Error: ' + (e?.message || e) }
          results.push({ type: 'tool_result', tool_use_id: b.id, content: typeof out === 'string' ? out : JSON.stringify(out) })
        }
        this.messages.push({ role: 'user', content: results })
      }
    } catch (e) {
      const msg = e?.error?.error?.message || e?.message || String(e)
      onText('⚠️ ' + msg + (/auth|api_key|401/i.test(msg) ? ' (check your API key)' : ''))
    } finally {
      this.busy = false
    }
  }
}
