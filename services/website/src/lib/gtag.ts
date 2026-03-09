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
  if (GADS_ID && GADS_LEAD_LABEL) {
    gtag('event', 'conversion', {
      send_to: `${GADS_ID}/${GADS_LEAD_LABEL}`,
    })
  }
}

/** Contact form or inquiry submitted */
export function trackContact(method: string) {
  event('contact', { method })
}

/** Checkout initiated (redirecting to Stripe) */
export function trackCheckoutStart(packageName: string, value?: number) {
  event('begin_checkout', {
    currency: 'USD',
    value: value || 99,
    items: packageName,
  })
}

/** Purchase completed (on success page) */
export function trackPurchase(transactionId: string, value?: number, itemName?: string) {
  event('purchase', {
    transaction_id: transactionId,
    currency: 'USD',
    value: value || 99,
    items: itemName || 'Booking Deposit',
  })
  if (GADS_ID && GADS_PURCHASE_LABEL) {
    gtag('event', 'conversion', {
      send_to: `${GADS_ID}/${GADS_PURCHASE_LABEL}`,
      value: value || 99,
      currency: 'USD',
      transaction_id: transactionId,
    })
  }
}

/** Phone number click */
export function trackPhoneClick() {
  event('contact', { method: 'phone' })
}
