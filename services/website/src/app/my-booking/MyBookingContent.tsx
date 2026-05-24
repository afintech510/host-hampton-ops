'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { formatMoney, calculateCardFee } from '@/lib/partyPricing'
import type { PartyBooking } from '@/types/booking-flow'
import { PAYMENT_METHODS } from '@/types/booking-flow'
import type { PaymentMethod } from '@/types/booking-flow'
import { loadStripe } from '@stripe/stripe-js'

interface PortalData {
  booking: PartyBooking
  permissions: {
    canEditFull: boolean
    canEditGuestCount: boolean
    fullReason?: string
    guestCountReason?: string
  }
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  awaiting_deposit: { label: 'Awaiting Deposit', color: 'bg-yellow-100 text-yellow-800' },
  pending_review: { label: 'Under Review', color: 'bg-blue-100 text-blue-800' },
  deposit_paid: { label: 'Deposit Paid', color: 'bg-blue-100 text-blue-800' },
  approved: { label: 'Confirmed', color: 'bg-green-100 text-green-800' },
  modifications_locked: { label: 'Locked', color: 'bg-gray-100 text-gray-800' },
  paid_in_full: { label: 'Paid in Full', color: 'bg-emerald-100 text-emerald-800' },
  completed: { label: 'Completed', color: 'bg-purple-100 text-purple-800' },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-800' },
}

function MyBookingInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [guestCount, setGuestCount] = useState(0)
  const [saving, setSaving] = useState(false)

  // Payment state
  const [showPayment, setShowPayment] = useState(false)
  const [paymentType, setPaymentType] = useState<'deposit' | 'partial' | 'full'>('full')
  const [customAmount, setCustomAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card')
  const [payProcessing, setPayProcessing] = useState(false)
  const [payError, setPayError] = useState('')
  const [payInstructions, setPayInstructions] = useState('')
  const [checkoutReady, setCheckoutReady] = useState(false)
  const checkoutRef = useRef<HTMLDivElement>(null)
  const embeddedCheckoutRef = useRef<any>(null)

  const paymentSuccess = params.get('payment') === 'success'
  const sessionId = params.get('session_id')

  useEffect(() => { fetchBooking() }, [])

  // Handle return from embedded checkout
  useEffect(() => {
    if (!sessionId) return
    fetch(`/api/portal/session-status?session_id=${sessionId}`)
      .then(r => r.json())
      .then(d => {
        if (d.payment_status === 'paid') {
          window.history.replaceState({}, '', '/my-booking?payment=success')
          fetchBooking()
        }
      })
  }, [sessionId])

  async function fetchBooking() {
    setLoading(true)
    const res = await fetch('/api/portal/booking')
    if (res.status === 401) {
      router.push('/my-booking/login')
      return
    }
    if (!res.ok) {
      setError('Could not load your booking.')
      setLoading(false)
      return
    }
    const d = await res.json()
    setData(d)
    setGuestCount(d.booking.guest_count_approx || 0)
    setLoading(false)
  }

  async function updateGuestCount() {
    setSaving(true)
    const res = await fetch('/api/portal/booking', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest_count_approx: guestCount }),
    })
    if (!res.ok) {
      const d = await res.json()
      setError(d.error || 'Update failed')
    } else {
      await fetchBooking()
    }
    setSaving(false)
  }

  const getPayAmountCents = useCallback(() => {
    if (!data) return 0
    const balance = data.booking.balance_due_cents || 0
    if (paymentType === 'deposit') return 9900
    if (paymentType === 'full') return balance
    return Math.round(Number(customAmount) * 100) || 0
  }, [data, paymentType, customAmount])

  async function initiatePayment() {
    const amountCents = getPayAmountCents()
    if (amountCents < 5000) {
      setPayError('Minimum payment is $50')
      return
    }
    setPayProcessing(true)
    setPayError('')
    setPayInstructions('')

    // Destroy previous embedded checkout if any
    if (embeddedCheckoutRef.current) {
      embeddedCheckoutRef.current.destroy()
      embeddedCheckoutRef.current = null
    }
    setCheckoutReady(false)

    const res = await fetch('/api/portal/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amountCents,
        paymentMethod,
        paymentType: paymentType === 'full' ? 'final' : paymentType,
        embedded: paymentMethod === 'card',
      }),
    })
    const resData = await res.json()

    if (!res.ok) {
      setPayError(resData.error || 'Payment failed')
      setPayProcessing(false)
      return
    }

    if (paymentMethod !== 'card') {
      setPayInstructions(resData.instructions || '')
      setPayProcessing(false)
      return
    }

    // Embedded Stripe checkout
    if (resData.clientSecret) {
      try {
        const stripeKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
        if (!stripeKey) {
          setPayError('Stripe configuration error')
          setPayProcessing(false)
          return
        }
        const stripe = await loadStripe(stripeKey)
        if (!stripe) {
          setPayError('Failed to load payment processor')
          setPayProcessing(false)
          return
        }
        const checkout = await stripe.initEmbeddedCheckout({
          clientSecret: resData.clientSecret,
        })
        setPayProcessing(false)
        setCheckoutReady(true)
        // Mount after state update
        setTimeout(() => {
          if (checkoutRef.current) {
            checkout.mount(checkoutRef.current)
            embeddedCheckoutRef.current = checkout
          }
        }, 50)
      } catch (err: any) {
        setPayError(err.message || 'Payment setup failed')
        setPayProcessing(false)
      }
    } else if (resData.url) {
      // Fallback to redirect
      window.location.href = resData.url
    }
  }

  // Cleanup embedded checkout on unmount
  useEffect(() => {
    return () => {
      if (embeddedCheckoutRef.current) {
        embeddedCheckoutRef.current.destroy()
      }
    }
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F1EB] flex items-center justify-center">
        <div className="text-gray-400">Loading your booking...</div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-[#F6F1EB] flex items-center justify-center">
        <div className="bg-white rounded-xl p-8 max-w-md text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <a href="/my-booking/login" className="text-[#1a2744] underline">Try logging in again</a>
        </div>
      </div>
    )
  }

  if (!data) return null
  const { booking, permissions } = data
  const status = STATUS_LABELS[booking.status] || { label: booking.status, color: 'bg-gray-100 text-gray-700' }
  const balance = booking.balance_due_cents || 0
  const isDeposit = booking.status === 'awaiting_deposit'
  const cardFee = paymentMethod === 'card' ? calculateCardFee(getPayAmountCents()) : 0

  const partyDateFormatted = booking.party_date
    ? new Date(booking.party_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : 'TBD'

  return (
    <div className="min-h-screen bg-[#F6F1EB]">
      <div className="max-w-3xl mx-auto px-4 py-10 md:py-16">
        {(paymentSuccess || sessionId) && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 text-center">
            <p className="text-green-800 font-medium">Payment received! Your balance has been updated.</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-center">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs text-gray-400 font-mono">{booking.booking_ref}</p>
              <h1 className="font-display text-2xl text-[#1a2744]">
                {booking.child_name ? `${booking.child_name}'s Party` : booking.package_type || 'Your Party'}
              </h1>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${status.color}`}>
              {status.label}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 text-sm">
            <div>
              <span className="text-gray-400">Date</span>
              <p className="text-[#1a2744] font-medium">{partyDateFormatted}</p>
            </div>
            <div>
              <span className="text-gray-400">Time</span>
              <p className="text-[#1a2744] font-medium">{booking.party_time || 'TBD'}</p>
            </div>
            <div>
              <span className="text-gray-400">Guests</span>
              <p className="text-[#1a2744] font-medium">{booking.guest_count_approx || '—'}</p>
            </div>
            <div>
              <span className="text-gray-400">Theme</span>
              <p className="text-[#1a2744] font-medium">{booking.package_type || '—'}</p>
            </div>
          </div>
        </div>

        {/* Modification banner */}
        {!permissions.canEditFull && permissions.fullReason && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
            <p className="text-amber-800 text-sm">{permissions.fullReason}</p>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {/* Left: Line Items */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="font-display text-lg text-[#1a2744] mb-4">Party Details</h2>
            {(booking.line_items || []).map((item, idx) => {
              const itemTotal = item.guest_multiplied
                ? item.unit_price_cents * item.quantity * (booking.guest_count_approx || 1)
                : item.unit_price_cents * item.quantity
              const isDiscount = item.unit_price_cents < 0
              return (
                <div key={idx} className="flex justify-between py-2 border-b border-gray-100 last:border-0 text-sm">
                  <span className={isDiscount ? 'text-amber-600' : 'text-gray-700'}>
                    {item.name}
                    {item.quantity > 1 && <span className="text-gray-400 ml-1">x{item.quantity}</span>}
                  </span>
                  <span className={`font-medium ${isDiscount ? 'text-amber-600' : 'text-[#1a2744]'}`}>
                    {itemTotal !== 0 ? formatMoney(itemTotal) : 'Included'}
                  </span>
                </div>
              )
            })}
            <div className="flex justify-between pt-3 mt-2 border-t-2 border-[#1a2744] text-[#1a2744] font-semibold">
              <span>Total</span>
              <span>{formatMoney(booking.total_cents || 0)}</span>
            </div>
          </div>

          {/* Right: Balance + Payment */}
          <div className="space-y-6">
            {/* Balance card */}
            <div className="bg-white rounded-xl shadow-sm p-6 text-center">
              <p className="text-gray-400 text-xs mb-1">Balance Due</p>
              <p className="text-3xl font-bold text-[#1a2744]">{formatMoney(balance)}</p>
              {balance > 0 && !showPayment && (
                <button
                  onClick={() => {
                    setShowPayment(true)
                    setPaymentType(isDeposit ? 'deposit' : 'full')
                    setPayInstructions('')
                    setCheckoutReady(false)
                  }}
                  className="mt-4 bg-[#1a2744] text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-[#2a3754] transition-colors"
                >
                  {isDeposit ? 'Pay Deposit' : 'Make a Payment'}
                </button>
              )}
            </div>

            {/* Inline Payment Form */}
            {showPayment && balance > 0 && (
              <div className="bg-white rounded-xl shadow-sm p-6">
                {checkoutReady ? (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-display text-lg text-[#1a2744]">Enter Card Details</h3>
                      <button
                        onClick={() => {
                          if (embeddedCheckoutRef.current) {
                            embeddedCheckoutRef.current.destroy()
                            embeddedCheckoutRef.current = null
                          }
                          setCheckoutReady(false)
                          setShowPayment(false)
                        }}
                        className="text-xs text-gray-400 hover:text-gray-600"
                      >Cancel</button>
                    </div>
                    <div ref={checkoutRef} />
                  </>
                ) : payInstructions ? (
                  <div className="text-center">
                    <h3 className="font-display text-lg text-[#1a2744] mb-3">Payment Instructions</h3>
                    <div className="bg-[#F6F1EB] rounded-xl p-4 text-sm text-gray-700 mb-4">{payInstructions}</div>
                    <button
                      onClick={() => { setPayInstructions(''); setShowPayment(false) }}
                      className="text-sm text-[#A1B5C8] hover:underline"
                    >Done</button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-display text-lg text-[#1a2744]">Make a Payment</h3>
                      <button onClick={() => setShowPayment(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                    </div>

                    {/* Amount Selection */}
                    <div className="space-y-2 mb-5">
                      <label className="text-sm text-gray-600 font-medium">Amount</label>
                      <div className="grid grid-cols-2 gap-2">
                        {isDeposit && (
                          <button
                            onClick={() => setPaymentType('deposit')}
                            className={`py-2.5 rounded-lg text-sm font-medium border-2 transition-colors ${
                              paymentType === 'deposit' ? 'border-[#1a2744] bg-[#1a2744]/5 text-[#1a2744]' : 'border-gray-200 text-gray-600'
                            }`}
                          >Deposit</button>
                        )}
                        <button
                          onClick={() => setPaymentType('full')}
                          className={`py-2.5 rounded-lg text-sm font-medium border-2 transition-colors ${
                            paymentType === 'full' ? 'border-[#1a2744] bg-[#1a2744]/5 text-[#1a2744]' : 'border-gray-200 text-gray-600'
                          }`}
                        >Full Balance ({formatMoney(balance)})</button>
                        <button
                          onClick={() => { setPaymentType('partial'); setCustomAmount('') }}
                          className={`py-2.5 rounded-lg text-sm font-medium border-2 transition-colors ${
                            paymentType === 'partial' ? 'border-[#1a2744] bg-[#1a2744]/5 text-[#1a2744]' : 'border-gray-200 text-gray-600'
                          }`}
                        >Custom Amount</button>
                      </div>
                      {paymentType === 'partial' && (
                        <div className="mt-2">
                          <input
                            type="number"
                            value={customAmount}
                            onChange={e => setCustomAmount(e.target.value)}
                            placeholder="Amount ($)"
                            min={50}
                            max={balance / 100}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                          />
                          <p className="text-xs text-gray-400 mt-1">Minimum $50</p>
                        </div>
                      )}
                    </div>

                    {/* Payment Method */}
                    <div className="space-y-2 mb-5">
                      <label className="text-sm text-gray-600 font-medium">Payment Method</label>
                      <div className="space-y-2">
                        {PAYMENT_METHODS.map(pm => (
                          <label
                            key={pm.value}
                            className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer text-sm transition-colors ${
                              paymentMethod === pm.value ? 'border-[#1a2744] bg-[#1a2744]/5' : 'border-gray-200'
                            }`}
                          >
                            <input
                              type="radio"
                              name="pm"
                              value={pm.value}
                              checked={paymentMethod === pm.value}
                              onChange={e => setPaymentMethod(e.target.value as PaymentMethod)}
                              className="accent-[#1a2744]"
                            />
                            <span className="font-medium text-[#1a2744]">{pm.label}</span>
                            {pm.feeLabel && <span className="text-gray-400 text-xs">{pm.feeLabel}</span>}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Summary */}
                    {getPayAmountCents() > 0 && (
                      <div className="bg-[#F6F1EB] rounded-lg p-4 mb-4">
                        <div className="flex justify-between text-sm text-gray-600">
                          <span>Payment</span>
                          <span>{formatMoney(getPayAmountCents())}</span>
                        </div>
                        {cardFee > 0 && (
                          <div className="flex justify-between text-sm text-gray-500">
                            <span>Processing fee (3%)</span>
                            <span>{formatMoney(cardFee)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-[#1a2744] font-semibold mt-2 pt-2 border-t border-gray-300">
                          <span>Total</span>
                          <span>{formatMoney(getPayAmountCents() + cardFee)}</span>
                        </div>
                      </div>
                    )}

                    {payError && <p className="text-red-600 text-sm mb-3">{payError}</p>}

                    <button
                      onClick={initiatePayment}
                      disabled={payProcessing || getPayAmountCents() < 5000}
                      className="w-full bg-[#1a2744] text-white py-3 rounded-lg font-medium hover:bg-[#2a3754] disabled:opacity-50 transition-colors"
                    >
                      {payProcessing ? 'Processing...' : paymentMethod === 'card'
                        ? `Pay ${formatMoney(getPayAmountCents() + cardFee)}`
                        : `Get ${paymentMethod === 'venmo' ? 'Venmo' : paymentMethod === 'zelle' ? 'Zelle' : 'Cash'} Instructions`}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Guest count editor */}
            {permissions.canEditGuestCount && (
              <div className="bg-white rounded-xl shadow-sm p-6">
                <h3 className="text-sm font-medium text-[#1a2744] mb-3">Adjust Guest Count</h3>
                <div className="flex items-center gap-3 mb-3">
                  <button
                    onClick={() => setGuestCount(Math.max(1, guestCount - 1))}
                    className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-50"
                  >-</button>
                  <span className="text-lg font-semibold text-[#1a2744] w-8 text-center">{guestCount}</span>
                  <button
                    onClick={() => setGuestCount(guestCount + 1)}
                    className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-50"
                  >+</button>
                </div>
                {guestCount !== (booking.guest_count_approx || 0) && (
                  <button
                    onClick={updateGuestCount}
                    disabled={saving}
                    className="w-full bg-[#A1B5C8] text-white py-2 rounded-lg text-sm font-medium hover:bg-[#8fa4b7] disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Guest Count'}
                  </button>
                )}
              </div>
            )}

            {/* Payment History */}
            {(booking.payments || []).length > 0 && (
              <div className="bg-white rounded-xl shadow-sm p-6">
                <h3 className="text-sm font-medium text-[#1a2744] mb-3">Payment History</h3>
                {(booking.payments || []).map((p, idx) => (
                  <div key={idx} className="flex justify-between py-2 border-b border-gray-100 last:border-0 text-sm">
                    <div>
                      <span className="text-gray-700 capitalize">{p.payment_type}</span>
                      <span className="text-gray-400 text-xs ml-2">
                        {new Date(p.paid_at).toLocaleDateString()}
                      </span>
                    </div>
                    <span className={`font-medium ${p.payment_type === 'refund' ? 'text-red-600' : 'text-green-700'}`}>
                      {p.payment_type === 'refund' ? '-' : ''}{formatMoney(p.amount_cents)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-gray-400 text-xs mt-10">
          Questions? Call{' '}
          <a href="tel:6319989325" className="text-[#1a2744] hover:underline">(631) 998-9325</a>
        </p>
      </div>
    </div>
  )
}

export default function MyBookingContent() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F6F1EB]" />}>
      <MyBookingInner />
    </Suspense>
  )
}
