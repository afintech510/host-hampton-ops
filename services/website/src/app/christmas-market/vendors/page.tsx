'use client'

/**
 * Vendor registration for the Christmas Market.
 *
 * NOT PROMOTED — Adam's requirement. This page is `noindex` (see layout.tsx),
 * is absent from the sitemap, and is linked from nowhere on the public site.
 * It exists to be sent directly to vendors Adam wants.
 *
 * The Venmo details are NOT in this bundle. They arrive in the response to a
 * successful POST, which is what makes "complete the form to reveal the Venmo
 * credentials" a real gate rather than a `hidden` class anyone can toggle. That
 * also means the registration is captured BEFORE the handle is handed over,
 * which is the half of the requirement that actually earns money back.
 */

import { useState } from 'react'
import {
  CHRISTMAS_MARKET_2026 as MARKET,
  VENDOR_CATEGORIES,
  VENDOR_EXCLUSIONS,
  VENDOR_CATEGORY_POLICY,
  marketPricing,
  formatMarketMoney,
} from '@/lib/christmasMarket'

interface VenmoReveal {
  handle: string
  deepLink: string
  amount: string
  note: string
  confirmPhone: string
  qrSrc: string
}

/**
 * Two prices, because Venmo does not carry the card processing fee — the same
 * rule `components/VenmoOption.tsx` has always applied everywhere else on the
 * site. The vendor sees both before choosing, so the cheaper option is never a
 * surprise discovered after paying.
 */
const CARD = marketPricing(MARKET, 'card')
const VENMO = marketPricing(MARKET, 'venmo')

