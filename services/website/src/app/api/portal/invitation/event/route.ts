import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef, portalSigningSecret } from '@/lib/portalAuth'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { recordEviteEvent } from '@/lib/evites/analytics'
import { findEviteIdForRef } from '@/lib/evites/hostView'

/**
 * The host page's one analytics beacon (spec §7.2, §11): `POST { event: 'share_clicked' }`.
 *
 * - Portal-gated (401 without a session). The evite is the one the COOKIE's booking owns;
 *   nothing in the URL or body names it.
 * - The allow-list is one event. The other six `evite_events` are written by the server on the
 *   action itself or reported by the guest's own page, never by the host's browser.
 * - Counted by `guardRate` before any other work. Sized with `plannerRule`: a host taps Share a
 *   handful of times, never thirty in ten minutes.
 * - 204 when recorded. Analytics never changes the answer: a failed insert is logged inside
 *   `recordEviteEvent` and the beacon still answers 204. An invitation the host cannot see is 404;
 *   a failed read is 503.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const bookingRef = getPortalBookingRef(req.headers.get('cookie'), portalSigningSecret())
  if (!bookingRef) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const limited = guardRate(req, plannerRule('portal/invitation-event'))
  if (limited) return limited

  const body = (await req.json().catch(() => null)) as { event?: unknown } | null
  if (!body || typeof body !== 'object' || body.event !== 'share_clicked') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const supabase = getSupabase()
  const found = await findEviteIdForRef(supabase, bookingRef)
  if (found.kind === 'unavailable') {
    console.error(`portal/invitation/event: ${found.reason}`)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 503 })
  }
  if (found.kind === 'none') return NextResponse.json({ error: 'no-invitation' }, { status: 404 })

  await recordEviteEvent(supabase, found.eviteId, 'share_clicked')
  const res = new NextResponse(null, { status: 204 })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
