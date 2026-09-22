import { metaTrack } from '@/lib/metaPixel'

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID || ''
export const GADS_ID = process.env.NEXT_PUBLIC_GADS_ID || ''
export const GADS_PURCHASE_LABEL = process.env.NEXT_PUBLIC_GADS_PURCHASE_LABEL || ''
export const GADS_LEAD_LABEL = process.env.NEXT_PUBLIC_GADS_LEAD_LABEL || ''

type GtagEvent = Record<string, string | number | boolean | undefined>

declare global {
  interface Window {
    gtag?: (...args: [string, ...unknown[]]) => void
  }
}

function gtag(...args: [string, ...unknown[]]) {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag(...args)
  }
}

/** Fire a custom GA4 event */
export function event(action: string, params?: GtagEvent) {
  gtag('event', action, params)
}

/** Lead form submitted (party inquiry, room rental, etc.) */
export function trackLead(source: string, email?: string) {
  event('lead_submission', {
    event_category: 'engagement',
    event_label: source,
    value: 1,
  })
  metaTrack('Lead', { content_name: source })
  if (GADS_ID && GADS_LEAD_LABEL) {
    gtag('event', 'conversion', {
      send_to: `${GADS_ID}/${GADS_LEAD_LABEL}`,
    })
  }
}

/** Contact form or inquiry submitted */
export function trackContact(method: string) {
  event('contact', { method })
  metaTrack('Contact', { method })
}

/** Checkout initiated (redirecting to Stripe) */
export function trackCheckoutStart(packageName: string, value?: number) {
  event('begin_checkout', {
    ...moneyFields(value),
    items: packageName,
  })
  metaTrack('InitiateCheckout', {
    content_name: packageName,
    ...(value == null ? {} : { value, currency: 'USD' }),
  })
}

/**
 * Money fields for a conversion event, omitted entirely when the amount is
 * unknown.
 *
 * This used to be `value: value || 99`, and that fallback was not a harmless
 * default — it invented revenue. A FREE event RSVP reported $99, and so did an
 * unpaid booking request. Reporting no value is not as good as reporting the
 * real one, but it is the only honest option at a call site that genuinely does
 * not know the amount, and it is strictly better than a number we made up:
 * a fabricated value trains ad bidding on fiction. `0` is preserved, because a
 * free RSVP really is worth $0 and that is a fact worth sending.
 */
function moneyFields(value?: number): GtagEvent {
  return value == null ? {} : { value, currency: 'USD' }
}

/**
 * A real payment completed. Only call this when money actually changed hands —
 * see `trackBookingRequest` for the unpaid path.
 */
export function trackPurchase(transactionId: string, value?: number, itemName?: string) {
  event('purchase', {
    transaction_id: transactionId,
    ...moneyFields(value),
    items: itemName || 'Booking Deposit',
  })
  metaTrack('Purchase', {
    content_name: itemName || 'Booking Deposit',
    order_id: transactionId,
    // Meta requires value+currency on Purchase; send an explicit 0 rather than
    // omitting them, or the event is rejected as malformed.
    value: value ?? 0,
    currency: 'USD',
  })
  if (GADS_ID && GADS_PURCHASE_LABEL) {
    gtag('event', 'conversion', {
      send_to: `${GADS_ID}/${GADS_PURCHASE_LABEL}`,
      ...moneyFields(value),
      transaction_id: transactionId,
    })
  }
}

/**
 * A booking REQUEST — an inquiry, not a sale.
 *
 * `api/checkout/route.ts` is explicit that deposit-required bookings "are now
 * REQUESTS — we never charge or lock a date here"; the row lands as
 * `pending_review` and the customer pays later through their portal. The success
 * page's own copy says "Nothing is booked yet and no payment is due". It was
 * nonetheless firing a `purchase` worth $99, which made the single busiest
 * funnel on the site report revenue that did not exist.
 */
export function trackBookingRequest(transactionId: string) {
  event('generate_lead', {
    transaction_id: transactionId,
    event_category: 'engagement',
    event_label: 'booking-request',
    value: 0,
    currency: 'USD',
  })
  metaTrack('Lead', { content_name: 'Booking Request', value: 0, currency: 'USD' })
  if (GADS_ID && GADS_LEAD_LABEL) {
    gtag('event', 'conversion', {
      send_to: `${GADS_ID}/${GADS_LEAD_LABEL}`,
      transaction_id: transactionId,
    })
  }
}

/** Phone number click */
export function trackPhoneClick() {
  event('contact', { method: 'phone' })
}