export default function ChristmasMarketVendorPage() {
  const [form, setForm] = useState({
    contactName: '',
    businessName: '',
    igHandle: '',
    email: '',
    phone: '',
    productCategory: '',
    productDescription: '',
    boothNote: '',
    needsElectricity: false,
    paymentMethod: 'card' as 'card' | 'venmo',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [venmo, setVenmo] = useState<VenmoReveal | null>(null)
  const [vendorRef, setVendorRef] = useState('')
  const [waitlistMsg, setWaitlistMsg] = useState('')

  const set =
    (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/christmas-market/vendor', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, marketSlug: MARKET.slug }),
      })
      const data = await res.json()

      if (data.url) {
        window.location.href = data.url
        return
      }
      if (data.venmo) {
        setVenmo(data.venmo)
        setVendorRef(data.vendorRef || '')
        setSubmitting(false)
        return
      }
      if (data.waitlist) {
        setWaitlistMsg(data.message || 'You are on the waitlist.')
        setVendorRef(data.vendorRef || '')
        setSubmitting(false)
        return
      }
      setError(data.error || 'Something went wrong. Please try again.')
      setSubmitting(false)
    } catch {
      setError('Something went wrong. Please try again, or text us at (631) 998-9325.')
      setSubmitting(false)
    }
  }

  // ── Venmo revealed ────────────────────────────────────────────────────────
  if (venmo) {
    return (
      <Shell title="Almost there — send your booth fee">
        <div style={card}>
          <p style={{ ...bodyText, marginBottom: 20 }}>
            Your details are saved{vendorRef ? <> under ref <strong style={{ color: '#1a2744' }}>{vendorRef}</strong></> : null}.
            Your booth is held once we receive the payment.
          </p>

          <div style={{ background: '#F7F2E8', borderRadius: 12, padding: 24, textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 6, fontFamily: 'sans-serif' }}>Send</div>
            <div style={{ fontSize: 34, fontWeight: 'bold', color: '#1a2744', fontFamily: 'Georgia, serif' }}>
              ${venmo.amount}
            </div>
            <div style={{ fontSize: 15, color: '#1a2744', marginTop: 8, fontFamily: 'sans-serif' }}>
              to <strong>{venmo.handle}</strong>
            </div>

            <img
              src={venmo.qrSrc}
              alt="Host Hampton Venmo QR code"
              style={{ width: 168, height: 168, margin: '20px auto 8px', display: 'block', borderRadius: 10, border: '1px solid rgba(26,39,68,0.12)' }}
            />

            <a
              href={venmo.deepLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-block', background: '#3D95CE', color: 'white', fontWeight: 'bold',
                padding: '13px 30px', borderRadius: 50, textDecoration: 'none', fontSize: 15,
                fontFamily: 'sans-serif', marginTop: 10,
              }}
            >
              Open Venmo &amp; pay ${venmo.amount}
            </a>

            <p style={{ fontSize: 12.5, color: '#666', marginTop: 16, lineHeight: 1.6, fontFamily: 'sans-serif' }}>
              Put <strong style={{ color: '#1a2744' }}>{venmo.note}</strong> in the Venmo note so we can match it to you.
            </p>
          </div>

          <p style={{ ...bodyText, fontSize: 13.5, color: '#666' }}>
            The Venmo account is under <strong style={{ color: '#1a2744' }}>{venmo.confirmPhone}</strong> — if Venmo asks you
            to confirm the last digits of the phone number, that&rsquo;s the one. Once it lands we&rsquo;ll email your
            confirmation and booth details.
          </p>
        </div>
      </Shell>
    )
  }

  // ── Waitlisted ────────────────────────────────────────────────────────────
  if (waitlistMsg) {
    return (
      <Shell title="You're on the waitlist">
        <div style={card}>
          <p style={{ ...bodyText, marginBottom: 16 }}>{waitlistMsg}</p>
          {vendorRef && (
            <p style={{ ...bodyText, fontSize: 13.5, color: '#666' }}>
              Your ref is <strong style={{ color: '#1a2744' }}>{vendorRef}</strong>. Nothing has been charged.
            </p>
          )}
        </div>
      </Shell>
    )
  }

  // ── The form ──────────────────────────────────────────────────────────────
  return (
    <Shell
      title={<>Vendor Booth<br />Registration</>}
      subtitle={`${MARKET.shortName} · ${MARKET.dateLabel} · ${MARKET.timeLabel}`}
      badge={
        <div style={{ display: 'inline-block', background: 'white', borderRadius: 12, padding: '14px 32px', boxShadow: '0 2px 12px rgba(26,39,68,0.10)' }}>
          <div style={{ color: '#1a2744', fontSize: 24, fontWeight: 'bold', fontFamily: 'Georgia, serif' }}>
            {formatMarketMoney(MARKET.boothFeeCents)}
          </div>
          <div style={{ color: '#555', fontSize: 12, fontFamily: 'sans-serif', marginTop: 3 }}>
            per booth &middot; no sales tax
          </div>
          <div style={{ color: '#888', fontSize: 11.5, fontFamily: 'sans-serif', marginTop: 6, lineHeight: 1.5 }}>
            {formatMarketMoney(VENMO.totalCents)} flat by Venmo &middot;{' '}
            {formatMarketMoney(CARD.totalCents)} by card
            <br />
            (the extra {formatMarketMoney(MARKET.cardFeeCents)} is card processing)
          </div>
        </div>
      }
    >
      {/* What vendors need to know before they pay */}
      <div style={{ ...card, marginBottom: 20, background: '#FFFDF7' }}>
        <h2 style={{ fontSize: 16, color: '#1a2744', fontFamily: 'Georgia, serif', fontWeight: 'normal', margin: '0 0 14px' }}>
          Before you register
        </h2>
        {/* `listStyle` is explicit because Tailwind's preflight sets
            `list-style: none` on every ul, so these render as bare lines
            without it — and the whole point of this block is that it scans as
            a checklist before somebody pays. */}
        <ul style={{ margin: 0, paddingLeft: 20, listStyle: 'disc', color: '#555', fontSize: 14, lineHeight: 1.85, fontFamily: 'sans-serif' }}>
          <li><strong style={{ color: '#1a2744' }}>Bring your own table.</strong> Tables are not provided.</li>
          <li>Electricity is available — tick the box below if you need it.</li>
          <li>Setup from <strong style={{ color: '#1a2744' }}>9:00am</strong>, selling 10:00am–1:00pm.</li>
          <li>{VENDOR_CATEGORY_POLICY}</li>
          <li>
            We can&rsquo;t accept: {VENDOR_EXCLUSIONS.join(', ')} — these are things the studio
            offers in-house.
          </li>
        </ul>
      </div>

      <div style={card}>
        <form onSubmit={handleSubmit}>
          <Field label="Your Name">
            <input style={inputStyle} type="text" required value={form.contactName} onChange={set('contactName')} placeholder="Jane Smith" />
          </Field>

          <Field label="Business Name">
            <input style={inputStyle} type="text" required value={form.businessName} onChange={set('businessName')} placeholder="Wildflower Co." />
          </Field>

          <Field label="Instagram Handle" optional>
            <input
              style={inputStyle}
              type="text"
              value={form.igHandle}
              onChange={set('igHandle')}
              placeholder="@wildflowerco"
              onBlur={e => {
                if (e.target.value && !e.target.value.startsWith('@')) {
                  setForm(prev => ({ ...prev, igHandle: '@' + e.target.value }))
                }
              }}
            />
          </Field>

          <Field label="Email">
            <input style={inputStyle} type="email" required value={form.email} onChange={set('email')} placeholder="jane@email.com" />
          </Field>

          <Field label="Phone">
            <input style={inputStyle} type="tel" required value={form.phone} onChange={set('phone')} placeholder="(631) 555-1234" />
          </Field>

          <Field label="What do you sell?">
            <select style={inputStyle} required value={form.productCategory} onChange={set('productCategory')}>
              <option value="">Choose a category…</option>
              {VENDOR_CATEGORIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>

          <Field label="Tell us about your products">
            <textarea
              style={{ ...inputStyle, minHeight: 88, resize: 'vertical' }}
              required
              maxLength={400}
              value={form.productDescription}
              onChange={set('productDescription')}
              placeholder="Hand-poured soy candles, $18–$32, plus gift sets for the holidays."
            />
          </Field>

          <Field label="Anything else we should know?" optional>
            <textarea
              style={{ ...inputStyle, minHeight: 64, resize: 'vertical' }}
              maxLength={400}
              value={form.boothNote}
              onChange={set('boothNote')}
              placeholder="I'll have a 6ft table, and I'd love to be near the window if possible."
            />
          </Field>

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, cursor: 'pointer', fontFamily: 'sans-serif', fontSize: 14, color: '#1a2744' }}>
            <input
              type="checkbox"
              checked={form.needsElectricity}
              onChange={e => setForm(prev => ({ ...prev, needsElectricity: e.target.checked }))}
              style={{ width: 17, height: 17, accentColor: '#1a2744' }}
            />
            I need access to an electrical outlet
          </label>

          {/* ── Payment method ── */}
          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>How would you like to pay? *</label>
            <div style={{ display: 'grid', gap: 10 }}>
              {/*
                Card stays FIRST and stays the default, even though Venmo is
                cheaper for the vendor. A card booth confirms itself through the
                Stripe webhook; a Venmo booth waits on Adam opening the app and
                pressing "mark paid" in the vendor book. Defaulting nine vendors
                onto the manual path would be steering the whole market into
                reconciliation work to save each of them $2.05.

                The saving is stated plainly on the Venmo option, so anyone who
                wants it can take it.
              */}
              <PayOption
                checked={form.paymentMethod === 'card'}
                onSelect={() => setForm(prev => ({ ...prev, paymentMethod: 'card' }))}
                title={`Card — ${formatMarketMoney(CARD.totalCents)}`}
                sub={`Includes ${formatMarketMoney(MARKET.cardFeeCents)} card processing. Secure checkout via Stripe, confirmed instantly.`}
              />
              <PayOption
                checked={form.paymentMethod === 'venmo'}
                onSelect={() => setForm(prev => ({ ...prev, paymentMethod: 'venmo' }))}
                title={`Venmo — ${formatMarketMoney(VENMO.totalCents)}`}
                sub={`No processing fee — ${formatMarketMoney(MARKET.cardFeeCents)} cheaper. We'll show you the Venmo details on the next screen.`}
              />
            </div>
          </div>

          {error && (
            <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 16, textAlign: 'center', fontFamily: 'sans-serif', lineHeight: 1.6 }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              background: submitting ? '#6b7280' : '#1a2744',
              color: '#F6F1EB',
              border: 'none',
              padding: '15px 0',
              borderRadius: 50,
              fontSize: 16,
              fontWeight: 'bold',
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontFamily: 'sans-serif',
              letterSpacing: 0.5,
            }}
          >
            {/*
              The button names the price the chosen method actually costs. It
              used to say the card total on both paths, which meant a Venmo
              vendor pressed a button reading "$52.05" and then got shown a
              request for $50 — the kind of mismatch that makes someone stop and
              wonder which number is real.
            */}
            {submitting
              ? 'Saving your registration…'
              : form.paymentMethod === 'card'
                ? `Register & pay ${formatMarketMoney(CARD.totalCents)}`
                : `Register & pay ${formatMarketMoney(VENMO.totalCents)} by Venmo`}
          </button>

          <p style={{ color: '#999', fontSize: 12, textAlign: 'center', marginTop: 12, fontFamily: 'sans-serif', lineHeight: 1.5 }}>
            {MARKET.boothCapacity} booths total &middot; no sales tax
          </p>
        </form>
      </div>

      <p style={{ textAlign: 'center', color: '#888', fontSize: 13, marginTop: 24, fontFamily: 'sans-serif', lineHeight: 1.6 }}>
        Questions? Text or call{' '}
        <a href="tel:+16319989325" style={{ color: '#1a2744', fontWeight: 'bold' }}>(631) 998-9325</a>
      </p>
    </Shell>
  )
}

