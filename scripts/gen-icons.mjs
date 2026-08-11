// Generates the FieldSynk app icons from the real brand logo (the 3D metallic "F").
// The logo ships on a near-white matte, so the icons use a white background — the
// gold + blue metals pop on white and the matte blends seamlessly. Run after
// changing the logo: node scripts/gen-icons.mjs   (needs the sharp devDependency)
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ASSETS = resolve(__dirname, '../assets')
mkdirSync(ASSETS, { recursive: true })

// The brand logo lives in the web repo; keep this the single source of truth.
const LOGO = resolve(__dirname, '../../FieldSynk Files/public/fieldsynk-logo.png')
const WHITE = '#ffffff'

const canvas = () => ({ create: { width: 1024, height: 1024, channels: 4, background: WHITE } })
const logoAt = (size) => sharp(LOGO).resize(size, size, { fit: 'inside' }).png().toBuffer()

async function make(file, logoSize, canvasSize = 1024) {
  const c = { create: { width: canvasSize, height: canvasSize, channels: 4, background: WHITE } }
  await sharp(c)
    .composite([{ input: await logoAt(logoSize), gravity: 'center' }])
    .flatten({ background: WHITE })
    .removeAlpha()
    .png()
    .toFile(resolve(ASSETS, file))
  console.log('wrote assets/' + file)
}

await make('icon.png', 860) // iOS/app icon — a little margin around the F
await make('adaptive-icon.png', 600) // Android foreground within the safe zone
await make('splash-icon.png', 560) // launch-screen mark
await make('favicon.png', 40, 48) // web
console.log('done')
