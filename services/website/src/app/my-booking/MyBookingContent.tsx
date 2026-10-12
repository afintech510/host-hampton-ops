'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { formatMoney, calculateCardFee } from '@/lib/partyPricing'
import type { PartyBooking } from '@/types/booking-flow'
import { PAYMENT_METHODS } from '@/types/booking-flow'
import type { PaymentMethod } from '@/types/booking-flow'
import PortalCardPayment from './PortalCardPayment'
import { CUSTOMER_STAGE_LABELS, PAYMENT_LABELS, partyStatuses, etToday, type BookingStage } from '@/lib/bookingStatus'
import { sumPayments } from '@/lib/bookingBalance'
import { PUBLIC_PHONE_DISPLAY } from '@/lib/paymentContacts'
import type { PortalPartyDetails, DetailFact } from '@/lib/portalPartyDetails'

interface PortalData {
  booking: PartyBooking
  /**
   * Every party detail, shaped per product by `buildPortalPartyDetails` on the
   * server. Optional only so a response from before the deploy still renders.
   */
  details?: PortalPartyDetails
  /**
   * Server-derived money. Older responses may not carry it, so every read is
   * defaulted — but nothing here recomputes it, because the figure a customer
   * is charged is the server's answer (see /api/portal/booking).
   */
  money?: {
    totalCents: number
    outstandingCents: number
    depositOwedCents: number
    balanceDueCents: number
    unpriced: boolean
  }
  permissions: {
    canEditFull: boolean
    canEditGuestCount: boolean
    fullReason?: string
    guestCountReason?: string
  }
}

/**
 * The customer sees the derived booking stage (lib/bookingStatus.ts), never the
 * raw column — `approved` used to read "Confirmed" on quotes nobody had paid.
 */
const STAGE_BADGE: Record<BookingStage, string> = {
  inquiry: 'bg-slate-100 text-slate-700',
  quoted: 'bg-yellow-100 text-yellow-800',
  booked: 'bg-green-100 text-green-800',
  completed: 'bg-purple-100 text-purple-800',
  cancelled: 'bg-red-100 text-red-800',
  lost: 'bg-gray-100 text-gray-700',
}

const CARD = 'bg-white rounded-2xl shadow-sm border border-[#A1B5C8]/20 p-5 sm:p-6'