// ── Presentation ────────────────────────────────────────────────────────────

function Shell({
  title, subtitle, badge, children,
}: {
  title: React.ReactNode
  subtitle?: string
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  // ── NO BACKGROUNDS HERE. The body already paints the fade. ──
  //
  // globals.css puts `linear-gradient(#BCCDEB 0, #dae6f0 300px, #F7F2E8 600px)`
  // on `body`, and the layout draws the transparent→#BCCDEB band above the
  // footer. This shell used to paint over both: an opaque #F6F1EB on <main> (a
  // DIFFERENT ivory from the body's #F7F2E8), its own 420px hero gradient ending
  // against that fill, and a second pre-footer band on top of the layout's.
  // Each join was a visible line — Adam spotted it on his phone, 2026-09-25 —
  // because a gradient meeting a flat fill changes slope at the join, and the
  // eye reads that as an edge even when the colours match. Painting nothing
  // leaves one continuous gradient, and a seam cannot form.
  return (
    <main style={{ minHeight: '100vh' }}>
      <section
        style={{
          paddingTop: 'calc(5rem + 5rem)', paddingBottom: '4rem',
          textAlign: 'center', paddingLeft: 20, paddingRight: 20,
        }}
      >
        <p style={{ color: '#1a2744', opacity: 0.6, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', margin: '0 0 12px', fontFamily: 'sans-serif' }}>
          Host Hampton &middot; Speonk, NY
        </p>
        <h1 style={{ color: '#1a2744', fontSize: 38, fontFamily: 'Georgia, serif', fontWeight: 'normal', margin: '0 0 14px', lineHeight: 1.2 }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{ color: '#1a2744', opacity: 0.7, fontSize: 16, margin: '0 0 24px', fontFamily: 'sans-serif' }}>
            {subtitle}
          </p>
        )}
        {badge}
      </section>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '0 20px 60px' }}>{children}</div>
    </main>
  )
}

