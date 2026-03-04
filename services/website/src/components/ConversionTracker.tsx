'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { trackPurchase } from '@/lib/gtag'

/**
 * Fires a GA4 purchase conversion event on success pages.
 * Deduplicates via sessionStorage so refreshing doesn't double-count.
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

    trackPurchase(
      transactionId,
      type === 'booking' ? 99 : undefined,
      type === 'booking' ? 'Booking Deposit' : 'Event Ticket',
    )
    sessionStorage.setItem(key, '1')
  }, [searchParams, type])

  return null
}
