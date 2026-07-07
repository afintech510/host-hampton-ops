'use client'

import { useState } from 'react'
import { Minus, Plus, Loader2, ShoppingCart } from 'lucide-react'
import { useCart } from '@/context/CartContext'

interface Variant { label: string; priceCents: number; seats?: number }
interface BundleTier { minSessions: number; pricePerSessionCents: number }
interface Session { id: string; session_date: string; session_time: string; label?: string; available_tickets: number; max_tickets?: number; price_cents?: number }
interface EventProps {
  id: string
  slug: string
  title: string
  price_cents: number
  has_variants: boolean
  variants: Variant[]
  has_sessions: boolean
  available_tickets: number
  max_tickets: number
  allow_multi_session?: boolean
  bundle_pricing?: BundleTier[]
  imageUrl?: string | null
  event_date?: string | null
  event_time?: string | null
}

function formatPrice(cents: number): string {
  if (cents === 0) return 'Free'
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

function formatSessionDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function availabilityLabel(available: number, max: number): string {
  if (available <= 0) return 'Sold Out'
  const pct = available / max
  if (pct <= 0.1) return 'Almost Gone'
  if (pct <= 0.3) return 'Limited Spots'
  if (pct <= 0.6) return 'Selling Fast'
  return 'Spots Available'
}

function getBundlePrice(sessionCount: number, tiers: BundleTier[]): number | null {
  if (!tiers || tiers.length === 0) return null
  const sorted = [...tiers].sort((a, b) => b.minSessions - a.minSessions)
  const tier = sorted.find(t => sessionCount >= t.minSessions)
  return tier ? tier.pricePerSessionCents : null
}

export default function TicketForm({ event, sessions }: { event: EventProps; sessions: Session[] }) {
  const { addItem } = useCart()
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(
    event.has_variants && event.variants.length > 0 ? event.variants[0] : null
  )
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [selectedSessions, setSelectedSessions] = useState<Session[]>([])
  const [quantity, setQuantity] = useState(1)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [giftCardCode, setGiftCardCode] = useState('')
  const [giftCardValid, setGiftCardValid] = useState<{ code: string; balanceCents: number; balanceFormatted: string } | null>(null)
  const [giftCardError, setGiftCardError] = useState('')
  const [giftCardLoading, setGiftCardLoading] = useState(false)

  const isMultiSession = event.allow_multi_session && event.has_sessions

  // Price calculation
  let unitPrice: number
  let total: number

  if (isMultiSession && selectedSessions.length > 0) {
    unitPrice = getBundlePrice(selectedSessions.length, event.bundle_pricing || []) ?? event.price_cents
    total = unitPrice * selectedSessions.length * quantity
  } else if (selectedVariant) {
    unitPrice = selectedVariant.priceCents
    total = unitPrice * quantity
  } else if (selectedSession?.price_cents != null) {
    unitPrice = selectedSession.price_cents
    total = unitPrice * quantity
  } else {
    unitPrice = event.price_cents
    total = unitPrice * quantity
  }

  const isFree = unitPrice === 0

  // Tax + CC fee (only for paid events)
  const TAX_RATE = 0.0875
  const CC_RATE = 0.03
  const taxCents = isFree ? 0 : Math.round(total * TAX_RATE)
  const ccFeeCents = isFree ? 0 : Math.round((total + taxCents) * CC_RATE)
  // Gift card discount
  const giftCardDiscountCents = giftCardValid
    ? Math.min(giftCardValid.balanceCents, total + taxCents + ccFeeCents)
    : 0
  const grandTotal = total + taxCents + ccFeeCents - giftCardDiscountCents

  const maxAvail = isMultiSession
    ? Math.min(...(selectedSessions.length > 0 ? selectedSessions.map(s => s.available_tickets) : [event.available_tickets]))
    : selectedSession
      ? selectedSession.available_tickets
      : event.available_tickets
  const soldOut = maxAvail <= 0

  function toggleSession(session: Session) {
    setSelectedSessions(prev =>
      prev.some(s => s.id === session.id)
        ? prev.filter(s => s.id !== session.id)
        : [...prev, session]
    )
  }

  async function handleApplyGiftCard() {
    if (!giftCardCode.trim()) return
    setGiftCardLoading(true)
    setGiftCardError('')
    setGiftCardValid(null)
    try {
      const res = await fetch('/api/gift-cards/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: giftCardCode.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Invalid gift card')
      setGiftCardValid(data)
    } catch (err: any) {
      setGiftCardError(err.message || 'Invalid gift card')
    } finally {
      setGiftCardLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name || !email) { setError('Name and email are required.'); return }
    if (event.has_sessions && !isMultiSession && !selectedSession) { setError('Please select a date.'); return }
    if (isMultiSession && selectedSessions.length === 0) { setError('Please select at least one session.'); return }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/events/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: event.id,
          sessionId: selectedSession?.id || null,
          sessionIds: isMultiSession ? selectedSessions.map(s => s.id) : null,
          quantity,
          variantLabel: selectedVariant?.label || null,
          customerName: name,
          customerEmail: email,
          customerPhone: phone || null,
          marketingConsent,
          giftCardCode: giftCardValid?.code || null,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Checkout failed')

      window.location.href = data.url
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  // Bundle pricing info for display
  const bundleTiers = event.bundle_pricing || []
  const showBundleInfo = isMultiSession && bundleTiers.length > 0

  return (
    <form onSubmit={handleSubmit}>
      <h3 className="font-serif text-xl text-hampton-navy mb-1">
        {isFree ? 'RSVP' : 'Get Tickets'}
      </h3>
      <p className="text-hampton-navy text-sm mb-5">
        {soldOut ? 'This event is sold out.' : isFree ? 'Free — reserve your spot.' : `${formatPrice(unitPrice)} per ticket`}
      </p>

      {/* Variant selection */}
      {event.has_variants && event.variants.length > 0 && (
        <div className="mb-4">
          <label className="form-label">Option</label>
          <div className="space-y-2">
            {event.variants.map((v, i) => (
              <label key={i}
                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedVariant?.label === v.label
                    ? 'border-hampton-navy bg-hampton-navy/5'
                    : 'border-hampton-pink/20 hover:border-hampton-blue/40'
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="radio" name="variant"
                    checked={selectedVariant?.label === v.label}
                    onChange={() => setSelectedVariant(v)}
                    className="accent-hampton-navy"
                  />
                  <span className="text-sm text-hampton-navy">{v.label}</span>
                </div>
                <span className="text-sm font-semibold text-hampton-navy">{formatPrice(v.priceCents)}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Single session selection (dropdown) */}
      {event.has_sessions && sessions.length > 0 && !isMultiSession && (
        <div className="mb-4">
          <label className="form-label">Select a Date</label>
          <select
            value={selectedSession?.id || ''}
            onChange={e => {
              const s = sessions.find(s => s.id === e.target.value)
              setSelectedSession(s || null)
              setQuantity(1)
            }}
            className="form-input"
            required
          >
            <option value="">Choose a date...</option>
            {sessions.map(s => (
              <option key={s.id} value={s.id} disabled={s.available_tickets <= 0}>
                {formatSessionDate(s.session_date)} at {s.session_time}
                {s.label ? ` — ${s.label}` : ''}
                {` — ${availabilityLabel(s.available_tickets, s.max_tickets || event.max_tickets)}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Multi-session selection (checkboxes) */}
      {isMultiSession && sessions.length > 0 && (
        <div className="mb-4">
          <label className="form-label">Select Your Sessions</label>

          {/* Bundle pricing info */}
          {showBundleInfo && (
            <div className="mb-3 p-3 bg-hampton-ivory rounded-lg">
              <p className="text-xs font-medium text-hampton-navy mb-1">Pricing tiers:</p>
              {[...bundleTiers].sort((a, b) => a.minSessions - b.minSessions).map((t, i) => (
                <p key={i} className="text-xs text-hampton-navy">
                  {t.minSessions === sessions.length ? 'All' : `${t.minSessions}+`} session{t.minSessions !== 1 ? 's' : ''}: <span className="font-semibold text-hampton-navy">{formatPrice(t.pricePerSessionCents)}</span>/session
                </p>
              ))}
            </div>
          )}

          <div className="space-y-2 max-h-60 overflow-y-auto">
            {sessions.map(s => {
              const isSelected = selectedSessions.some(ss => ss.id === s.id)
              const isSoldOut = s.available_tickets <= 0
              return (
                <label key={s.id}
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                    isSelected ? 'border-hampton-navy bg-hampton-navy/5' : 'border-hampton-pink/20 hover:border-hampton-blue/40'
                  } ${isSoldOut ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <input type="checkbox" checked={isSelected}
                      onChange={() => toggleSession(s)}
                      className="accent-hampton-navy" disabled={isSoldOut} />
                    <div>
                      <span className="text-sm text-hampton-navy">{formatSessionDate(s.session_date)} at {s.session_time}</span>
                      {s.label && <span className="text-xs text-hampton-navy ml-2">— {s.label}</span>}
                    </div>
                  </div>
                  <span className="text-xs text-hampton-navy">
                    {availabilityLabel(s.available_tickets, s.max_tickets || event.max_tickets)}
                  </span>
                </label>
              )
            })}
          </div>

          {/* Selected count + price */}
          {selectedSessions.length > 0 && (
            <div className="mt-3 p-3 bg-hampton-navy/5 rounded-lg">
              <p className="text-sm text-hampton-navy font-medium">
                {selectedSessions.length} session{selectedSessions.length !== 1 ? 's' : ''} selected
                {!isFree && (
                  <span className="text-hampton-navy font-normal"> — {formatPrice(unitPrice)} per session</span>
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Quantity */}
      {!soldOut && (
        <div className="mb-4">
          <label className="form-label">Quantity</label>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))}
              className="w-9 h-9 rounded-lg border border-hampton-pink/20 flex items-center justify-center hover:bg-hampton-pink/10 transition-colors"
              disabled={quantity <= 1}
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="text-lg font-semibold text-hampton-navy w-8 text-center">{quantity}</span>
            <button type="button" onClick={() => setQuantity(Math.min(maxAvail, quantity + 1))}
              className="w-9 h-9 rounded-lg border border-hampton-pink/20 flex items-center justify-center hover:bg-hampton-pink/10 transition-colors"
              disabled={quantity >= maxAvail}
            >
              <Plus className="w-4 h-4" />
            </button>
            <span className="text-xs text-hampton-navy">{availabilityLabel(maxAvail, event.max_tickets)}</span>
          </div>
        </div>
      )}

      {/* Contact info */}
      {!soldOut && (
        <>
          <div className="mb-3">
            <label className="form-label">Name *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} required className="form-input" placeholder="Your full name" />
          </div>
          <div className="mb-3">
            <label className="form-label">Email *</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="form-input" placeholder="you@email.com" />
          </div>
          <div className="mb-5">
            <label className="form-label">Phone *</label>
            <input type="tel" required value={phone} onChange={e => setPhone(e.target.value)} className="form-input" placeholder="(631) 555-1234" />
          </div>
        </>
      )}

      {/* Gift Card */}
      {!soldOut && !isFree && (
        <div className="mb-5">
          <label className="form-label">Gift Card Code</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={giftCardCode}
              onChange={e => { setGiftCardCode(e.target.value.toUpperCase()); setGiftCardValid(null); setGiftCardError('') }}
              className="form-input flex-1 font-mono tracking-wider"
              placeholder="HH-XXXX-XXXX"
            />
            <button
              type="button"
              onClick={handleApplyGiftCard}
              disabled={!giftCardCode.trim() || giftCardLoading}
              className="px-4 py-2 rounded-lg bg-hampton-navy text-white text-sm font-semibold disabled:opacity-50 hover:bg-hampton-navy/90 transition-colors shrink-0"
            >
              {giftCardLoading ? '...' : 'Apply'}
            </button>
          </div>
          {giftCardValid && (
            <p className="text-green-600 text-xs mt-1.5 font-medium">
              Gift card applied — {giftCardValid.balanceFormatted} available
            </p>
          )}
          {giftCardError && (
            <p className="text-red-500 text-xs mt-1.5">{giftCardError}</p>
          )}
        </div>
      )}

      {/* Total with tax + CC fee breakdown */}
      {!soldOut && !isFree && (
        <div className="py-3 px-4 bg-hampton-ivory rounded-xl mb-5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-hampton-navy">Subtotal</span>
            <span className="text-sm text-hampton-navy">{formatPrice(total)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-hampton-mauve">Sales Tax (8.75%)</span>
            <span className="text-xs text-hampton-mauve">{formatPrice(taxCents)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-hampton-mauve">Processing Fee (3%)</span>
            <span className="text-xs text-hampton-mauve">{formatPrice(ccFeeCents)}</span>
          </div>
          {giftCardDiscountCents > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-green-600 font-medium">Gift Card ({giftCardValid?.code})</span>
              <span className="text-xs text-green-600 font-medium">-{formatPrice(giftCardDiscountCents)}</span>
            </div>
          )}
          <div className="flex items-center justify-between pt-1.5 border-t border-hampton-navy/10">
            <span className="text-sm font-semibold text-hampton-navy">Total</span>
            <span className="text-xl font-bold text-hampton-navy">{grandTotal === 0 ? 'Free (Gift Card)' : formatPrice(grandTotal)}</span>
          </div>
        </div>
      )}

      {/* Marketing Consent */}
      {!soldOut && (
        <label className="flex items-start gap-3 cursor-pointer mb-4">
          <input
            type="checkbox"
            checked={marketingConsent}
            onChange={e => setMarketingConsent(e.target.checked)}
            className="accent-hampton-navy mt-1 shrink-0"
          />
          <span className="text-[11px] text-hampton-navy/50 leading-relaxed">
            I agree to receive event updates and promotions from Host Hampton via email and text message. Msg frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help. View our{' '}
            <a href="/privacy-policy" className="underline" target="_blank">Privacy Policy</a> &amp;{' '}
            <a href="/terms-of-service" className="underline" target="_blank">Terms</a>.
          </span>
        </label>
      )}

      {error && (
        <p className="text-red-600 text-sm mb-4 bg-red-50 p-3 rounded-lg">{error}</p>
      )}

      <button
        type="submit"
        disabled={soldOut || loading}
        className="btn-primary w-full py-4 text-center flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {soldOut
          ? 'Sold Out'
          : loading
            ? 'Processing...'
            : isFree
              ? 'RSVP — Free'
              : `Get Tickets — ${formatPrice(grandTotal)}`}
      </button>

      {/* Add to Cart — only for paid, non-sold-out events */}
      {!soldOut && !isFree && (
        <button
          type="button"
          onClick={() => {
            if (event.has_sessions && !isMultiSession && !selectedSession) {
              setError('Please select a date first.')
              return
            }
            if (isMultiSession && selectedSessions.length === 0) {
              setError('Please select at least one session.')
              return
            }

            // Build date/time display for the cart
            let dateDisplay = ''
            let timeDisplay = ''
            if (isMultiSession && selectedSessions.length > 0) {
              dateDisplay = `${selectedSessions.length} session${selectedSessions.length > 1 ? 's' : ''}`
              timeDisplay = selectedSessions.map(s =>
                `${formatSessionDate(s.session_date)} ${s.session_time}`
              ).join(', ')
            } else if (selectedSession) {
              dateDisplay = formatSessionDate(selectedSession.session_date)
              timeDisplay = selectedSession.session_time
            } else if (event.event_date) {
              dateDisplay = formatSessionDate(event.event_date)
              timeDisplay = event.event_time || ''
            }

            addItem({
              eventId: event.id,
              eventTitle: event.title,
              eventSlug: event.slug,
              sessionId: selectedSession?.id || null,
              sessionIds: isMultiSession ? selectedSessions.map(s => s.id) : null,
              quantity,
              variantLabel: selectedVariant?.label || null,
              unitPriceCents: unitPrice,
              imageUrl: event.imageUrl || null,
              dateDisplay,
              timeDisplay,
            })
            setError('')
          }}
          className="w-full mt-2 py-3 border-2 border-hampton-navy text-hampton-navy font-semibold rounded-full text-sm flex items-center justify-center gap-2 hover:bg-hampton-navy hover:text-white transition-all"
        >
          <ShoppingCart className="w-4 h-4" />
          Add to Cart
        </button>
      )}
    </form>
  )
}
