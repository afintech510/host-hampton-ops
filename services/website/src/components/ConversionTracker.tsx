'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { trackPurchase, trackBookingRequest } from '@/lib/gtag'

/**
 * Fires the conversion event for a success page.
 * Deduplicates via sessionStorage so refreshing doesn't double-count.
 *
 * `/book/success` is reached by four paths that mean four different things about
 * money, and this component used to fire an identical $99 `purchase` for all of
 * them:
 *
 *   ?request=1&ref=   unpaid booking REQUEST   (api/checkout/route.ts:233)
 *   ?ref=<bookingRef> confirmed, no Stripe     (api/checkout/route.ts:130)
 *   ?ref=paylink      admin link, ANY amount   (api/admin/pay-link/route.ts)
 *   ?session_id=      a real Stripe payment
 *
 * `/events/success?ref=` covers free RSVPs too — the Christmas Market RSVP is a
 * $0 events row, and it was reporting $99 of revenue per RSVP.
 *
 * So: a request fires `generate_lead`, and everything else fires `purchase` with
 * NO invented amount. The real amount is not knowable on this page — it would
 * take a server-side lookup by ref, and adding a public endpoint that returns
 * booking amounts is a bigger decision than a tracking fix. Sending no value is
 * honest; sending $99 was not.
 */
export default function ConversionTracker({ type }: { type: 'booking' | 'ticket' }) {
  const searchParams = useSearchParams()

  useEffect(() => {
    const sessionId = searchParams.get('session_id')
    const ref = searchParams.get('ref')
    const transactionId = sessionId || ref
    if (!transactionId) return

    const key = `hh_conversion_${transactionId}`
    if (sessionStorage.getItem(key)) return

    // Only the booking funnel has an unpaid branch. A Stripe session is always a
    // real payment, so `request=1` alongside one would be contradictory — trust
    // the session id in that case rather than the query flag.
    const isUnpaidRequest =
      type === 'booking' && searchParams.get('request') === '1' && !sessionId

    if (isUnpaidRequest) {
      trackBookingRequest(transactionId)
    } else {
      trackPurchase(
        transactionId,
        undefined,
        type === 'booking' ? 'Booking Deposit' : 'Event Ticket',
      )
    }
    sessionStorage.setItem(key, '1')
  }, [searchParams, type])

  return null
}
