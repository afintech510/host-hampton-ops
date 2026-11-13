import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { logBookingChange } from '@/lib/bookingAudit'
import { queueRender } from '@/lib/evites/render'
import { CUSTOM_ART_MAX_BYTES, fitCustomArt, sniffImageType } from '@/lib/evites/customArtFit'
import { isUuidLike } from '@/lib/evites/adminView'

/**
 * Admin: the host's OWN finished invitation image (migration 073), from the Invitation card.
 *
 *   POST /api/admin/parties/[id]/invitation/art   multipart/form-data
 *        file=<jpeg | png | webp, at most 10 MB>   fits it to 1085x1530 without cropping, uploads it to Storage
 *                                                  `evites/<image_key>/custom-<random>.jpg`, sets `evites.custom_art`, queues a render
 *        clear=1                                   removes it (`custom_art` NULL; the object stays in Storage) and queues a render
 *
 * The same thing `scripts/evite-custom-art.mjs` does. `[id]` is the BOOKING id. Admin only.
 *
 * The type is judged by MAGIC BYTES, never by the file name or the declared content type; the size is
 * checked on the bytes read, not on a header. The image is never written under `public/` (this repository
 * is public and the art is a real child), and NO file name is read, stored or logged: the stored object
 * name is random. The audit names the booking and the object, not the upload.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BUCKET = 'evites'
const IMAGE_KEY = /^[0-9a-f]{32}$/
const NO_STORE = { 'Cache-Control': 'no-store' }

type Ctx = { params: { id: string } | Promise<{ id: string }> }

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { id } = await ctx.params
  if (!isUuidLike(id)) return json({ error: 'Not found' }, 404)

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return json({ error: 'Send the image as a form upload.' }, 400)
  }

  const supabase = getSupabase()
  const actor = adminActorId(req)
  const audit = (summary: string, oldData?: Record<string, unknown>, newData?: Record<string, unknown>) =>
    logBookingChange(supabase, { bookingId: id, actor, summary, oldData: oldData ?? null, newData: newData ?? null })

  const ev = await supabase
    .from('evites')
    .select('id, image_key, custom_art, archived_at')
    .eq('booking_id', id)
    .maybeSingle<{ id: string; image_key: string | null; custom_art: string | null; archived_at: string | null }>()
  if (ev.error) return json({ error: `invitation read failed: ${ev.error.message}` }, 503)
  if (!ev.data) return json({ error: 'This booking has no invitation yet' }, 404)
  const evite = ev.data

  // ---- remove
  if (form.get('clear') === '1') {
    const { data, error } = await supabase.from('evites').update({ custom_art: null }).eq('id', evite.id).select('id')
    if (error) return json({ error: `could not remove the image: ${error.message}` }, 500)
    if (!data || data.length === 0) return json({ error: 'Invitation not found' }, 404)
    queueRender(evite.id)
    const audited = await audit("Invitation: the host's own image removed", { custom_art: evite.custom_art }, { custom_art: null })
    return json({ ok: true, action: 'clear', audited })
  }

  // ---- upload
  const file = form.get('file')
  if (!file || typeof file === 'string' || typeof (file as Blob).arrayBuffer !== 'function') {
    return json({ error: 'Choose an image to upload.' }, 400)
  }
  const blob = file as Blob
  if (blob.size > CUSTOM_ART_MAX_BYTES) return json({ error: 'That image is over 10 MB. Please choose a smaller one.' }, 413)
  const bytes = Buffer.from(await blob.arrayBuffer())
  if (bytes.length > CUSTOM_ART_MAX_BYTES) return json({ error: 'That image is over 10 MB. Please choose a smaller one.' }, 413)
  if (bytes.length === 0 || sniffImageType(bytes) === null) return json({ error: 'Please choose a JPEG, PNG or WebP image.' }, 415)
  if (!IMAGE_KEY.test(evite.image_key ?? '')) {
    return json({ error: 'The invitation has not rendered once yet. Press Re-render, then try again.' }, 409)
  }

  let jpeg: Buffer
  try {
    jpeg = await fitCustomArt(bytes)
  } catch {
    return json({ error: 'That image could not be read. Please try another.' }, 422)
  }

  const name = `custom-${randomBytes(4).toString('hex')}.jpg`
  const up = await supabase.storage.from(BUCKET).upload(`${evite.image_key}/${name}`, jpeg, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: false,
  })
  if (up.error) return json({ error: `upload failed: ${up.error.message}` }, 502)

  const { data, error } = await supabase.from('evites').update({ custom_art: name }).eq('id', evite.id).select('id')
  if (error) return json({ error: `could not save the image: ${error.message}` }, 500)
  if (!data || data.length === 0) return json({ error: 'Invitation not found' }, 404)

  queueRender(evite.id)
  const audited = await audit("Invitation: the host's own image set", { custom_art: evite.custom_art }, { custom_art: name })
  return json({ ok: true, action: 'upload', bytes: jpeg.length, audited })
}
