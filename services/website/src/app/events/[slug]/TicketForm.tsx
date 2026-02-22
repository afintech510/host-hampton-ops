'use client'

import { useState } from 'react'
import { Minus, Plus, Loader2 } from 'lucide-react'

interface Variant { label: string; priceCents: number }
interface Session { id: string; session_date: string; session_time: string; available_tickets: number; price_cents?: number }
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

export default function TicketForm({ event, sessions }: { event: EventProps; sessions: Session[] }) {
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(
    event.has_variants && event.variants.length > 0 ? event.variants[0] : null
  )
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const unitPrice = selectedVariant
    ? selectedVariant.priceCents
    : selectedSession?.price_cents ?? event.price_cents
  const total = unitPrice * quantity
  const isFree = unitPrice === 0

  const maxAvail = selectedSession
    ? selectedSession.available_tickets
    : event.available_tickets
  const soldOut = maxAvail <= 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name || !email) { setError('Name and email are required.'); return }
    if (event.has_sessions && !selectedSession) { setError('Please select a date.'); return }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/events/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: event.id,
          sessionId: selectedSession?.id || null,
          quantity,
          variantLabel: selectedVariant?.label || null,
          customerName: name,
          customerEmail: email,
          customerPhone: phone || null,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Checkout failed')

      // Redirect to Stripe or success page
      window.location.href = data.url
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h3 className="font-serif text-xl text-hampton-navy mb-1">
        {isFree ? 'RSVP' : 'Get Tickets'}
      </h3>
      <p className="text-hampton-mauve text-sm mb-5">
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
                    type="radio"
                    name="variant"
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

      {/* Session selection */}
      {event.has_sessions && sessions.length > 0 && (
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
                {s.available_tickets <= 0 ? ' — Sold Out' : ` — ${s.available_tickets} spots`}
              </option>
            ))}
          </select>
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
            <span className="text-xs text-hampton-mauve">{maxAvail} available</span>
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
            <label className="form-label">Phone</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="form-input" placeholder="(optional)" />
          </div>
        </>
      )}

      {/* Total */}
      {!soldOut && !isFree && (
        <div className="flex items-center justify-between py-3 px-4 bg-hampton-ivory rounded-xl mb-5">
          <span className="text-sm text-hampton-mauve">Total</span>
          <span className="text-xl font-bold text-hampton-navy">{formatPrice(total)}</span>
        </div>
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
              : `Get Tickets — ${formatPrice(total)}`}
      </button>
    </form>
  )
}
