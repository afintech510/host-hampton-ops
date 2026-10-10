// One-off: optimise the handoff Glow assets into public/evites/glow/. Run from services/website:
//   node scripts/evite-spike/optimize-assets.mjs
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = path.resolve(here, '../../../../docs/specs/evites/handoff/assets/glow')
const dst = path.resolve(here, '../../public/evites/glow')
fs.mkdirSync(dst, { recursive: true })

const bg = path.join(src, 'background-plain.png')
const resized = () => sharp(bg).resize(1085, 1530, { fit: 'fill' })
await resized().jpeg({ quality: 85, mozjpeg: true }).toFile(path.join(dst, 'background.jpg'))
await resized().webp({ quality: 80 }).toFile(path.join(dst, 'background.webp'))
for (const [from, to] of [['icon-strip.png', 'icon-strip.png'], ['squiggle.png', 'squiggle.png'], ['icons/star.png', 'star.png']]) {
  await sharp(path.join(src, from)).png({ compressionLevel: 9, effort: 10 }).toFile(path.join(dst, to))
}
for (const f of fs.readdirSync(dst)) {
  const m = await sharp(path.join(dst, f)).metadata()
  console.log(f.padEnd(16), String(fs.statSync(path.join(dst, f)).size).padStart(8), `${m.width}x${m.height}`)
}
