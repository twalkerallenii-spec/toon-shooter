# Models

Drop your **Toon Shooter Game Kit** models here as `.glb` or `.gltf` files.

The game auto-loads these filenames if present (falls back to placeholder shapes otherwise):

| Filename            | Used for           |
|---------------------|--------------------|
| `player.glb`        | The player character |
| `enemy.glb`         | Enemy characters (wire up in `Spawner`/`Enemy`) |

## How to convert the kit assets

The kit is shared as FBX/OBJ in Google Drive. Convert to glTF for the web:

1. Import the model into **Blender**.
2. `File → Export → glTF 2.0 (.glb)`.
3. Save as `player.glb` (or `enemy.glb`) into this folder.

Tip: keep models small (< a few MB). Use **Draco** compression in the Blender
exporter for large meshes — Three.js's GLTFLoader supports it.
