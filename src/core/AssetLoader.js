import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'

// Loads and caches GLTF/GLB models. The Toon Shooter Game Kit glTF files live in
// /public/models/{characters,guns,env}. Buffers are embedded (data URIs), so no
// companion .bin/texture files are needed.
//
// Returns a skeleton-safe clone each time (SkeletonUtils.clone) so multiple
// animated entities can share one loaded asset without corrupting skinning.
export class AssetLoader {
  constructor() {
    this.loader = new GLTFLoader()
    // Draco decoder (for the compressed city GLB). Decoder wasm from Google CDN.
    const draco = new DRACOLoader()
    draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/')
    this.loader.setDRACOLoader(draco)
    this.collada = new ColladaLoader()
    this.obj = new OBJLoader()
    this.fbx = new FBXLoader()
    this.cache = new Map() // path -> gltf
    this.daeCache = new Map() // path -> collada result
    this.meshCache = new Map() // path -> Object3D (obj/fbx)
  }

  // Load an OBJ or FBX model. Returns { scene, animations } (a fresh clone) to
  // match loadModel(), or null if missing. Detected by file extension.
  async loadMesh(path) {
    try {
      if (!this.meshCache.has(path)) {
        const loader = path.toLowerCase().endsWith('.fbx') ? this.fbx : this.obj
        const root = await loader.loadAsync(path)
        // FBX/OBJ files often embed lights & cameras — strip them so adding the
        // model to the scene doesn't flood it with extra lighting (washed colours).
        const junk = []
        root.traverse((o) => { if (o.isLight || o.isCamera) junk.push(o) })
        junk.forEach((o) => o.parent && o.parent.remove(o))
        this.meshCache.set(path, root)
      }
      const root = this.meshCache.get(path)
      return { scene: root.clone(true), animations: root.animations || [] }
    } catch (err) {
      console.warn(`[AssetLoader] Could not load mesh "${path}".`, err.message)
      return null
    }
  }

  // Load a COLLADA (.dae) model (e.g. the car pack). Returns a fresh clone of the
  // scene each call, or null if missing.
  async loadCollada(path) {
    try {
      if (!this.daeCache.has(path)) {
        this.daeCache.set(path, await this.collada.loadAsync(path))
      }
      return this.daeCache.get(path).scene.clone(true)
    } catch (err) {
      console.warn(`[AssetLoader] Could not load DAE "${path}".`, err.message)
      return null
    }
  }

  async load(path) {
    if (this.cache.has(path)) return this.cache.get(path)
    const gltf = await this.loader.loadAsync(path)
    this.cache.set(path, gltf)
    return gltf
  }

  // Load a model and return a ready-to-add clone of its scene plus its animation
  // clips. Returns null if the file is missing so the game can fall back to
  // placeholder geometry.
  async loadModel(path) {
    try {
      const gltf = await this.load(path)
      return {
        scene: cloneSkinned(gltf.scene),
        animations: gltf.animations || [],
      }
    } catch (err) {
      console.warn(`[AssetLoader] Could not load "${path}" — using placeholder.`, err.message)
      return null
    }
  }
}
