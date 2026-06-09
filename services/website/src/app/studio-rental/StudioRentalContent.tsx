'use client'

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Check, Clock, Users, CalendarDays, ChevronDown, Minus, Plus } from 'lucide-react'
import type { PricingItem } from '@/components/QuoteBuilder/types'
import {
  studioRentalRate,
  hoursBetween,
  STUDIO_MIN_HOURS,
  STUDIO_SEATED_CAPACITY,
  STUDIO_STANDING_CAPACITY,
  SECURITY_DEPOSIT_CENTS,
} from '@/lib/studioRental'
import { formatMoney, getDepositCents } from '@/lib/partyPricing'

interface Props {
  decor: PricingItem[]
  services: PricingItem[]
  food: PricingItem[]
  desserts: PricingItem[]
  beverages: PricingItem[]
}

const EVENT_TYPES = [
  'Baby Shower', 'First Birthday', 'Birthday Party', 'Bridal Shower',
  'Holiday Party', 'Communion Party', 'Graduation', 'Engagement Party',
  'Photo Shoot', 'Other Celebration',
]

// Studio open window for selectable times (includes the customer's setup/cleanup).
const TIME_OPTIONS = (() => {
  const out: { value: string; label: string }[] = []
  for (let h = 8; h <= 23; h++) {
    for (const m of [0, 30]) {
      const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      const period = h >= 12 ? 'PM' : 'AM'
      const h12 = h % 12 === 0 ? 12 : h % 12
      out.push({ value, label: `${h12}:${String(m).padStart(2, '0')} ${period}` })
    }
  }
  return out
})()

