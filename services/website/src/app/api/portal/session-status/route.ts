import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getPortalBookingRef, portalSigningSecret } from '@/lib/portalAuth'

// Reads a cookie, so it must never be prerendered. Without this Next tried to
// statically export it and evaluated the handler at BUILD time.
export const dynamic = 'force-dynamic'

/**
 * "Did my card payment go through?" — polled by `/my-booking` after a Stripe
 * redirect.
 *
 * ── The authorization hole ────────────────────────────────────────────────
 *
 * This route took a `session_id` from the query string and handed it straight
 * to `stripe.checkout.sessions.retrieve()`. The portal cookie was checked — but
 * only that the caller had *a* session, never that the Stripe object belonged
 * to *their* booking. Any authenticated portal customer could read the status
 * of any checkout session on the whole account. That is the same shape as
 * `/api/plan/[ref]/pay-link` before `planAccess` existed: a value trusted
 * because it arrived in the URL.
 *
 * Every session this app creates carries `metadata.booking_ref` (see
 * `lib/planPayLinks.ts` and the checkout routes), so the check is cheap and
 * exact. A session with no `booking_ref` — a hand-made Payment Link in the
 * Stripe dashboard, which is exactly what produced the lost $927 — belongs to
 * nobody's portal and is refused here rather than shown to whoever asked.
 *
 * A bogus id also used to throw, giving an authenticated customer a bare 500.
 */
export async function GET(req: NextRequest) {
  const secret = portalSigningSecret()
  const cookieHeader = req.headers.get('cookie')
  const bookingRef = getPortalBookingRef(cookieHeader, secret)

  if (!bookingRef) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const sessionId = req.nextUrl.searchParams.get('session_id')
  // Stripe checkout session ids are `cs_` + base58-ish. Refusing anything else
  // keeps a malformed value out of the API call entirely.
  if (!sessionId || !/^cs_[A-Za-z0-9_]{8,255}$/.test(sessionId)) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 })
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('portal session-status: STRIPE_SECRET_KEY is not set')
    return NextResponse.json({ error: 'Payments are not configured' }, { status: 503 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId)
  } catch (err: unknown) {
    const code = (err as { statusCode?: number }).statusCode
    if (code === 404) {
      return NextResponse.json({ error: 'No such payment' }, { status: 404 })
    }
    // Rule 12: a Stripe outage is not "your payment does not exist".
    console.error('portal session-status: retrieve failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not check that payment — try again.' }, { status: 503 })
  }

  const sessionRef = (session.metadata?.booking_ref || '').trim()
  if (!sessionRef || sessionRef !== bookingRef) {
    // Deliberately the same answer as a nonexistent id, so this cannot be used
    // to probe which session ids are real.
    return NextResponse.json({ error: 'No such payment' }, { status: 404 })
  }

  return NextResponse.json({
    status: session.status,
    payment_status: session.payment_status,
  })
}
