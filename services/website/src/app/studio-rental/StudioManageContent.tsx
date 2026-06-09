'use client'

import { useState, useMemo, useRef, useCallback } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Clock, Users, Plus, Minus, Check, CalendarDays } from 'lucide-react'
import type { PricingItem } from '@/components/QuoteBuilder/types'
import {
  studioRentalRate, hoursBetween, STUDIO_MIN_HOURS, STUDIO_SEATED_CAPACITY, STUDIO_STANDING_CAPACITY,
} from '@/lib/studioRental'
import { formatMoney, calculateCardFee } from '@/lib/partyPricing'

export interface ManageBooking {
  bookingRef: string
  partyDate: string
  startTime: string
  endTime: string
  guestCount: number
  seatingNeeded: number | null
  eventType: string
  contactName: string
  contactEmail: string
  contactPhone: string
  status: string
  totalCents: number
  balanceDueCents: number
  lineItems: { pricing_item_id: string | null; name: string; category: string; quantity: number; unit_price_cents: number; price_type: string; guest_multiplied: boolean }[]
  payments: { payment_type: string; payment_method: string; amount_cents: number; paid_at: string }[]
}

interface Menu { decor: PricingItem[]; services: PricingItem[]; food: PricingItem[]; desserts: PricingItem[]; beverages: PricingItem[] }

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
const timeLabel = (v: string) => TIME_OPTIONS.find(t => t.value === v)?.label || v
function dateLabel(d: string): string {
  if (!d) return ''
  const [y, m, dd] = d.split('-').map(Number)
  return new Date(y, m - 1, dd).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export default function StudioManageContent({ booking, menu }: { booking: ManageBooking; menu: Menu }) {
  const groups = useMemo(() => ([
    { key: 'decor', label: 'Decor', items: menu.decor },
    { key: 'services', label: 'Services', items: menu.services },
    { key: 'food', label: 'Food', items: menu.food },
    { key: 'desserts', label: 'Desserts & Treats', items: menu.desserts },
    { key: 'beverages', label: 'Beverages', items: menu.beverages },
  ]).filter(g => g.items.length > 0), [menu])
  const allItems = useMemo(() => [...menu.decor, ...menu.services, ...menu.food, ...menu.desserts, ...menu.beverages], [menu])

  // Reconstruct current add-on selections from the booking's line items.
  const initialSelected = useMemo(() => {
    const sel: Record<string, number> = {}
    for (const li of booking.lineItems) {
      if (li.category === 'rental' || !li.pricing_item_id) continue
      if (allItems.some(i => i.id === li.pricing_item_id)) sel[li.pricing_item_id] = li.quantity
    }
    return sel
  }, [booking.lineItems, allItems])

  const paidCents = useMemo(() => {
    let p = 0
    for (const x of booking.payments) { if (x.payment_type === 'refund') p -= x.amount_cents; else p += x.amount_cents }
    return p
  }, [booking.payments])

  const [startTime, setStartTime] = useState(booking.startTime)
  const [endTime, setEndTime] = useState(booking.endTime)
  const [guestCount, setGuestCount] = useState(booking.guestCount)
  const [seatingNeeded, setSeatingNeeded] = useState(booking.seatingNeeded != null ? String(booking.seatingNeeded) : '')
  const [selected, setSelected] = useState<Record<string, number>>(initialSelected)

  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [savedKey, setSavedKey] = useState('') // snapshot of last-saved edit state
  // Authoritative figures after a save (else fall back to booking + live preview).
  const [serverBalance, setServerBalance] = useState(booking.balanceDueCents)

  // ── live preview pricing ──
  const hours = useMemo(() => Math.max(STUDIO_MIN_HOURS, hoursBetween(startTime, endTime)), [startTime, endTime])
  const rate = useMemo(() => studioRentalRate(booking.partyDate, hours), [booking.partyDate, hours])
  const itemTotal = useCallback((it: PricingItem, qty: number) => it.price_type === 'per_person' ? it.price_cents * guestCount : it.price_cents * qty, [guestCount])
  const addOnTotal = useMemo(() => {
    let s = 0
    for (const id of Object.keys(selected)) { const it = allItems.find(i => i.id === id); if (it) s += itemTotal(it, selected[id]) }
    return s
  }, [selected, allItems, itemTotal])
  const previewTotal = rate.rentalCents + addOnTotal
  const previewBalance = Math.max(0, previewTotal - paidCents)
  const previewCredit = Math.max(0, paidCents - previewTotal)

  const editKey = useMemo(
    () => JSON.stringify({ startTime, endTime, guestCount, seatingNeeded, selected }),
    [startTime, endTime, guestCount, seatingNeeded, selected],
  )
  const initialKey = useMemo(
    () => JSON.stringify({ startTime: booking.startTime, endTime: booking.endTime, guestCount: booking.guestCount, seatingNeeded: booking.seatingNeeded != null ? String(booking.seatingNeeded) : '', selected: initialSelected }),
    [booking, initialSelected],
  )
  const dirty = editKey !== (savedKey || initialKey)

  const overStanding = guestCount > STUDIO_STANDING_CAPACITY
  const timeValid = hoursBetween(startTime, endTime) >= STUDIO_MIN_HOURS

  function toggle(it: PricingItem) {
    setSelected(prev => { const n = { ...prev }; if (n[it.id] != null) delete n[it.id]; else n[it.id] = 1; return n })
  }
  function setQty(id: string, q: number) { setSelected(prev => ({ ...prev, [id]: Math.max(1, q) })) }

  function buildLineItems() {
    return Object.keys(selected).map(id => {
      const it = allItems.find(i => i.id === id)!
      return {
        pricing_item_id: it.id, name: it.name, category: it.category,
        quantity: it.price_type === 'per_person' ? 1 : selected[id],
        unit_price_cents: it.price_cents, price_type: it.price_type,
        guest_multiplied: it.price_type === 'per_person',
      }
    })
  }

  const save = useCallback(async (over?: { endTime?: string }): Promise<boolean> => {
    setSaveMsg('')
    if (!timeValid) { setSaveMsg('Minimum rental is 3 hours.'); return false }
    if (overStanding) { setSaveMsg(`Over our ${STUDIO_STANDING_CAPACITY}-guest capacity — please call us.`); return false }
    setSaving(true)
    try {
      const res = await fetch('/api/studio-rental/edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startTime, endTime: over?.endTime ?? endTime, guestCount,
          seatingNeeded: seatingNeeded ? parseInt(seatingNeeded, 10) : null,
          lineItems: buildLineItems(),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setSaveMsg(data.error || 'Could not save changes.'); return false }
      setServerBalance(data.balanceCents)
      setSavedKey(JSON.stringify({ startTime, endTime: over?.endTime ?? endTime, guestCount, seatingNeeded, selected }))
      setSaveMsg(data.balanceCents > 0 ? `Saved — balance now ${formatMoney(data.balanceCents)}.` : data.creditCents > 0 ? `Saved — account credit ${formatMoney(data.creditCents)}.` : 'Saved — paid in full.')
      return true
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Something went wrong.'); return false
    } finally { setSaving(false) }
  }, [startTime, endTime, guestCount, seatingNeeded, selected, timeValid, overStanding]) // eslint-disable-line react-hooks/exhaustive-deps

  // Add-time upsell: extend end time by N hours and save immediately.
  async function addHours(n: number) {
    const idx = TIME_OPTIONS.findIndex(t => t.value === endTime)
    const newIdx = Math.min(TIME_OPTIONS.length - 1, idx + n * 2) // 2 slots per hour
    const newEnd = TIME_OPTIONS[newIdx].value
    setEndTime(newEnd)
    await save({ endTime: newEnd })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ── balance payment (in-page Stripe Payment Element via /api/portal/pay) ──
  const stripeRef = useRef<Awaited<ReturnType<typeof loadStripe>> | null>(null)
  const elementsRef = useRef<ReturnType<NonNullable<Awaited<ReturnType<typeof loadStripe>>>['elements']> | null>(null)
  const paymentElementRef = useRef<{ mount: (el: HTMLElement) => void; unmount: () => void } | null>(null)
  const piIdRef = useRef<string | null>(null)
  const checkoutRef = useRef<HTMLDivElement | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  const [payReady, setPayReady] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [payError, setPayError] = useState('')

  const balanceCardFee = calculateCardFee(serverBalance)

  async function startPayment() {
    setPayError(''); setPayOpen(true)
    try {
      const res = await fetch('/api/portal/pay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents: serverBalance, paymentMethod: 'card', paymentType: 'final', embedded: true }),
      })
      const data = await res.json()
      if (!res.ok || !data.clientSecret) { setPayError(data.error || 'Could not start payment.'); return }
      piIdRef.current = data.paymentIntentId || null
      const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
      if (!key) { setPayError('Payment configuration error.'); return }
      const stripe = await loadStripe(key)
      if (!stripe) { setPayError('Failed to load payment processor.'); return }
      const elements = stripe.elements({
        clientSecret: data.clientSecret,
        appearance: { theme: 'stripe', variables: { colorPrimary: '#1a2744', fontFamily: 'Georgia, serif', borderRadius: '10px' } },
      })
      const pe = elements.create('payment', { layout: 'tabs' })
      stripeRef.current = stripe; elementsRef.current = elements
      setPayReady(true)
      setTimeout(() => { if (checkoutRef.current) { pe.mount(checkoutRef.current); paymentElementRef.current = pe as unknown as { mount: (el: HTMLElement) => void; unmount: () => void } } }, 50)
    } catch (e) { setPayError(e instanceof Error ? e.message : 'Payment error.') }
  }

  async function confirmPayment() {
    setPayError('')
    if (!stripeRef.current || !elementsRef.current) { setPayError('Payment form not ready.'); return }
    setConfirming(true)
    try {
      const { error } = await stripeRef.current.confirmPayment({ elements: elementsRef.current, confirmParams: {}, redirect: 'if_required' })
      if (error) { setPayError(error.message || 'Payment was declined.'); setConfirming(false); return }
      if (piIdRef.current) {
        await fetch('/api/party-builder/confirm-session', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_intent: piIdRef.current }),
        }).catch(() => {})
      }
      window.location.reload()
    } catch (e) { setPayError(e instanceof Error ? e.message : 'Payment failed'); setConfirming(false) }
  }

  const liveTotal = previewTotal
  const isPaidInFull = !dirty && serverBalance === 0 && previewCredit === 0

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <div className="text-center mb-8">
        <h1 className="font-serif text-3xl font-bold text-hampton-navy mb-1">Manage your booking</h1>
        <p className="text-hampton-navy/60 text-sm">{booking.bookingRef} · {booking.contactName}</p>
      </div>

      {/* Date + time + guests */}
      <section className="bg-white rounded-2xl border border-hampton-pink/20 p-6 mb-6">
        <h2 className="font-serif text-lg font-bold text-hampton-navy mb-4 flex items-center gap-2"><CalendarDays size={18} /> Date &amp; time</h2>
        <p className="text-sm text-hampton-navy/70 mb-4">{dateLabel(booking.partyDate)} <span className="text-hampton-navy/40">(to change the date, contact us)</span></p>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-hampton-navy flex items-center gap-1"><Clock size={14} /> Start (includes setup)</span>
            <select value={startTime} onChange={e => setStartTime(e.target.value)} className="mt-1 w-full rounded-lg border border-hampton-mauve/30 px-3 py-2 text-hampton-navy bg-white">
              {TIME_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-hampton-navy flex items-center gap-1"><Clock size={14} /> End (includes cleanup)</span>
            <select value={endTime} onChange={e => setEndTime(e.target.value)} className="mt-1 w-full rounded-lg border border-hampton-mauve/30 px-3 py-2 text-hampton-navy bg-white">
              {TIME_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-hampton-navy flex items-center gap-1"><Users size={14} /> Guests</span>
            <input type="number" min={1} max={STUDIO_STANDING_CAPACITY} value={guestCount} onChange={e => setGuestCount(parseInt(e.target.value || '0', 10))} className="mt-1 w-full rounded-lg border border-hampton-mauve/30 px-3 py-2 text-hampton-navy" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-hampton-navy flex items-center gap-1"><Users size={14} /> Seating needed</span>
            <input type="number" min={0} max={STUDIO_SEATED_CAPACITY} value={seatingNeeded} onChange={e => setSeatingNeeded(e.target.value)} placeholder={`Up to ${STUDIO_SEATED_CAPACITY} seated`} className="mt-1 w-full rounded-lg border border-hampton-mauve/30 px-3 py-2 text-hampton-navy" />
          </label>
        </div>
        <div className="mt-3 text-sm">
          {!timeValid && <span className="text-red-600">Minimum rental is {STUDIO_MIN_HOURS} hours.</span>}
          {timeValid && <span className="text-hampton-navy"><strong>{rate.isWeekend ? 'Weekend' : 'Weekday'} · {hours} hrs</strong> → rental {formatMoney(rate.rentalCents)}</span>}
          {overStanding && <span className="text-red-600 ml-3">Over {STUDIO_STANDING_CAPACITY}-guest capacity.</span>}
        </div>
      </section>

      {/* Add-ons */}
      {groups.length > 0 && (
        <section className="bg-white rounded-2xl border border-hampton-pink/20 p-6 mb-6">
          <h2 className="font-serif text-lg font-bold text-hampton-navy mb-4">Add-ons</h2>
          <div className="space-y-6">
            {groups.map(group => (
              <div key={group.key}>
                <h3 className="text-xs font-bold tracking-[0.2em] uppercase text-hampton-mauve mb-3">{group.label}</h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  {group.items.map(item => {
                    const isSel = selected[item.id] != null
                    const qty = selected[item.id] || 1
                    const perPerson = item.price_type === 'per_person'
                    const perHour = item.price_type === 'per_hour'
                    return (
                      <div key={item.id} className={`rounded-xl border p-4 ${isSel ? 'border-hampton-pink bg-hampton-pink/5' : 'border-hampton-mauve/15 bg-hampton-ivory/30'}`}>
                        <button type="button" onClick={() => toggle(item)} className="w-full text-left flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-hampton-navy text-sm">{item.emoji ? `${item.emoji} ` : ''}{item.name}</p>
                            {item.description && <p className="text-hampton-navy/50 text-xs mt-0.5">{item.description}</p>}
                          </div>
                          <div className="text-right shrink-0">
                            <span className="font-bold text-hampton-navy text-sm">{item.price_label || formatMoney(item.price_cents)}</span>
                            <span className="block text-[11px] text-hampton-navy/50">{perPerson ? '/ guest' : perHour ? '/ hour' : 'each'}</span>
                          </div>
                        </button>
                        {isSel && !perPerson && (
                          <div className="mt-3 flex items-center gap-3">
                            <span className="text-xs text-hampton-navy/60">{perHour ? 'Hours' : 'Qty'}</span>
                            <button type="button" onClick={() => setQty(item.id, qty - 1)} className="w-7 h-7 rounded-full border border-hampton-mauve/30 flex items-center justify-center text-hampton-navy"><Minus size={14} /></button>
                            <span className="w-6 text-center text-sm text-hampton-navy">{qty}</span>
                            <button type="button" onClick={() => setQty(item.id, qty + 1)} className="w-7 h-7 rounded-full border border-hampton-mauve/30 flex items-center justify-center text-hampton-navy"><Plus size={14} /></button>
                            <span className="ml-auto text-sm font-semibold text-hampton-navy">{formatMoney(itemTotal(item, qty))}</span>
                          </div>
                        )}
                        {isSel && perPerson && (
                          <div className="mt-3 flex items-center justify-between text-sm">
                            <span className="text-xs text-hampton-navy/60">× {guestCount} guests</span>
                            <span className="font-semibold text-hampton-navy">{formatMoney(itemTotal(item, 1))}</span>
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

      {/* Invoice */}
      <section className="bg-white rounded-2xl border border-hampton-pink/20 p-6 mb-6">
        <h2 className="font-serif text-lg font-bold text-hampton-navy mb-3">Invoice</h2>
        <div className="text-sm space-y-1">
          <div className="flex justify-between"><span className="text-hampton-navy/70">{rate.lineItemLabel}</span><span className="text-hampton-navy">{formatMoney(rate.rentalCents)}</span></div>
          {Object.keys(selected).map(id => { const it = allItems.find(i => i.id === id); if (!it) return null
            return <div key={id} className="flex justify-between"><span className="text-hampton-navy/70">{it.name}{it.price_type === 'per_person' ? ` × ${guestCount}` : selected[id] > 1 ? ` × ${selected[id]}` : ''}</span><span className="text-hampton-navy">{formatMoney(itemTotal(it, selected[id]))}</span></div> })}
          <div className="flex justify-between font-semibold border-t border-hampton-mauve/15 pt-1 mt-1"><span className="text-hampton-navy">Total</span><span className="text-hampton-navy">{formatMoney(liveTotal)}</span></div>
          <div className="flex justify-between"><span className="text-hampton-navy/60">Paid so far</span><span className="text-hampton-navy/70">{formatMoney(paidCents)}</span></div>
          {previewCredit > 0
            ? <div className="flex justify-between font-bold text-emerald-700"><span>Account credit</span><span>{formatMoney(previewCredit)}</span></div>
            : <div className="flex justify-between font-bold"><span className="text-hampton-navy">Balance due</span><span className="text-hampton-navy">{formatMoney(previewBalance)}</span></div>}
        </div>

        {/* Payment history */}
        {booking.payments.length > 0 && (
          <div className="mt-4 border-t border-hampton-mauve/15 pt-3">
            <p className="text-xs font-bold uppercase tracking-wide text-hampton-mauve mb-2">Payments</p>
            {booking.payments.map((p, i) => (
              <div key={i} className="flex justify-between text-xs text-hampton-navy/60 py-0.5">
                <span>{p.payment_type} · {p.payment_method} · {new Date(p.paid_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                <span>{formatMoney(p.amount_cents)}</span>
              </div>
            ))}
          </div>
        )}

        <button onClick={() => save()} disabled={saving || !dirty}
          className="btn-primary w-full mt-5 py-3 disabled:opacity-50">
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </button>
        {saveMsg && <p className="text-sm mt-2 text-hampton-navy">{saveMsg}</p>}
      </section>

      {/* Pay balance + add-time upsell */}
      {!isPaidInFull && serverBalance > 0 && (
        <section className="bg-white rounded-2xl border border-hampton-pink/20 p-6">
          <h2 className="font-serif text-lg font-bold text-hampton-navy mb-2">Pay your balance</h2>
          {dirty && <p className="text-sm text-hampton-mauve mb-3">Save your changes above first, then pay the updated balance.</p>}

          {/* Add extra time upsell */}
          <div className="bg-hampton-ivory/50 rounded-xl border border-hampton-mauve/15 p-3 mb-4">
            <p className="text-sm font-medium text-hampton-navy mb-2">Need more time? Add it now:</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => addHours(1)} disabled={saving} className="text-sm rounded-full border border-hampton-pink px-4 py-1.5 text-hampton-navy hover:bg-hampton-pink/10 disabled:opacity-50">➕ 1 hour (+{formatMoney(rate.isWeekend ? 10000 : 7500)})</button>
              <button type="button" onClick={() => addHours(2)} disabled={saving} className="text-sm rounded-full border border-hampton-pink px-4 py-1.5 text-hampton-navy hover:bg-hampton-pink/10 disabled:opacity-50">➕ 2 hours (+{formatMoney((rate.isWeekend ? 10000 : 7500) * 2)})</button>
            </div>
          </div>

          {!payOpen && (
            <button onClick={startPayment} disabled={dirty}
              className="btn-primary w-full py-3 disabled:opacity-50">
              Pay {formatMoney(serverBalance + balanceCardFee)} (incl. 3% card fee)
            </button>
          )}
          {payOpen && (
            <>
              <div ref={checkoutRef} className="min-h-[120px]" />
              {!payReady && <p className="text-hampton-navy/50 text-sm">Loading secure payment…</p>}
              {payReady && (
                <button onClick={confirmPayment} disabled={confirming} className="btn-primary w-full mt-4 py-3 disabled:opacity-60">
                  {confirming ? 'Processing…' : `Pay ${formatMoney(serverBalance + balanceCardFee)}`}
                </button>
              )}
            </>
          )}
          {payError && <p className="text-red-600 text-sm mt-3">{payError}</p>}
        </section>
      )}

      {isPaidInFull && (
        <section className="bg-white rounded-2xl border border-hampton-pink/20 p-6 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-hampton-pink/20 flex items-center justify-center"><Check className="text-hampton-navy" size={24} /></div>
          <p className="font-serif text-lg font-bold text-hampton-navy">You're all paid up 🎉</p>
          <p className="text-hampton-navy/60 text-sm mt-1">Your studio is reserved for {dateLabel(booking.partyDate)}, {timeLabel(startTime)}–{timeLabel(endTime)}.</p>
        </section>
      )}
    </div>
  )
}
