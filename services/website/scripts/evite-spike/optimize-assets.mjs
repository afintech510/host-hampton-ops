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

// Spec changelog B5 (P04): the background's small confetti square at about (93, 914) in the 1x canvas sits in
// the honoree row, so a wide name ("ALEXANDRIA-ROSE", "BIRTHDAY STAR") drew its first letter over it. Move it
// down to the gap between the name and the age line, (93, 1008), where no text ever lands.
//
// Working in the 2x source (2170x3059, 3 channels): in-paint the old spot with a patch from 130 px above
// (same dot texture, nothing else there), then add the square's own light (original minus in-painted, with a
// small noise floor) onto the background at the new spot. The yellow shard left of it (x < 145) is only in-painted.
async function backgroundWithMovedConfetti() {
  const { data, info } = await sharp(bg).raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  const out = Buffer.from(data)
  const A = { x0: 105, y0: 1785, x1: 245, y1: 1875 } // region around the square and the shard
  const SQ_X0 = 145 // the square itself starts right of the shard
  const PATCH_DY = -130
  const MOVE_DY = 188 // 94 px in the 1x canvas
  const FEATHER = 14
  const at = (buf, x, y, c) => buf[(y * W + x) * C + c]
  const put = (x, y, c, v) => { out[(y * W + x) * C + c] = Math.max(0, Math.min(255, Math.round(v))) }
  const delta = new Map()
  for (let y = A.y0; y < A.y1; y++) {
    for (let x = A.x0; x < A.x1; x++) {
      const edge = Math.min(x - A.x0, A.x1 - 1 - x, y - A.y0, A.y1 - 1 - y)
      const w = Math.min(1, (edge + 1) / FEATHER)
      for (let c = 0; c < C; c++) {
        const orig = at(data, x, y, c)
        const patch = at(data, x, y + PATCH_DY, c)
        const filled = orig * (1 - w) + patch * w
        if (x >= SQ_X0) delta.set((y * W + x) * C + c, Math.max(0, orig - filled - 4))
        put(x, y, c, filled)
      }
    }
  }
  for (const [idx, d] of delta) {
    if (d <= 0) continue
    const c = idx % C
    const px = Math.floor(idx / C)
    const x = px % W
    const y = Math.floor(px / W) + MOVE_DY
    put(x, y, c, at(out, x, y, c) + d)
  }
  return sharp(out, { raw: { width: W, height: H, channels: C } })
}

const resized = async () => (await backgroundWithMovedConfetti()).resize(1085, 1530, { fit: 'fill' })
await (await resized()).jpeg({ quality: 85, mozjpeg: true }).toFile(path.join(dst, 'background.jpg'))
await (await resized()).webp({ quality: 80 }).toFile(path.join(dst, 'background.webp'))
for (const [from, to] of [['icon-strip.png', 'icon-strip.png'], ['squiggle.png', 'squiggle.png'], ['icons/star.png', 'star.png']]) {
  await sharp(path.join(src, from)).png({ compressionLevel: 9, effort: 10 }).toFile(path.join(dst, to))
}
for (const f of fs.readdirSync(dst)) {
  const m = await sharp(path.join(dst, f)).metadata()
  console.log(f.padEnd(16), String(fs.statSync(path.join(dst, f)).size).padStart(8), `${m.width}x${m.height}`)
}
