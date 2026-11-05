import { useGLTF } from '@react-three/drei'

// Models made by scripts/models/build.mjs, compressed with meshopt, which three.js decodes
// itself; no Draco decoder is fetched.
export const modelUrl = (name: string) => `/models/${name}.glb`

export function preloadModels(models: string[]) {
  for (const name of models) useGLTF.preload(modelUrl(name), false)
}
