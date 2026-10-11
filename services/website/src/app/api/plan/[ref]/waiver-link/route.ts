/**
 * `POST /api/plan/[ref]/waiver-link` — hand back the room-rental waiver link.
 *
 * The link is the EXISTING pre-arrival check-in link: `mintCheckinLink` stores
 * only an HMAC of a random token in `checkin_tokens` and returns
 * `/checkin/<token>`, whose step 2 is the SignWell Studio Rental Agreement &
 * Liability Waiver. No new secret and no new token type — this route only decides
 * WHO may ask for one and WHEN.
 *
 *   * **Who** — `planAccess()`: the portal cookie naming THIS ref, or an admin
 *     session. The same decision the summary page and `/pay-link` make. An admin
 *     gets a link to copy and send on; a customer gets one to open.
 *   * **When** — `waiverOffer()`, the function the page asks before it draws the
 *     button: a studio rental, not cancelled, not over, not already signed, and
 *     SignWell configured. A refusal says WHY in words, because the alternative is
 *     the check-in page's `{ unavailable: true }`, which is silent.
 *   * **A POST.** Minting writes a row; it must not be reachable by navigation,
 *     a prefetch or a link-preview bot.
 *
 * The link is minted on click rather than at page render: every render of an
 * invoice would otherwise insert a row nobody asked for.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { planAccess } from '@/lib/planAccess'
import { isAdminAuthorized } from '@/lib/adminAuth'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { mintCheckinLink } from '@/lib/checkinLink'
import { waiverOffer } from '@/lib/waiverOffer'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const limited = guardRate(req, plannerRule('plan/waiver-link'))
  if (limited) return limited

  const { ref: rawRef } = await params
  const ref = decodeURIComponent(rawRef || '')
  if (!ref) return NextResponse.json({ error: 'Missing plan reference' }, { status: 400 })

  const access = planAccess(req.headers.get('cookie'), ref)
  const isAdmin = access.ok ? access.isAdmin : isAdminAuthorized(req)
  if (!access.ok && !isAdmin) {
    return NextResponse.json({ error: 'Not authorized for this plan' }, { status: 403 })
  }

  const supabase = getSupabase()
  // Named columns: the booking row also holds admin notes and payment ids.
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, booking_ref, status, event_type, package_type, party_date, checkin_agreement_signed_at, agreement_signed_at')
    .eq('booking_ref', ref)
    .maybeSingle()

  // Three outcomes: unreadable is not absent.
  if (error) {
    console.error('plan waiver-link: booking read failed for', ref, '—', error.message)
    return NextResponse.json({ error: 'Could not read this plan — try again.' }, { status: 503 })
  }
  if (!booking) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const offer = waiverOffer({
    booking,
    signedAt: booking.checkin_agreement_signed_at ?? booking.agreement_signed_at ?? null,
  })

  if (offer.state === 'signed') {
    return NextResponse.json({ error: 'Your rental agreement is already signed — nothing more to do.' }, { status: 409 })
  }
  if (offer.state !== 'offer') {
    return NextResponse.json({ error: 'The rental waiver is not available for this booking.' }, { status: 409 })
  }

  try {
    const url = await mintCheckinLink(booking.id as string)
    return NextResponse.json({ ok: true, url })
  } catch (err) {
    console.error('plan waiver-link: could not mint a check-in link for', ref, '—', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not open the waiver — try again.' }, { status: 503 })
  }
}
