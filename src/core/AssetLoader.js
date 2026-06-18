import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// Loads and caches GLTF/GLB models. Drop your Toon Shooter Game Kit models into
// /public/models/ and reference them by path (e.g. 'models/Character.glb').
//
// Returns a fresh clone each time so multiple entities can share one loaded model.
export class AssetLoader {
  constructor() {
    this.loader = new GLTFLoader()
    this.cache = new Map() // path -> gltf
  }

  async load(path) {
    if (this.cache.has(path)) return this.cache.get(path)
    const gltf = await this.loader.loadAsync(path)
    this.cache.set(path, gltf)
    return gltf
  }

  // Load a model and return a ready-to-add clone of its scene plus its animations.
  // Falls back gracefully (returns null) if the file is missing, so the game can
  // run with placeholder geometry until real assets are added.
  async loadModel(path) {
    try {
      const gltf = await this.load(path)
      return {
        scene: gltf.scene.clone(true),
        animations: gltf.animations || [],
      }
    } catch (err) {
      console.warn(`[AssetLoader] Could not load "${path}" — using placeholder.`, err.message)
      return null
    }
  }
}
