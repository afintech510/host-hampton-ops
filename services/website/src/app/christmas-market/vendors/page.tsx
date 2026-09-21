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
  marketTotalCents,
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

const TOTAL = marketTotalCents(MARKET)

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
            {formatMarketMoney(TOTAL)}
          </div>
          <div style={{ color: '#555', fontSize: 12, fontFamily: 'sans-serif', marginTop: 3 }}>
            {formatMarketMoney(MARKET.boothFeeCents)} booth + {formatMarketMoney(MARKET.serviceFeeCents)} processing &middot; no sales tax
          </div>
        </div>
      }
    >
      {/* What vendors need to know before they pay */}
      <div style={{ ...card, marginBottom: 20, background: '#FFFDF7' }}>
        <h2 style={{ fontSize: 16, color: '#1a2744', fontFamily: 'Georgia, serif', fontWeight: 'normal', margin: '0 0 14px' }}>
          Before you register
        </h2>
        <ul style={{ margin: 0, paddingLeft: 18, color: '#555', fontSize: 14, lineHeight: 1.85, fontFamily: 'sans-serif' }}>
          <li><strong style={{ color: '#1a2744' }}>Bring your own table.</strong> Tables are not provided.</li>
          <li>Electricity is available — tick the box below if you need it.</li>
          <li>Setup from <strong style={{ color: '#1a2744' }}>9:00am</strong>, selling 10:00am–1:00pm.</li>
          <li>{VENDOR_CATEGORY_POLICY}</li>
          <li>
            We can&rsquo;t accept: {VENDOR_EXCLUSIONS.join(', ')} — these are things the studio
            offers in-house, and we don&rsquo;t want to compete with you.
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
              <PayOption
                checked={form.paymentMethod === 'card'}
                onSelect={() => setForm(prev => ({ ...prev, paymentMethod: 'card' }))}
                title={`Card — ${formatMarketMoney(TOTAL)}`}
                sub="Secure checkout via Stripe. Instant confirmation."
              />
              <PayOption
                checked={form.paymentMethod === 'venmo'}
                onSelect={() => setForm(prev => ({ ...prev, paymentMethod: 'venmo' }))}
                title={`Venmo — ${formatMarketMoney(TOTAL)}`}
                sub="We'll show you the Venmo details on the next screen."
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
            {submitting
              ? 'Saving your registration…'
              : form.paymentMethod === 'card'
                ? `Register & pay ${formatMarketMoney(TOTAL)}`
                : 'Register & show me the Venmo details'}
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
  return (
    <main style={{ minHeight: '100vh', background: '#F6F1EB' }}>
      <section
        style={{
          background: 'linear-gradient(to bottom, #BCCDEB 0%, #dae6f0 220px, #F7F2E8 420px)',
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

      <div style={{ height: 160, background: 'linear-gradient(to bottom, #F7F2E8, #BCCDEB)' }} aria-hidden="true" />
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
