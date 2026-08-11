// Generates the placeholder FieldSynk app icons — a bold white "F" monogram on
// FieldSynk blue. Pure shapes (no fonts) so it renders crisp at every size.
// Run: node scripts/gen-icons.mjs   (needs the sharp devDependency)
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ASSETS = resolve(__dirname, '../assets')
mkdirSync(ASSETS, { recursive: true })

const BLUE = '#2563eb'

// The "F", built from three rounded rectangles on a 1024 canvas.
const F = `
  <rect x="378" y="300" width="118" height="430" rx="20"/>
  <rect x="378" y="300" width="300" height="118" rx="20"/>
  <rect x="378" y="476" width="230" height="106" rx="20"/>
`

const onBlue = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><rect width="1024" height="1024" fill="${BLUE}"/><g fill="#ffffff">${F}</g></svg>`
const onClear = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><g fill="#ffffff">${F}</g></svg>`

async function write(svg, file, size) {
  let img = sharp(Buffer.from(svg))
  if (size) img = img.resize(size, size)
  await img.png().toFile(resolve(ASSETS, file))
  console.log('wrote assets/' + file)
}

await write(onBlue, 'icon.png') // iOS/app icon — opaque, full bleed
await write(onClear, 'adaptive-icon.png') // Android adaptive foreground (bg color in app.json)
await write(onClear, 'splash-icon.png') // splash mark (bg color in app.json)
await write(onBlue, 'favicon.png', 48) // web favicon
console.log('done')