function timeLabel(v: string): string {
  return TIME_OPTIONS.find(t => t.value === v)?.label || v
}
function dateLabel(d: string): string {
  if (!d) return ''
  const [y, m, dd] = d.split('-').map(Number)
  return new Date(y, m - 1, dd).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

type Phase = 'build' | 'sign' | 'pay' | 'done'

export default function StudioRentalContent(props: Props) {
  const addOnGroups = useMemo(() => ([
    { key: 'decor', label: 'Decor', items: props.decor },
    { key: 'services', label: 'Services', items: props.services },
    { key: 'food', label: 'Food', items: props.food },
    { key: 'desserts', label: 'Desserts & Treats', items: props.desserts },
    { key: 'beverages', label: 'Beverages', items: props.beverages },
  ]).filter(g => g.items.length > 0), [props])

  const allItems = useMemo(
    () => [...props.decor, ...props.services, ...props.food, ...props.desserts, ...props.beverages],
    [props],
  )

  // ── Form state ──────────────────────────────────────────────
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('14:00')
  const [endTime, setEndTime] = useState('17:00')
  const [guestCount, setGuestCount] = useState(25)
  const [seatingNeeded, setSeatingNeeded] = useState('')
  const [eventType, setEventType] = useState('')
  const [contact, setContact] = useState({ name: '', email: '', phone: '', address: '' })
  const [notes, setNotes] = useState('')
  const [consent, setConsent] = useState(false)
  const [agreeRules, setAgreeRules] = useState(false)

  // selected add-ons: id → quantity (per_person items always qty 1, ×guests)
  const [selected, setSelected] = useState<Record<string, number>>({})

  // ── Checkout state ──────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('build')
  const [reserving, setReserving] = useState(false)
  const [error, setError] = useState('')
  const [signingUrl, setSigningUrl] = useState<string | null>(null)
  const [checkoutReady, setCheckoutReady] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [bookingRef, setBookingRef] = useState('')
  // Authoritative charge breakdown from the checkout response (incl. card fee).
  const [charge, setCharge] = useState<{ deposit: number; cardFee: number; total: number; balance: number } | null>(null)

  const stripeRef = useRef<Awaited<ReturnType<typeof loadStripe>> | null>(null)
  const elementsRef = useRef<ReturnType<NonNullable<Awaited<ReturnType<typeof loadStripe>>>['elements']> | null>(null)
  const paymentElementRef = useRef<{ mount: (el: HTMLElement) => void; unmount: () => void } | null>(null)
  const paymentIntentIdRef = useRef<string | null>(null)
  const clientSecretRef = useRef<string | null>(null)
  const checkoutRef = useRef<HTMLDivElement | null>(null)

  // Refs for required fields, so we can scroll to the first incomplete one.
  const eventTypeRef = useRef<HTMLSelectElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const guestRef = useRef<HTMLInputElement>(null)
  const agreeRulesRef = useRef<HTMLInputElement>(null)
  const consentRef = useRef<HTMLInputElement>(null)
  const signwellRef = useRef<{ open: () => void } | null>(null)

  // ── Derived pricing ─────────────────────────────────────────
  const hours = useMemo(() => Math.max(STUDIO_MIN_HOURS, hoursBetween(startTime, endTime)), [startTime, endTime])
  const rate = useMemo(() => (date ? studioRentalRate(date, hours) : null), [date, hours])

  const itemUnit = useCallback((item: PricingItem) => item.price_cents, [])
  const itemLineTotal = useCallback((item: PricingItem, qty: number) => {
    if (item.price_type === 'per_person') return item.price_cents * guestCount
    return item.price_cents * qty // flat or per_hour
  }, [guestCount])

  const addOnTotal = useMemo(() => {
    let sum = 0
    for (const id of Object.keys(selected)) {
      const item = allItems.find(i => i.id === id)
      if (item) sum += itemLineTotal(item, selected[id])
    }
    return sum
  }, [selected, allItems, itemLineTotal])

  const rentalCents = rate?.rentalCents ?? 0
  const totalCents = rentalCents + addOnTotal
  const depositCents = getDepositCents(totalCents)
  const balanceDueCents = Math.max(0, totalCents - depositCents)

  // Charge breakdown shown on the payment screen (server values once available).
  const depositNow = charge?.deposit ?? depositCents
  const cardFeeNow = charge?.cardFee ?? 0
  const balanceNow = charge?.balance ?? balanceDueCents
  const chargedTodayCents = depositNow + cardFeeNow

  const overSeated = guestCount > STUDIO_SEATED_CAPACITY
  const overStanding = guestCount > STUDIO_STANDING_CAPACITY
  const timeValid = hoursBetween(startTime, endTime) >= STUDIO_MIN_HOURS

  // ── Add-on handlers ─────────────────────────────────────────
  function toggle(item: PricingItem) {
    setSelected(prev => {
      const next = { ...prev }
      if (next[item.id] != null) delete next[item.id]
      else next[item.id] = 1
      return next
    })
  }
  function setQty(id: string, qty: number) {
    setSelected(prev => ({ ...prev, [id]: Math.max(1, qty) }))
  }

  // Scroll to the first incomplete required field; returns false if any are missing.
  function scrollToInvalid(): boolean {
    const checks: { ok: boolean; el: HTMLElement | null }[] = [
      { ok: !!eventType, el: eventTypeRef.current },
      { ok: !!contact.name.trim(), el: nameRef.current },
      { ok: /.+@.+\..+/.test(contact.email), el: emailRef.current },
      { ok: !!date, el: dateRef.current },
      { ok: timeValid, el: dateRef.current },
      { ok: guestCount > 0 && !overStanding, el: guestRef.current },
      { ok: agreeRules, el: agreeRulesRef.current },
      { ok: consent, el: consentRef.current },
    ]
    const bad = checks.find(c => !c.ok)
    if (!bad) return true
    bad.el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => bad.el?.focus({ preventScroll: true }), 400)
    setError('Please complete the highlighted field to continue.')
    return false
  }

  // ── Reserve → create booking + agreement + PaymentIntent ────
  async function reserve() {
    setError('')
    if (!scrollToInvalid()) return
    if (!rate) return
    setReserving(true)
    try {
      const lineItems = Object.keys(selected).map(id => {
        const item = allItems.find(i => i.id === id)!
        return {
          pricing_item_id: item.id,
          name: item.name,
          category: item.category,
          quantity: item.price_type === 'per_person' ? 1 : selected[id],
          unit_price_cents: item.price_cents,
          price_type: item.price_type,
          guest_multiplied: item.price_type === 'per_person',
        }
      })

      const res = await fetch('/api/studio-rental/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactName: contact.name,
          contactEmail: contact.email,
          contactPhone: contact.phone,
          contactAddress: contact.address,
          eventType,
          partyDate: date,
          startTime,
          endTime,
          guestCount,
          seatingNeeded: seatingNeeded ? parseInt(seatingNeeded, 10) : null,
          notes,
          lineItems,
          marketingConsent: consent,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Reservation failed. Please try again.')
        setReserving(false)
        return
      }

      setBookingRef(data.bookingRef || '')
      setCharge({
        deposit: data.depositCents ?? depositCents,
        cardFee: data.cardFeeCents ?? 0,
        total: data.totalCents ?? totalCents,
        balance: data.balanceDueCents ?? balanceDueCents,
      })
      clientSecretRef.current = data.clientSecret || null
      paymentIntentIdRef.current = data.paymentIntentId || null
      setReserving(false)

      if (data.signingUrl) {
        setSigningUrl(data.signingUrl)
        setPhase('sign')
      } else {
        // SignWell not configured (dev/preview) — go straight to payment.
        await mountPayment()
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setReserving(false)
    }
  }

  // ── Mount the in-page Stripe Payment Element ────────────────
  const mountPayment = useCallback(async () => {
    setError('')
    setPhase('pay')
    const clientSecret = clientSecretRef.current
    if (!clientSecret) { setError('Payment could not be initialized.'); return }
    const stripeKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    if (!stripeKey) { setError('Payment configuration error.'); return }
    const stripe = await loadStripe(stripeKey)
    if (!stripe) { setError('Failed to load payment processor.'); return }

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
    const paymentElement = elements.create('payment', { layout: 'tabs' })
    stripeRef.current = stripe
    elementsRef.current = elements
    setCheckoutReady(true)
    setTimeout(() => {
      if (checkoutRef.current) {
        paymentElement.mount(checkoutRef.current)
        paymentElementRef.current = paymentElement as unknown as { mount: (el: HTMLElement) => void; unmount: () => void }
      }
    }, 50)
  }, [])

  // ── Confirm payment ─────────────────────────────────────────
  async function confirmPayment() {
    setError('')
    if (!stripeRef.current || !elementsRef.current) { setError('Payment form not ready. Try again.'); return }
    setConfirming(true)
    try {
      const { error: payError } = await stripeRef.current.confirmPayment({
        elements: elementsRef.current,
        confirmParams: {},
        redirect: 'if_required',
      })
      if (payError) {
        setError(payError.message || 'Payment was declined.')
        setConfirming(false)
        return
      }
      if (paymentIntentIdRef.current) {
        await fetch('/api/studio-rental/confirm-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_intent: paymentIntentIdRef.current }),
        }).catch(err => console.error('confirm-session failed (non-fatal):', err))
      }
      if (paymentElementRef.current) paymentElementRef.current.unmount()
      paymentElementRef.current = null
      setCheckoutReady(false)
      setPhase('done')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setConfirming(false)
    }
  }

  // SignWell's embedded signing page sets X-Frame-Options: SAMEORIGIN, so it
  // can't be dropped into a raw <iframe>. Their embedded.js library embeds it
  // correctly and emits a `completed` event we use to advance to payment.
  function loadSignwellScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      const w = window as unknown as { SignWellEmbed?: unknown }
      if (w.SignWellEmbed) return resolve()
      const id = 'signwell-embedded-js'
      const existing = document.getElementById(id)
      if (existing) {
        existing.addEventListener('load', () => resolve())
        existing.addEventListener('error', () => reject(new Error('SignWell script error')))
        return
      }
      const s = document.createElement('script')
      s.id = id
      s.src = 'https://static.signwell.com/assets/embedded.js'
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('Failed to load SignWell'))
      document.body.appendChild(s)
    })
  }

  const openSignwell = useCallback(async (url: string) => {
    try {
      await loadSignwellScript()
      const Embed = (window as unknown as {
        SignWellEmbed: new (o: Record<string, unknown>) => { open: () => void }
      }).SignWellEmbed
      // Modal mode (no containerId): SignWell controls a full-height overlay so
      // the document renders properly. Inline container embedding left the doc
      // body blank because the iframe couldn't resolve a height.
      const embed = new Embed({
        url,
        allowDecline: false,
        events: {
          completed: () => mountPayment(),
          error: () => setError('There was a problem loading the agreement. Please use the button below to reopen it.'),
        },
      })
      signwellRef.current = embed
      embed.open()
    } catch {
      setError('Could not load the signing window. Please use the reload link below.')
    }
  }, [mountPayment])

  // Open the SignWell embed once we enter the sign phase and the container exists.
  useEffect(() => {
    if (phase === 'sign' && signingUrl) openSignwell(signingUrl)
  }, [phase, signingUrl, openSignwell])

  useEffect(() => () => { if (paymentElementRef.current) paymentElementRef.current.unmount() }, [])

  // ── Render ──────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-hampton-pink/20 flex items-center justify-center">
          <Check className="text-hampton-navy" size={32} />
        </div>
        <h1 className="font-serif text-3xl font-bold text-hampton-navy mb-3">Your studio is reserved! 🎉</h1>
        <p className="text-hampton-navy/70 mb-6">
          Confirmation <strong>{bookingRef}</strong> is on its way to <strong>{contact.email}</strong> with your
          signed agreement and a link to manage your booking.
        </p>
        <div className="bg-hampton-ivory rounded-2xl border border-hampton-pink/20 p-6 text-left text-sm text-hampton-navy/80 space-y-2">
          <p>• Your <strong>{formatMoney(depositCents)}</strong> deposit is paid — your date is locked.</p>
          <p>• Balance of <strong>{formatMoney(balanceDueCents)}</strong> is due 7 days before your event.</p>
          <p>• Use the link in your email anytime to <strong>add more time or add-ons</strong> and pay your balance.</p>
          <p>• A <strong>$500 refundable security hold</strong> is placed on your card the day of your event and auto-releases within 7 days.</p>
        </div>
        <a href="/my-booking" className="btn-primary inline-block mt-8 px-8 py-3">Manage My Booking</a>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 pb-44">
      {/* Hero */}
      <div className="text-center mb-10">
        <h1 className="font-serif text-3xl sm:text-4xl font-bold text-hampton-navy mb-3">Rent the Studio</h1>
        <p className="text-hampton-navy/70 max-w-xl mx-auto">
          Our private Hamptons studio for your celebration — baby showers, first birthdays, holiday parties and more.
          Seats up to {STUDIO_SEATED_CAPACITY} · standing room for {STUDIO_STANDING_CAPACITY}.
        </p>
        <div className="flex flex-wrap justify-center gap-3 mt-5 text-sm">
          <span className="bg-white border border-hampton-pink/20 rounded-full px-4 py-1.5 text-hampton-navy">Weekend · $575 / 3 hrs (+$100/hr)</span>
          <span className="bg-white border border-hampton-pink/20 rounded-full px-4 py-1.5 text-hampton-navy">Weekday · $450 / 3 hrs (+$75/hr)</span>
        </div>
      </div>

      {phase === 'build' && (
        <div className="space-y-8">
          {/* Your details */}
          <section className="bg-white rounded-2xl border border-hampton-pink/20 p-6">
            <h2 className="font-serif text-xl font-bold text-hampton-navy mb-4">Your details</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-sm font-medium text-hampton-navy">Event type</span>
                <select ref={eventTypeRef} value={eventType} onChange={e => setEventType(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-hampton-mauve/30 px-3 py-2 text-hampton-navy bg-white">
                  <option value="">Select…</option>
                  {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-hampton-navy">Full name</span>
                <input ref={nameRef} value={contact.name} onChange={e => setContact({ ...contact, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-hampton-mauve/30 px-3 py-2 text-hampton-navy" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-hampton-navy">Email</span>
                <input ref={emailRef} type="email" value={contact.email} onChange={e => setContact({ ...contact, email: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-hampton-mauve/30 px-3 py-2 text-hampton-navy" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-hampton-navy">Phone</span>
                <input value={contact.phone} onChange={e => setContact({ ...contact, phone: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-hampton-mauve/30 px-3 py-2 text-hampton-navy" />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-sm font-medium text-hampton-navy">Mailing address</span>
                <input value={contact.address} onChange={e => setContact({ ...contact, address: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-hampton-mauve/30 px-3 py-2 text-hampton-navy" />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-sm font-medium text-hampton-navy">Tell us about your event (optional)</span>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                  className="mt-1 w-full rounded-lg border border-hampton-mauve/30 px-3 py-2 text-hampton-navy" />
              </label>
            </div>
            <div className="mt-4 space-y-2">
              <label className="flex items-start gap-2 text-sm text-hampton-navy/80">
                <input ref={agreeRulesRef} type="checkbox" checked={agreeRules} onChange={e => setAgreeRules(e.target.checked)} className="mt-1" />
                <span>I understand the rental includes my own setup &amp; cleanup time, a 25% deposit holds my date with the balance due 7 days before, and a refundable <strong>$500 security hold</strong> ({formatMoney(SECURITY_DEPOSIT_CENTS)}) is placed on my card the day of the event.</span>
              </label>
              <label className="flex items-start gap-2 text-sm text-hampton-navy/80">
                <input ref={consentRef} type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1" />
                <span>I agree to receive booking updates from Host Hampton and to sign the Studio Rental Agreement in the next step.</span>
              </label>
            </div>
          </section>

          {/* Step 1: Date & time */}
          <section className="bg-white rounded-2xl border border-hampton-pink/20 p-6">
            <h2 className="font-serif text-xl font-bold text-hampton-navy mb-4 flex items-center gap-2">
              <CalendarDays size={20} /> When’s your event?
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-sm font-medium text-hampton-navy">Date</span>
                <input ref={dateRef} type="date" value={date} onChange={e => setDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-hampton-mauve/30 px-3 py-2 text-hampton-navy" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-hampton-navy flex items-center gap-1"><Users size={14} /> Guests</span>
                <input ref={guestRef} type="number" min={1} max={STUDIO_STANDING_CAPACITY} value={guestCount}
                  onChange={e => setGuestCount(parseInt(e.target.value || '0', 10))}
                  className="mt-1 w-full rounded-lg border border-hampton-mauve/30 px-3 py-2 text-hampton-navy" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-hampton-navy flex items-center gap-1"><Users size={14} /> Seating needed for how many guests?</span>
                <input type="number" min={0} max={STUDIO_SEATED_CAPACITY} value={seatingNeeded}
                  onChange={e => setSeatingNeeded(e.target.value)}
                  placeholder={`Up to ${STUDIO_SEATED_CAPACITY} seated`}
                  className="mt-1 w-full rounded-lg border border-hampton-mauve/30 px-3 py-2 text-hampton-navy" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-hampton-navy flex items-center gap-1"><Clock size={14} /> Start (includes your setup)</span>
                <select value={startTime} onChange={e => setStartTime(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-hampton-mauve/30 px-3 py-2 text-hampton-navy bg-white">
                  {TIME_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-hampton-navy flex items-center gap-1"><Clock size={14} /> End (includes your cleanup)</span>
                <select value={endTime} onChange={e => setEndTime(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-hampton-mauve/30 px-3 py-2 text-hampton-navy bg-white">
                  {TIME_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              {!timeValid && <span className="text-red-600">Minimum rental is {STUDIO_MIN_HOURS} hours.</span>}
              {timeValid && rate && (
                <span className="text-hampton-navy">
                  <strong>{rate.isWeekend ? 'Weekend' : 'Weekday'} · {hours} hrs</strong> → rental {formatMoney(rentalCents)}
                </span>
              )}
              {timeValid && !date && <span className="text-hampton-mauve">Pick a date to see your rate.</span>}
              {overStanding && <span className="text-red-600">Over our {STUDIO_STANDING_CAPACITY}-guest capacity — please call us.</span>}
              {overSeated && !overStanding && <span className="text-hampton-mauve">Over {STUDIO_SEATED_CAPACITY} seated — standing room only above {STUDIO_SEATED_CAPACITY}.</span>}
            </div>
          </section>

          {/* Step 2: Add-ons */}
          {addOnGroups.length > 0 && (
            <section className="bg-white rounded-2xl border border-hampton-pink/20 p-6">
              <h2 className="font-serif text-xl font-bold text-hampton-navy mb-1">Make it easier with add-ons</h2>
              <p className="text-hampton-navy/60 text-sm mb-5">Optional. Everything is priced live below — add only what you want.</p>
              <div className="space-y-7">
                {addOnGroups.map(group => (
                  <div key={group.key}>
                    <h3 className="text-xs font-bold tracking-[0.2em] uppercase text-hampton-mauve mb-3">{group.label}</h3>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {group.items.map(item => {
                        const isSel = selected[item.id] != null
                        const qty = selected[item.id] || 1
                        const perPerson = item.price_type === 'per_person'
                        const perHour = item.price_type === 'per_hour'
                        return (
                          <div key={item.id}
                            className={`rounded-xl border p-4 transition-colors ${isSel ? 'border-hampton-pink bg-hampton-pink/5' : 'border-hampton-mauve/15 bg-hampton-ivory/30'}`}>
                            <button type="button" onClick={() => toggle(item)} className="w-full text-left flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold text-hampton-navy text-sm">{item.emoji ? `${item.emoji} ` : ''}{item.name}</p>
                                {item.description && <p className="text-hampton-navy/50 text-xs mt-0.5">{item.description}</p>}
                              </div>
                              <div className="text-right shrink-0">
                                <span className="font-bold text-hampton-navy text-sm">{item.price_label || formatMoney(item.price_cents)}</span>
                                <span className="block text-[11px] text-hampton-navy/50">
                                  {perPerson ? '/ guest' : perHour ? '/ hour' : 'each'}
                                </span>
                              </div>
                            </button>
                            {isSel && !perPerson && (
                              <div className="mt-3 flex items-center gap-3">
                                <span className="text-xs text-hampton-navy/60">{perHour ? 'Hours' : 'Qty'}</span>
                                <div className="flex items-center gap-2">
                                  <button type="button" onClick={() => setQty(item.id, qty - 1)} className="w-7 h-7 rounded-full border border-hampton-mauve/30 flex items-center justify-center text-hampton-navy"><Minus size={14} /></button>
                                  <span className="w-6 text-center text-sm text-hampton-navy">{qty}</span>
                                  <button type="button" onClick={() => setQty(item.id, qty + 1)} className="w-7 h-7 rounded-full border border-hampton-mauve/30 flex items-center justify-center text-hampton-navy"><Plus size={14} /></button>
                                </div>
                                <span className="ml-auto text-sm font-semibold text-hampton-navy">{formatMoney(itemLineTotal(item, qty))}</span>
                              </div>
                            )}
                            {isSel && perPerson && (
                              <div className="mt-3 flex items-center justify-between text-sm">
                                <span className="text-xs text-hampton-navy/60">× {guestCount} guests</span>
                                <span className="font-semibold text-hampton-navy">{formatMoney(itemLineTotal(item, 1))}</span>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Sign phase */}
      {phase === 'sign' && signingUrl && (
        <section className="bg-white rounded-2xl border border-hampton-pink/20 p-6">
          <button type="button" onClick={() => { setError(''); setPhase('build') }} className="text-hampton-navy/60 text-sm mb-3 hover:underline">← Back to edit</button>
          <h2 className="font-serif text-xl font-bold text-hampton-navy mb-2">Review &amp; sign your agreement</h2>
          <p className="text-hampton-navy/60 text-sm mb-5">Booking <strong>{bookingRef}</strong> — your rental agreement opens in a secure window. Review and sign it, and we’ll bring you right back to payment.</p>
          <button type="button" onClick={() => openSignwell(signingUrl)} className="btn-primary w-full py-3">Open Agreement to Sign</button>
          {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
          <div className="mt-4 text-center">
            <button type="button" onClick={mountPayment} className="text-hampton-navy/60 underline text-sm">
              Already signed? Continue to payment
            </button>
          </div>
        </section>
      )}

      {/* Pay phase */}
      {phase === 'pay' && (
        <section className="bg-white rounded-2xl border border-hampton-pink/20 p-6">
          <button type="button" onClick={() => { setError(''); setPhase(signingUrl ? 'sign' : 'build') }} className="text-hampton-navy/60 text-sm mb-3 hover:underline">← Back</button>
          <h2 className="font-serif text-xl font-bold text-hampton-navy mb-4">Review &amp; pay your deposit</h2>

          {/* Booking summary */}
          <div className="bg-hampton-ivory/50 rounded-xl border border-hampton-mauve/15 p-4 mb-5 text-sm">
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 mb-3">
              {bookingRef && <div className="sm:col-span-2"><span className="text-hampton-navy/50">Booking</span> <strong className="text-hampton-navy">{bookingRef}</strong></div>}
              <div><span className="text-hampton-navy/50">Event</span> <span className="text-hampton-navy">{eventType}</span></div>
              <div><span className="text-hampton-navy/50">Date</span> <span className="text-hampton-navy">{dateLabel(date)}</span></div>
              <div><span className="text-hampton-navy/50">Time</span> <span className="text-hampton-navy">{timeLabel(startTime)} – {timeLabel(endTime)}</span></div>
              <div><span className="text-hampton-navy/50">Guests</span> <span className="text-hampton-navy">{guestCount}{seatingNeeded ? ` · ${seatingNeeded} seated` : ''}</span></div>
              <div className="sm:col-span-2"><span className="text-hampton-navy/50">Contact</span> <span className="text-hampton-navy">{contact.name} · {contact.email}{contact.phone ? ` · ${contact.phone}` : ''}</span></div>
            </div>

            <div className="border-t border-hampton-mauve/15 pt-2 space-y-1">
              {rate && (
                <div className="flex justify-between"><span className="text-hampton-navy/70">{rate.lineItemLabel}</span><span className="text-hampton-navy">{formatMoney(rentalCents)}</span></div>
              )}
              {Object.keys(selected).map(id => {
                const it = allItems.find(i => i.id === id)
                if (!it) return null
                const qtyLabel = it.price_type === 'per_person' ? ` × ${guestCount}` : selected[id] > 1 ? ` × ${selected[id]}` : ''
                return (
                  <div key={id} className="flex justify-between">
                    <span className="text-hampton-navy/70">{it.name}{qtyLabel}</span>
                    <span className="text-hampton-navy">{formatMoney(itemLineTotal(it, selected[id]))}</span>
                  </div>
                )
              })}
            </div>

            <div className="border-t border-hampton-mauve/15 mt-2 pt-2 space-y-1">
              <div className="flex justify-between font-semibold"><span className="text-hampton-navy">Total</span><span className="text-hampton-navy">{formatMoney(charge?.total ?? totalCents)}</span></div>
              <div className="flex justify-between"><span className="text-hampton-navy/70">Deposit today (25%)</span><span className="text-hampton-navy">{formatMoney(depositNow)}</span></div>
              <div className="flex justify-between"><span className="text-hampton-navy/70">Card fee (3%)</span><span className="text-hampton-navy">{formatMoney(cardFeeNow)}</span></div>
              <div className="flex justify-between font-bold border-t border-hampton-mauve/15 pt-1 mt-1"><span className="text-hampton-navy">Charged today</span><span className="text-hampton-navy">{formatMoney(chargedTodayCents)}</span></div>
              <div className="flex justify-between text-xs text-hampton-navy/50 pt-1"><span>Balance due 7 days before event</span><span>{formatMoney(balanceNow)}</span></div>
            </div>
          </div>

          <div ref={checkoutRef} className="min-h-[120px]" />
          {!checkoutReady && <p className="text-hampton-navy/50 text-sm">Loading secure payment…</p>}
          {checkoutReady && (
            <button onClick={confirmPayment} disabled={confirming}
              className="btn-primary w-full mt-5 py-3 disabled:opacity-60">
              {confirming ? 'Processing…' : `Pay ${formatMoney(chargedTodayCents)}`}
            </button>
          )}
          {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
        </section>
      )}

      {/* Sticky summary footer (build phase) */}
      {phase === 'build' && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-hampton-pink/20 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] z-40">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
            <div className="text-sm">
              <div className="text-hampton-navy/60">
                Rental {rate ? formatMoney(rentalCents) : '—'}{addOnTotal > 0 ? ` + add-ons ${formatMoney(addOnTotal)}` : ''}
              </div>
              <div className="text-hampton-navy font-bold">
                Total {formatMoney(totalCents)} · Deposit today {formatMoney(depositCents)}
              </div>
            </div>
            <button onClick={reserve} disabled={reserving}
              className="btn-primary px-6 py-3 disabled:opacity-50 whitespace-nowrap">
              {reserving ? 'Reserving…' : 'Reserve & Sign'}
            </button>
          </div>
          {error && <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-3 text-red-600 text-sm">{error}</div>}
        </div>
      )}
    </div>
  )
}
