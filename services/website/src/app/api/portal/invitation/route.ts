import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef, portalSigningSecret } from '@/lib/portalAuth'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { etDateString } from '@/lib/partyTime'
import { validPartyDate } from '@/lib/evites/partyWindow'
import { composeHostView, readHostRows, type HostRead } from '@/lib/evites/hostView'
import { screenHostPatch } from '@/lib/evites/hostScreens'
import { queueRender } from '@/lib/evites/render'

/**
 * The host's view of their own invitation (spec §7.2). Portal-gated: the `hh_portal` session
 * cookie names the booking, and NOTHING in the URL or body can name another one.
 *
 *   GET    ->  { state, facts, url, images, renderFresh, rsvps, summary, customize, deadlineRange }
 *   PATCH  ->  the same shape, after the host's customisation is saved and a re-render is queued
 *
 * - 401 without a valid portal session. (`isAdminAuthorized` is not for portal routes.)
 * - 404 `{ error: 'no-invitation' }` when the booking has none the host may see: the evite does
 *   not exist yet, the pages flag is off / not a pilot booking, it is archived, or the booking
 *   is cancelled or lost. A GET NEVER creates an evite - `ensureEviteForBooking` is the intake
 *   routes' and the cron's job.
 * - 503 when a read fails, never a 404 or a guessed state (three outcomes, `readHostRows`).
 * - Columns are allow-listed twice over: named in the SELECTs, and re-picked on the way out
 *   (`pickHostRsvp`). The response never carries the evite's id, `edit_nonce`, a guest's
 *   reminder email/phone, club fields or consent IP.
 *
 * PATCH. The allow-list and the screens are `screenHostPatch` (six keys; an unknown key is a
 * 400). The row is found through the booking the COOKIE names, never an id from the body; the
 * UPDATE reads its `{ error }`, requires that a row changed, and is conditional on the evite not
 * having been archived in the meantime. `guardRate` runs before any other work. After the write
 * `queueRender` is fired-and-forgotten (the image is stale until it lands - `renderFresh` says
 * so, and the Share panel waits for it). A party that has already happened is a 409: there is
 * nothing left to customise, and re-rendering a finished invitation is wasted work.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_INVITATION = { error: 'no-invitation' } as const

function notReady(read: Exclude<HostRead, { kind: 'ok' }>): NextResponse {
  if (read.kind === 'none') return NextResponse.json(NO_INVITATION, { status: 404 })
  console.error(`portal/invitation: ${read.reason}`)
  return NextResponse.json({ error: 'Could not load your invitation - try again.' }, { status: 503 })
}

function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export async function GET(req: NextRequest) {
  const bookingRef = getPortalBookingRef(req.headers.get('cookie'), portalSigningSecret())
  if (!bookingRef) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const now = new Date()
  const read = await readHostRows(getSupabase(), bookingRef, now)
  if (read.kind !== 'ok') return noStore(notReady(read))

  return noStore(NextResponse.json(composeHostView(read.loaded, process.env.SUPABASE_URL, now).payload))
}

export async function PATCH(req: NextRequest) {
  const bookingRef = getPortalBookingRef(req.headers.get('cookie'), portalSigningSecret())
  if (!bookingRef) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // A customer working a form: `plannerRule`, not `intakeRule` (a corrected resubmit is normal).
  const limited = guardRate(req, plannerRule('portal/invitation'))
  if (limited) return limited

  const body: unknown = await req.json().catch(() => null)

  const supabase = getSupabase()
  const now = new Date()
  const read = await readHostRows(supabase, bookingRef, now)
  if (read.kind !== 'ok') return noStore(notReady(read))
  const loaded = read.loaded

  if (loaded.state === 'closed') {
    return NextResponse.json({ error: 'This party has already happened, so the invitation can no longer be changed.' }, { status: 409 })
  }

  const screened = screenHostPatch(body, {
    today: etDateString(now),
    partyDate: validPartyDate(loaded.booking.party_date),
    current: { rsvp_deadline: loaded.evite.rsvp_deadline },
  })
  if (!screened.ok) {
    return NextResponse.json({ error: screened.message, field: screened.field }, { status: 400 })
  }

  // The row is the one the cookie's booking owns (`readHostRows` looked it up by booking id).
  const { data: changed, error: updateErr } = await supabase
    .from('evites')
    .update(screened.columns)
    .eq('id', loaded.evite.id)
    .is('archived_at', null)
    .select('id')
  if (updateErr) {
    console.error(`portal/invitation: update failed for ${bookingRef}: ${updateErr.message}`)
    return NextResponse.json({ error: 'Could not save your changes - try again.' }, { status: 503 })
  }
  if (!changed || changed.length === 0) {
    return NextResponse.json(NO_INVITATION, { status: 404 })
  }

  // Fire-and-forget. The stored image no longer matches the facts, so `renderFresh` is false
  // from this response on, until the render lands.
  queueRender(loaded.evite.id)

  const merged = { ...loaded, evite: { ...loaded.evite, ...screened.columns } }
  return noStore(NextResponse.json(composeHostView(merged, process.env.SUPABASE_URL, now).payload))
}