function PayOption({ checked, onSelect, title, sub }: { checked: boolean; onSelect: () => void; title: string; sub: string }) {
  return (
    <label
      style={{
        display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer',
        border: `2px solid ${checked ? '#1a2744' : '#E8C7CB'}`,
        background: checked ? '#FFFDF7' : '#fffef9',
        borderRadius: 10, padding: '13px 15px', fontFamily: 'sans-serif',
      }}
    >
      <input
        type="radio"
        name="paymentMethod"
        checked={checked}
        onChange={onSelect}
        style={{ marginTop: 3, width: 16, height: 16, accentColor: '#1a2744' }}
      />
      <span>
        <span style={{ display: 'block', color: '#1a2744', fontWeight: 'bold', fontSize: 14.5 }}>{title}</span>
        <span style={{ display: 'block', color: '#777', fontSize: 12.5, marginTop: 2 }}>{sub}</span>
      </span>
    </label>
  )
}

function Field({ label, children, optional }: { label: string; children: React.ReactNode; optional?: boolean }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={labelStyle}>
        {label} {optional ? <span style={{ fontWeight: 'normal', color: '#999' }}>(optional)</span> : '*'}
      </label>
      {children}
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block', color: '#1a2744', fontSize: 13, fontWeight: 'bold',
  marginBottom: 6, letterSpacing: 0.3, fontFamily: 'sans-serif',
}

const inputStyle: React.CSSProperties = {
  width: '100%', border: '2px solid #E8C7CB', borderRadius: 8, padding: '11px 14px',
  fontSize: 15, color: '#1a2744', background: '#fffef9', boxSizing: 'border-box',
  outline: 'none', fontFamily: 'sans-serif',
}

const card: React.CSSProperties = {
  background: 'white', borderRadius: 16, padding: '32px 30px',
  boxShadow: '0 4px 24px rgba(26,39,68,0.10)',
}

const bodyText: React.CSSProperties = {
  color: '#555', fontSize: 15, lineHeight: 1.7, margin: 0, fontFamily: 'sans-serif',
}
