'use client'

import { useEffect, useRef, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'

type StripeInstance = NonNullable<Awaited<ReturnType<typeof loadStripe>>>
type ElementsInstance = ReturnType<StripeInstance['elements']>

/**
 * The card form for `/my-booking` and `/my-booking/pay`.
 *
 * `/api/portal/pay` answers a card request with a PaymentIntent
 * (`pi_…_secret_…`), so the form is a Stripe **Payment Element** — the same
 * pattern as the party-builder's "Make a Payment" panel, which posts to the same
 * route. It is NOT embedded Checkout: `initEmbeddedCheckout` wants a Checkout
 * Session secret and rejects this one, which is what left both pages without a
 * card field (`myBookingCardPaySurface.test.ts`).
 *
 * The intent is created with `allow_redirects: 'never'`, so `confirmPayment`
 * settles in place (`redirect: 'if_required'`) and `return_url` is only the
 * fallback Stripe requires to exist. After a confirmed charge the browser asks
 * `/api/party-builder/confirm-session` to reconcile — idempotent, and it races
 * the webhook safely (that route's own header explains the split) — before
 * `onSuccess` lets the page re-read the booking.
 */
export default function PortalCardPayment({
  clientSecret,
  paymentIntentId,
  payLabel,
  onSuccess,
  onCancel,
}: {
  clientSecret: string
  paymentIntentId: string | null
  /** e.g. "Pay $257.50" — the button text. */
  payLabel: string
  onSuccess: () => void
  onCancel: () => void
}) {
  const mountRef = useRef<HTMLDivElement>(null)
  const stripeRef = useRef<StripeInstance | null>(null)
  const elementsRef = useRef<ElementsInstance | null>(null)
  const [ready, setReady] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    let paymentElement: { mount: (el: HTMLElement) => void; unmount: () => void } | null = null

    async function setup() {
      const stripeKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
      if (!stripeKey) { setError('Payment configuration error'); return }
      const stripe = await loadStripe(stripeKey)
      if (cancelled) return
      if (!stripe) { setError('Failed to load payment processor'); return }
      const elements = stripe.elements({
        clientSecret,
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#1a2744',
            colorBackground: '#ffffff',
            colorText: '#1a2744',
            fontFamily: 'Georgia, serif',
            borderRadius: '10px',
          },
        },
      })
      paymentElement = elements.create('payment', { layout: 'tabs' })
      stripeRef.current = stripe
      elementsRef.current = elements
      if (mountRef.current) {
        paymentElement.mount(mountRef.current)
        setReady(true)
      }
    }

    setup().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Payment setup failed')
    })

    return () => {
      cancelled = true
      if (paymentElement) paymentElement.unmount()
      stripeRef.current = null
      elementsRef.current = null
    }
  }, [clientSecret])

  async function confirm() {
    setError('')
    if (!stripeRef.current || !elementsRef.current) {
      setError('Payment form not ready. Try again.')
      return
    }
    setConfirming(true)
    try {
      const { error: confirmError } = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        confirmParams: { return_url: `${window.location.origin}/my-booking?paid=1` },
        redirect: 'if_required',
      })
      if (confirmError) {
        setError(confirmError.message || 'Payment was declined')
        setConfirming(false)
        return
      }
      if (paymentIntentId) {
        await fetch('/api/party-builder/confirm-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_intent: paymentIntentId }),
        }).catch(err => console.error('confirm-session failed (non-fatal):', err))
      }
      onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Payment failed')
      setConfirming(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg text-[#1a2744]">Enter Card Details</h3>
        <button
          onClick={onCancel}
          disabled={confirming}
          className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
        >Cancel</button>
      </div>
      <div ref={mountRef} />
      {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
      {ready && (
        <button
          onClick={confirm}
          disabled={confirming}
          className="w-full mt-4 bg-[#1a2744] text-white py-3 rounded-lg font-medium hover:bg-[#2a3754] disabled:opacity-50 transition-colors"
        >
          {confirming ? 'Processing...' : payLabel}
        </button>
      )}
    </div>
  )
}
