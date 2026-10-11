// Measures the visible ink bands (kicker / GLOW / PARTY) of a rendered Glow invite.
// usage: node scripts/evite-spike/measure-glow-gaps.mjs <image.jpg>
import sharp from 'sharp'
const { data, info } = await sharp(process.argv[2]).raw().toBuffer({ resolveWithObject: true })
const { width: W, height: H, channels: C } = info
const TH = 200 // bright core of the strokes; halos are far dimmer
const rows = []
for (let y = 0; y < 760; y++) {
  let n = 0
  for (let x = 180; x < 905; x++) { // skips the squiggles at the edges
    const i = (y * W + x) * C
    if (Math.max(data[i], data[i + 1], data[i + 2]) > TH) n++
  }
  rows.push(n)
}
const bands = []
let start = -1
for (let y = 0; y < rows.length; y++) {
  const on = y >= 100 && rows[y] >= 3
  if (on && start < 0) start = y
  if (!on && start >= 0) { if (y - start > 3) bands.push([start, y - 1]); start = -1 }
}
// merge bands separated by <6px (inner gaps of the outline letters)
const merged = []
for (const b of bands) {
  const last = merged[merged.length - 1]
  if (last && b[0] - last[1] < 8) last[1] = b[1]; else merged.push([...b])
}
console.log('bands', JSON.stringify(merged))
const [kick, glow, party] = merged
if (kick && glow && party) {
  console.log(`kicker ${kick} GLOW ${glow} PARTY ${party}`)
  console.log(`gap above GLOW ${glow[0] - kick[1] - 1}  gap below GLOW ${party[0] - glow[1] - 1}`)
}
