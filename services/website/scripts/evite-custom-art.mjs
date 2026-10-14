/**
 * Make a host's OWN finished invitation the picture for their party (migration 073).
 *
 *   node --env-file=services/website/.env.local services/website/scripts/evite-custom-art.mjs \
 *        <booking_ref> <image file> [--dry-run]
 *   node --env-file=... services/website/scripts/evite-custom-art.mjs <booking_ref> --clear
 *
 * What it does, and nothing more:
 *   1. finds the party's `evites` row (it must already have an `image_key`, i.e. have rendered once);
 *   2. fits the image to the 1085x1530 canvas WITHOUT cropping it: the whole picture, centred, with
 *      a blurred, enlarged copy of itself filling the strips either side (a host's invitation has text
 *      to the edges; cropping would cut it);
 *   3. uploads it to Storage `evites/<image_key>/custom-<random>.jpg` - beside the party's rendered
 *      invitation, never in `public/` (this repository is public and the art is a real child);
 *   4. sets `evites.custom_art` to that name.
 *
 * It SENDS NOTHING and does not render. Press "Re-render" on the admin Invitation card (or wait for
 * the evite-sends cron, which re-renders stale invitations two per tick) to draw it. `--dry-run`
 * writes the fitted picture to `<image file>.fitted.jpg` and touches nothing else.
 *
 * Text ON the picture is the host's, so set the evite's host contact (name / phone) to match what
 * it says: the page around the picture prints "Any questions? Ask <name>" from those columns.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_KEY. Lives under services/website/ for `sharp`.
 */

import { randomBytes } from 'crypto'
import fs from 'fs'
import sharp from 'sharp'

const W = 1085
const H = 1530
const IMAGE_KEY = /^[0-9a-f]{32}$/

const args = process.argv.slice(2)
const ref = args[0]
const clear = args.includes('--clear')
const dryRun = args.includes('--dry-run')
const file = args.find((a, i) => i > 0 && !a.startsWith('--'))

if (!ref || (!clear && !file)) {
  console.error('usage: evite-custom-art.mjs <booking_ref> <image file> [--dry-run] | <booking_ref> --clear')
  process.exit(2)
}

/** The whole picture, never cropped: contain-fit over a blurred cover-fit of itself. */
async function fit(path) {
  const meta = await sharp(path).metadata()
  const scale = Math.min(W / meta.width, H / meta.height)
  const fw = Math.round(meta.width * scale)
  const fh = Math.round(meta.height * scale)
  const fg = await sharp(path).resize(fw, fh, { kernel: 'lanczos3' }).toBuffer()
  const bg = await sharp(path).resize(W, H, { fit: 'cover' }).blur(18).modulate({ brightness: 1.04 }).toBuffer()
  return sharp(bg)
    .composite([{ input: fg, left: Math.round((W - fw) / 2), top: Math.round((H - fh) / 2) }])
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()
}

if (dryRun) {
  const out = `${file}.fitted.jpg`
  fs.writeFileSync(out, await fit(file))
  console.log(`dry run: wrote ${out}; nothing uploaded, nothing written`)
  process.exit(0)
}

const url = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '')
const key = process.env.SUPABASE_SERVICE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required')
  process.exit(2)
}
const auth = { apikey: key, Authorization: `Bearer ${key}` }

async function rest(path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...auth, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
  const body = await res.text()
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]}: ${res.status} ${body}`)
  return body ? JSON.parse(body) : null
}

const bookings = await rest(`bookings?select=id,booking_ref&booking_ref=eq.${encodeURIComponent(ref)}`)
if (bookings.length !== 1) throw new Error(`booking ${ref}: found ${bookings.length}`)
const evites = await rest(`evites?select=id,slug,image_key,custom_art&booking_id=eq.${bookings[0].id}`)
if (evites.length !== 1) throw new Error(`evite for ${ref}: found ${evites.length}`)
const ev = evites[0]

if (clear) {
  await rest(`evites?id=eq.${ev.id}`, { method: 'PATCH', body: JSON.stringify({ custom_art: null }), headers: { Prefer: 'return=minimal' } })
  console.log(`${ref}: custom_art cleared (was ${ev.custom_art ?? 'null'}); the object stays in Storage. Re-render to draw the template again.`)
  process.exit(0)
}

if (!IMAGE_KEY.test(ev.image_key ?? '')) throw new Error(`${ref}: the evite has no image_key yet - let it render once first`)

const name = `custom-${randomBytes(4).toString('hex')}.jpg`
const jpeg = await fit(file)
const up = await fetch(`${url}/storage/v1/object/evites/${ev.image_key}/${name}`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=31536000', 'x-upsert': 'false' },
  body: jpeg,
})
if (!up.ok) throw new Error(`upload: ${up.status} ${await up.text()}`)

await rest(`evites?id=eq.${ev.id}`, { method: 'PATCH', body: JSON.stringify({ custom_art: name }), headers: { Prefer: 'return=minimal' } })
console.log(`${ref} (/i/${ev.slug}): custom_art = ${name} (${jpeg.length} bytes); previous = ${ev.custom_art ?? 'none'}`)
console.log('Nothing was sent or rendered. Re-render from the admin Invitation card to draw it.')