function FactList({ facts, cols = true }: { facts: DetailFact[]; cols?: boolean }) {
  return (
    <dl className={cols ? 'grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm' : 'space-y-3 text-sm'}>
      {facts.map(f => (
        <div key={f.label} className="min-w-0">
          <dt className="text-gray-400 text-xs">{f.label}</dt>
          <dd className="text-[#1a2744] font-medium break-words whitespace-pre-line">{f.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** "In-studio party" pill colours. Presentation only. */
const KIND_PILL: Record<PortalPartyDetails['kind'], string> = {
  in_studio: 'bg-[#BCCDEB]/50 text-[#1a2744]',
  mobile: 'bg-[#F3D9DF] text-[#7a3b4b]',
  studio_rental: 'bg-[#E9E1D3] text-[#5b4a2f]',
  other: 'bg-gray-100 text-gray-700',
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
  // The PaymentIntent a card payment is waiting on (`/api/portal/pay` answers a
  // card with a PaymentIntent secret, rendered by <PortalCardPayment>).
  const [cardIntent, setCardIntent] = useState<{ clientSecret: string; paymentIntentId: string | null } | null>(null)
  const [justPaid, setJustPaid] = useState(false)

  const paymentSuccess = params.get('payment') === 'success' || params.get('paid') === '1' || justPaid
  const sessionId = params.get('session_id')

  useEffect(() => { fetchBooking() }, [])

  // The "Your invitation" card shows only when the host has one they may see: a 200 from the
  // invitation endpoint. 404 (no evite yet / switched off / cancelled), 401 and a failed read
  // all hide it, so the card can never be a link to a dead page. Deliberately a separate small
  // fetch rather than a field on /api/portal/booking, whose column list is not touched here.
  const [hasInvitation, setHasInvitation] = useState(false)
  useEffect(() => {
    let live = true
    fetch('/api/portal/invitation', { cache: 'no-store' })
      .then(r => { if (live) setHasInvitation(r.ok) })
      .catch(() => undefined)
    return () => { live = false }
  }, [])

  // "Copy portal link". The link is this page with no token in it: on a device
  // that holds the session it opens the booking, and anywhere else it lands on
  // the sign-in page, which emails a fresh link. So it is safe to paste into a
  // group chat — it never carries a credential.
  const [linkCopied, setLinkCopied] = useState(false)
  async function copyPortalLink() {
    const url = `${window.location.origin}/my-booking`
    try {
      await navigator.clipboard.writeText(url)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2500)
    } catch {
      window.prompt('Copy your booking link:', url)
    }
  }

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
    // Was a hardcoded `9900`. The deposit has been a flat $250 since the
    // 2026-09-05 ruling, and on an unpriced plan it is the only thing payable —
    // so it comes from the server's `depositOwedCents`, never from this file.
    if (paymentType === 'deposit') return data.money?.depositOwedCents || 0
    // Deliberately still the COLUMN, not the invoice's `outstandingCents`: on a
    // studio rental the two differ by exactly the $250 of needs-Adam 41, and
    // the invoice's figure is the higher one. Raising what a customer is asked
    // for is Adam's ruling to make, not a side effect of this change.
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

    setCardIntent(null)

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

    // A card answers with a PaymentIntent secret (no `url`): mount a Payment
    // Element on it. A Checkout Session redirect is kept only as a fallback.
    if (resData.clientSecret) {
      setCardIntent({ clientSecret: resData.clientSecret, paymentIntentId: resData.paymentIntentId || null })
      setPayProcessing(false)
    } else if (resData.url) {
      window.location.href = resData.url
    } else {
      setPayError('Unexpected response from the server. Please try again.')
      setPayProcessing(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400">Loading your booking...</div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-white rounded-xl p-8 max-w-md text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <a href="/my-booking/login" className="text-[#1a2744] underline">Try logging in again</a>
        </div>
      </div>
    )
  }

  if (!data) return null
  const { booking, permissions } = data
  const stages = partyStatuses({
    status: booking.status,
    paidCents: sumPayments(booking.payments),
    partyDate: booking.party_date,
    today: etToday(),
    totalCents: booking.total_cents,
    depositCents: (booking as { deposit_amount?: number | null }).deposit_amount ?? null,
  })
  const status = {
    label: stages.stage === 'booked' ? PAYMENT_LABELS[stages.payment_status] : CUSTOMER_STAGE_LABELS[stages.stage],
    color: STAGE_BADGE[stages.stage],
  }
  const balance = booking.balance_due_cents || 0
  const depositOwed = data.money?.depositOwedCents || 0
  // What there is to pay AT ALL — a balance, or an unpaid deposit on a plan
  // that has no balance yet. The Pay button used to be gated on `balance > 0`
  // alone, which is 0 on every unpriced plan.
  const payable = balance > 0 || depositOwed > 0
  const isDeposit = booking.status === 'awaiting_deposit' || (depositOwed > 0 && balance <= 0)
  const cardFee = paymentMethod === 'card' ? calculateCardFee(getPayAmountCents()) : 0

  const details = data.details
  // The figure under the itemised list is the server's billed total — the same
  // `planMoney` total the invoice prints, built from the very line amounts shown
  // above it. The column is only a fallback for a response from before that.
  const totalCents = data.money?.totalCents ?? booking.total_cents ?? 0
  const hasLines = (details?.sections.length ?? 0) > 0
  // Opening the invoice ISSUES an invoice number on first render (lib/invoiceNumber.ts),
  // so it is a plain link — never prefetched, never embedded — and only offered once
  // there is a quote on it. An unpriced lead's invoice is an empty page that would
  // burn a number for nothing.
  const invoiceHref = !data.money?.unpriced && hasLines
    ? `/plan/${encodeURIComponent(booking.booking_ref)}/summary`
    : null
  const location = details?.location ?? null

  return (
    <div className="min-h-screen">
      <div className="max-w-3xl mx-auto px-4 pt-8 pb-12 md:pt-14 md:pb-16">
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
        <div className={`${CARD} mb-5`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {details && (
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide ${KIND_PILL[details.kind]}`}>
                    {details.kindLabel}
                  </span>
                )}
                <span className="text-xs text-gray-400 font-mono">{booking.booking_ref}</span>
              </div>
              <h1 className="font-display text-2xl sm:text-3xl text-[#1a2744] leading-tight break-words">
                {details?.title || (booking.child_name ? `${booking.child_name}'s Party` : booking.package_type || 'Your Party')}
              </h1>
              {details?.subtitle && <p className="text-sm text-gray-500 mt-1 break-words">{details.subtitle}</p>}
            </div>
            <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium ${status.color}`}>
              {status.label}
            </span>
          </div>

          {details && (
            <div className="mt-5">
              <FactList facts={details.facts} />
            </div>
          )}

          {location && (
            <div className="mt-4 pt-4 border-t border-gray-100 text-sm">
              <p className="text-gray-400 text-xs">{location.kind === 'studio' ? 'Where' : 'Party address'}</p>
              {location.kind === 'studio' ? (
                <a href={location.mapsUrl} target="_blank" rel="noopener" className="text-[#1a2744] font-medium underline decoration-[#A1B5C8] underline-offset-2">
                  Host Hampton studio · {location.line}
                </a>
              ) : (
                <>
                  <p className="text-[#1a2744] font-medium break-words">{location.address || 'Not on file yet'}</p>
                  {location.needsAddress && (
                    <p className="text-amber-700 text-xs mt-1">
                      We still need the full street address for your party team.{' '}
                      {invoiceHref
                        ? <>You can add it on your <a href={invoiceHref} className="underline">invoice page</a>, or text us.</>
                        : <>Just text it to us on {PUBLIC_PHONE_DISPLAY}.</>}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Modification banner */}
        {!permissions.canEditFull && permissions.fullReason && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
            <p className="text-amber-800 text-sm">{permissions.fullReason}</p>
          </div>
        )}

        {/* Your links: invoice, the planner/rental editor, and this portal itself */}
        <div className={`${CARD} mb-5`}>
          <h2 className="font-display text-lg text-[#1a2744] mb-3">Your links</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {invoiceHref && (
              <a href={invoiceHref} className="flex items-center justify-between gap-2 rounded-xl border border-[#1a2744]/15 px-4 py-3 text-sm font-medium text-[#1a2744] hover:bg-[#1a2744]/5 transition-colors">
                <span>View &amp; print invoice</span><span aria-hidden>→</span>
              </a>
            )}
            {details?.editLink && (
              <a href={details.editLink.href} className="flex items-center justify-between gap-2 rounded-xl border border-[#1a2744]/15 px-4 py-3 text-sm font-medium text-[#1a2744] hover:bg-[#1a2744]/5 transition-colors">
                <span>{details.editLink.label}</span><span aria-hidden>→</span>
              </a>
            )}
            <button
              type="button"
              onClick={copyPortalLink}
              className="flex items-center justify-between gap-2 rounded-xl border border-[#1a2744]/15 px-4 py-3 text-sm font-medium text-[#1a2744] hover:bg-[#1a2744]/5 transition-colors text-left"
            >
              <span>{linkCopied ? 'Link copied!' : 'Copy my booking portal link'}</span><span aria-hidden>⧉</span>
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Your portal link opens this page. On a new phone or computer, just enter your email at{' '}
            <a href="/my-booking/login" className="underline">sign in</a> and we&rsquo;ll send you a fresh link.
          </p>
        </div>

        {hasInvitation && (
          <div className={`${CARD} mb-5 flex items-center justify-between flex-wrap gap-3`}>
            <div>
              <h2 className="font-display text-lg text-[#1a2744]">Your invitation</h2>
              <p className="text-sm text-gray-500">See your party invitation, send it to your guests and watch the RSVPs come in.</p>
            </div>
            <a href="/my-booking/invitation" className="bg-[#1a2744] text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-[#2a3754] transition-colors">
              Open my invitation
            </a>
          </div>
        )}

        <div className="grid md:grid-cols-5 gap-5">
          {/* Left: everything they chose */}
          <div className="md:col-span-3 space-y-5">
            {details && details.choices.length > 0 && (
              <div className={CARD}>
                <h2 className="font-display text-lg text-[#1a2744] mb-3">Food &amp; cake</h2>
                <FactList facts={details.choices} />
              </div>
            )}

            <div className={CARD}>
              <h2 className="font-display text-lg text-[#1a2744] mb-1">
                {details?.kind === 'studio_rental' ? 'Rental details' : 'Party details'}
              </h2>
              {!hasLines ? (
                <p className="text-sm text-gray-500 mt-2">
                  We&rsquo;re still putting your quote together &mdash; everything you&rsquo;ve chosen will appear here
                  as soon as we&rsquo;ve confirmed the details with you.
                </p>
              ) : (
                <>
                  {details?.sections.map(section => (
                    <div key={section.key} className="mt-4">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#8FA8BF] mb-1">{section.title}</h3>
                      {section.lines.map((line, idx) => {
                        const isDiscount = line.amountCents < 0
                        return (
                          <div key={idx} className="flex justify-between gap-3 py-2 border-b border-gray-100 last:border-0 text-sm">
                            <div className="min-w-0">
                              <span className={isDiscount ? 'text-amber-700' : 'text-gray-700'}>
                                {line.name}
                                {line.quantityLabel && <span className="text-gray-400 ml-1">{line.quantityLabel}</span>}
                              </span>
                              {line.optional && (
                                <span className="ml-2 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 align-middle">
                                  Optional · not in total
                                </span>
                              )}
                              {line.description && <p className="text-xs text-gray-400 mt-0.5 break-words">{line.description}</p>}
                            </div>
                            <span className={`shrink-0 font-medium ${isDiscount ? 'text-amber-700' : 'text-[#1a2744]'}`}>
                              {line.amountCents === 0 ? 'Included' : isDiscount ? `-${formatMoney(-line.amountCents)}` : formatMoney(line.amountCents)}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                  <div className="flex justify-between pt-3 mt-3 border-t-2 border-[#1a2744] text-[#1a2744] font-semibold">
                    <span>Total</span>
                    <span>{formatMoney(totalCents)}</span>
                  </div>
                </>
              )}
            </div>

            {details && details.notes.length > 0 && (
              <div className={CARD}>
                <h2 className="font-display text-lg text-[#1a2744] mb-3">Notes</h2>
                <FactList facts={details.notes} cols={false} />
              </div>
            )}
          </div>
          {/* Right: Balance + Payment — FIRST on a phone, so the Pay button is not under the whole itemised list */}
          <div className="md:col-span-2 space-y-5 order-first md:order-none">
            {/* Balance card */}
            <div className={`${CARD} text-center`}>
              <p className="text-gray-400 text-xs mb-1">
                {balance <= 0 && depositOwed > 0 ? 'Deposit to Reserve' : 'Balance Due'}
              </p>
              <p className="text-3xl font-bold text-[#1a2744]">
                {formatMoney(balance <= 0 && depositOwed > 0 ? depositOwed : balance)}
              </p>
              {balance <= 0 && depositOwed > 0 && (
                <p className="text-gray-500 text-xs mt-2">
                  Holds your date. We&rsquo;ll build the rest of your plan together.
                </p>
              )}
              {payable && !showPayment && (
                <button
                  onClick={() => {
                    setShowPayment(true)
                    setPaymentType(isDeposit ? 'deposit' : 'full')
                    setPayInstructions('')
                    setCardIntent(null)
                  }}
                  className="mt-4 bg-[#1a2744] text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-[#2a3754] transition-colors"
                >
                  {isDeposit ? 'Pay Deposit' : 'Make a Payment'}
                </button>
              )}
            </div>

            {/* Inline Payment Form */}
            {showPayment && payable && (
              <div className={CARD}>
                {cardIntent ? (
                  <PortalCardPayment
                    clientSecret={cardIntent.clientSecret}
                    paymentIntentId={cardIntent.paymentIntentId}
                    payLabel={`Pay ${formatMoney(getPayAmountCents() + cardFee)}`}
                    onCancel={() => { setCardIntent(null); setShowPayment(false) }}
                    onSuccess={() => {
                      setCardIntent(null)
                      setShowPayment(false)
                      setJustPaid(true)
                      fetchBooking()
                    }}
                  />
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
                          >Deposit ({formatMoney(depositOwed)})</button>
                        )}
                        {/*
                          Hidden while there is no balance to pay. On an unpriced
                          plan both of these resolve to $0 and the server refuses
                          them — offering a customer a button that cannot work is
                          the friction this change exists to remove.
                        */}
                        {balance > 0 && (
                          <>
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
                          </>
                        )}
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
              <div className={CARD}>
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
              <div className={CARD}>
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
