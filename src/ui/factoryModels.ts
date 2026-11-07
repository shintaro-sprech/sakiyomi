import { useGLTF } from '@react-three/drei'

// Models made by scripts/models/build.mjs, compressed with meshopt, which three.js decodes
// itself; no Draco decoder is fetched.
// The models the floor uses besides its machines'.
export const FLOOR_MODELS = ['pallet', 'material_rack', 'rack_stock', 'carton_stock', 'forklift']

export const modelUrl = (name: string) => `/models/${name}.glb`

export function preloadModels(models: string[]) {
  for (const name of models) useGLTF.preload(modelUrl(name), false)
}
