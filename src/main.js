import './style.css'
import { Game } from './core/Game.js'

const canvas = document.getElementById('game')
const game = new Game(canvas)

// Expose for quick debugging in the console.
window.__game = game
