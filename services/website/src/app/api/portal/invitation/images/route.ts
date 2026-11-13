import { NextRequest } from 'next/server'
import { getPortalBookingRef, portalSigningSecret } from '@/lib/portalAuth'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { hostJson, openHostGate } from '@/lib/evites/hostGate'
import { extraImageUrls } from '@/lib/evites/extraImages'
import { addExtraImage, removeExtraImage } from '@/lib/evites/extraImagesWrite'

/**
 * The host's extra pictures on their invitation PAGE (migration 101, `evites.extra_images`).
 * Portal-gated like `/api/portal/invitation/guests`: the `hh_portal` cookie names the booking, the
 * evite is found through it, and nothing in the body can name another one.
 *
 *   GET     -> { images: [{ object, url, alt }] }
 *   POST    multipart/form-data  image=<jpeg | png | webp, <= 10 MB>, alt=<optional, <= 120 chars>
 *           -> { ok, images }   resized to 1200 px wide (never cropped), stored in Storage
 *              `evites/<image_key>/extra-<random>.jpg`. 409 at four pictures, once the party has happened,
 *              or before the invitation has rendered once (no `image_key` yet)
 *   DELETE  { object } -> { ok, images }   only an entry of THIS evite
 *
 * Page-only: NO re-render. The type is judged by magic bytes, no file name is read, stored or logged.
 * 401 without a session; 404 `no-invitation`; every response is `no-store`.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BODY_MAX_CHARS = 2_000

export async function GET(req: NextRequest) {
  const bookingRef = getPortalBookingRef(req.headers.get('cookie'), portalSigningSecret())
  if (!bookingRef) return hostJson({ error: 'Not authenticated' }, 401)

  const gate = await openHostGate(req, bookingRef, 'portal/invitation/images', { rejectClosed: false })
  if (!gate.ok) return gate.res
  return hostJson({ images: extraImageUrls(gate.loaded.evite, process.env.SUPABASE_URL) })
}

export async function POST(req: NextRequest) {
  const bookingRef = getPortalBookingRef(req.headers.get('cookie'), portalSigningSecret())
  if (!bookingRef) return hostJson({ error: 'Not authenticated' }, 401)

  const limited = guardRate(req, plannerRule('portal/invitation/images'))
  if (limited) return limited

  const gate = await openHostGate(req, bookingRef, 'portal/invitation/images', { rejectClosed: true })
  if (!gate.ok) return gate.res

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return hostJson({ error: 'Send the picture as a form upload.' }, 400)
  }

  const out = await addExtraImage(gate.supabase, gate.loaded.evite, form)
  if (!out.ok) return hostJson(out.error === 'no-invitation' ? { error: 'no-invitation' } : { error: out.error }, out.status)
  return hostJson({ ok: true, images: extraImageUrls({ image_key: gate.loaded.evite.image_key, extra_images: out.images }, process.env.SUPABASE_URL) })
}

export async function DELETE(req: NextRequest) {
  const bookingRef = getPortalBookingRef(req.headers.get('cookie'), portalSigningSecret())
  if (!bookingRef) return hostJson({ error: 'Not authenticated' }, 401)

  const limited = guardRate(req, plannerRule('portal/invitation/images'))
  if (limited) return limited

  const gate = await openHostGate(req, bookingRef, 'portal/invitation/images', { rejectClosed: false })
  if (!gate.ok) return gate.res

  let object: unknown = null
  try {
    const text = await req.text()
    if (text.length <= BODY_MAX_CHARS) {
      const v: unknown = JSON.parse(text)
      if (v && typeof v === 'object' && !Array.isArray(v)) object = (v as { object?: unknown }).object
    }
  } catch {
    object = null
  }

  const out = await removeExtraImage(gate.supabase, gate.loaded.evite, object)
  if (!out.ok) return hostJson(out.error === 'no-invitation' ? { error: 'no-invitation' } : { error: out.error }, out.status)
  return hostJson({ ok: true, images: extraImageUrls({ image_key: gate.loaded.evite.image_key, extra_images: out.images }, process.env.SUPABASE_URL) })
}
