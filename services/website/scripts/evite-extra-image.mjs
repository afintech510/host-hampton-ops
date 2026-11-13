/**
 * Add one extra picture to a party's invitation PAGE (migration 101, `evites.extra_images`).
 *
 *   node --env-file=services/website/.env.local services/website/scripts/evite-extra-image.mjs \
 *        <booking_ref> <image file> [alt text]
 *
 * What it does, and nothing more:
 *   1. finds the party's `evites` row (it must already have an `image_key`, i.e. have rendered once, and
 *      hold fewer than four extra pictures);
 *   2. auto-orients the image and resizes it to at most 1200 px wide, never cropped, flattened on white,
 *      JPEG quality 86 (the same processing as the host's upload);
 *   3. uploads it to Storage `evites/<image_key>/extra-<16 hex>.jpg`, beside the party's invitation
 *      (never `public/`: this repository is public);
 *   4. appends { object, alt } to `evites.extra_images`.
 *
 * It SENDS NOTHING and does not render: the picture shows on /i/<slug> above the RSVP form at once.
 * Needs SUPABASE_URL and SUPABASE_SERVICE_KEY. Lives under services/website/ for `sharp`.
 */

import { randomBytes } from 'crypto'
import fs from 'fs'
import sharp from 'sharp'

const IMAGE_KEY = /^[0-9a-f]{32}$/
const MAX = 4
const [ref, file, ...altWords] = process.argv.slice(2)
const alt = altWords.join(' ').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)

if (!ref || !file) {
  console.error('usage: evite-extra-image.mjs <booking_ref> <image file> [alt text]')
  process.exit(2)
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
const evites = await rest(`evites?select=id,slug,image_key,extra_images&booking_id=eq.${bookings[0].id}`)
if (evites.length !== 1) throw new Error(`evite for ${ref}: found ${evites.length}`)
const ev = evites[0]
if (!IMAGE_KEY.test(ev.image_key ?? '')) throw new Error(`${ref}: the evite has no image_key yet - let it render once first`)
const current = Array.isArray(ev.extra_images) ? ev.extra_images : []
if (current.length >= MAX) throw new Error(`${ref}: already has ${current.length} extra pictures (the most is ${MAX})`)

const jpeg = await sharp(fs.readFileSync(file))
  .rotate()
  .resize({ width: 1200, withoutEnlargement: true })
  .flatten({ background: '#ffffff' })
  .jpeg({ quality: 86, mozjpeg: true })
  .toBuffer()

const object = `extra-${randomBytes(8).toString('hex')}.jpg`
const up = await fetch(`${url}/storage/v1/object/evites/${ev.image_key}/${object}`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=31536000', 'x-upsert': 'false' },
  body: jpeg,
})
if (!up.ok) throw new Error(`upload: ${up.status} ${await up.text()}`)

await rest(`evites?id=eq.${ev.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ extra_images: [...current, { object, alt }] }),
  headers: { Prefer: 'return=minimal' },
})
console.log(`${ref} (/i/${ev.slug}): extra_images += ${object} (${jpeg.length} bytes); now ${current.length + 1} of ${MAX}`)
console.log('Nothing was sent or rendered. The picture is on the page now.')
