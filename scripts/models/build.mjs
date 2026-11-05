// Builds the factory models: Blender writes them from build_models.py, then gltfpack
// compresses them with meshopt into public/models, which three.js decodes itself.
//
//   npm run models
//
// Set BLENDER to the Blender executable when it is not at the macOS default.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const blender = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender'
const out = join(root, 'public', 'models')
const raw = mkdtempSync(join(tmpdir(), 'sakiyomi-models-'))

try {
  execFileSync(blender, ['--background', '--factory-startup', '--python', join(root, 'scripts', 'models', 'build_models.py'), '--', raw], {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  for (const file of readdirSync(raw).filter((name) => name.endsWith('.glb'))) {
    // -cc: meshopt with the higher ratio. -km keeps material names, as the app finds each lamp by
    // its material; -kn keeps named nodes, as it moves the parts under move_<role> while a machine runs.
    execFileSync('npx', ['gltfpack', '-i', join(raw, file), '-o', join(out, file), '-cc', '-km', '-kn'], { cwd: root, stdio: 'ignore' })
    console.log(`public/models/${file}`)
  }
} finally {
  rmSync(raw, { recursive: true, force: true })
}
