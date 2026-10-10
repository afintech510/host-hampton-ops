// Dev helper: side-by-side (mock | mine | amplified abs-diff). node compare.mjs <mock> <mine> <out.jpg>
import sharp from 'sharp'
const [mock, mine, out] = process.argv.slice(2)
const a = await sharp(mock).removeAlpha().raw().toBuffer({ resolveWithObject: true })
const { width, height } = a.info
const b = await sharp(mine).resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer()
const d = Buffer.alloc(a.data.length)
let sum = 0
for (let i = 0; i < d.length; i++) { const x = Math.abs(a.data[i] - b[i]); sum += x; d[i] = Math.min(255, x * 3) }
console.log('mean abs diff per channel:', (sum / d.length).toFixed(2))
const raw = (buf) => sharp(buf, { raw: { width, height, channels: 3 } }).jpeg({ quality: 88 }).toBuffer()
const panels = [await raw(a.data), await raw(b), await raw(d)]
await sharp({ create: { width: width * 3, height, channels: 3, background: '#000' } })
  .composite(panels.map((input, i) => ({ input, left: i * width, top: 0 }))).jpeg({ quality: 85 }).toFile(out)
