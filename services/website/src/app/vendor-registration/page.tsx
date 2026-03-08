'use client'

import { useState } from 'react'

export default function VendorRegistrationPage() {
  const [form, setForm] = useState({
    contactName: '',
    businessName: '',
    igHandle: '',
    email: '',
    phone: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/vendor-registration', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        setError(data.error || 'Something went wrong. Please try again.')
        setSubmitting(false)
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <main style={{ minHeight: '100vh', background: '#F6F1EB' }}>

      {/* ── Hero gradient (matches canvas-bags pattern) ── */}
      <section
        style={{
          background: 'linear-gradient(to bottom, #BCCDEB 0%, #dae6f0 220px, #F7F2E8 420px)',
          paddingTop: 'calc(5rem + 6rem)',
          paddingBottom: '5rem',
          textAlign: 'center',
          paddingLeft: 20,
          paddingRight: 20,
        }}
      >
        <p style={{ color: '#1a2744', opacity: 0.6, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', margin: '0 0 12px', fontFamily: 'sans-serif' }}>
          Host Hampton &middot; Speonk, NY
        </p>
        <h1 style={{ color: '#1a2744', fontSize: 40, fontFamily: 'Georgia, serif', fontWeight: 'normal', margin: '0 0 14px', lineHeight: 1.2 }}>
          Vendor Event<br />Registration
        </h1>
        <p style={{ color: '#1a2744', opacity: 0.7, fontSize: 16, margin: '0 0 24px', fontFamily: 'sans-serif' }}>
          Spring Market &mdash; 295 Montauk Hwy, Speonk NY
        </p>

        {/* Price badge */}
        <div style={{ display: 'inline-block', background: 'white', borderRadius: 12, padding: '14px 32px', boxShadow: '0 2px 12px rgba(26,39,68,0.10)' }}>
          <div style={{ color: '#1a2744', fontSize: 24, fontWeight: 'bold', fontFamily: 'Georgia, serif' }}>$46.35</div>
          <div style={{ color: '#555', fontSize: 12, fontFamily: 'sans-serif', marginTop: 3 }}>
            $45.00 registration + $1.35 service fee &middot; no sales tax
          </div>
        </div>
      </section>

      {/* ── Form section ── */}
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '0 20px 60px' }}>

        {/* Form Card */}
        <div style={{ background: 'white', borderRadius: 16, padding: '36px 32px', boxShadow: '0 4px 24px rgba(26,39,68,0.10)' }}>
          <form onSubmit={handleSubmit}>

            <Field label="Your Name">
              <input
                style={inputStyle}
                type="text"
                required
                value={form.contactName}
                onChange={set('contactName')}
                placeholder="Jane Smith"
              />
            </Field>

            <Field label="Business Name">
              <input
                style={inputStyle}
                type="text"
                required
                value={form.businessName}
                onChange={set('businessName')}
                placeholder="Wildflower Co."
              />
            </Field>

            <Field label="Instagram Handle">
              <input
                style={inputStyle}
                type="text"
                required
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
              <input
                style={inputStyle}
                type="email"
                required
                value={form.email}
                onChange={set('email')}
                placeholder="jane@email.com"
              />
            </Field>

            <Field label="Phone" last>
              <input
                style={inputStyle}
                type="tel"
                required
                value={form.phone}
                onChange={set('phone')}
                placeholder="(631) 555-1234"
              />
            </Field>

            {error && (
              <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 16, textAlign: 'center', fontFamily: 'sans-serif' }}>
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
                transition: 'background 0.2s',
              }}
            >
              {submitting ? 'Redirecting to checkout...' : 'Register & Pay $46.35'}
            </button>

            <p style={{ color: '#999', fontSize: 12, textAlign: 'center', marginTop: 12, fontFamily: 'sans-serif', lineHeight: 1.5 }}>
              Secure checkout via Stripe &nbsp;&middot;&nbsp; No sales tax
            </p>
          </form>
        </div>

        {/* Footer note */}
        <p style={{ textAlign: 'center', color: '#888', fontSize: 13, marginTop: 24, fontFamily: 'sans-serif', lineHeight: 1.6 }}>
          Questions? Text or call us at{' '}
          <a href="tel:+16319989325" style={{ color: '#1a2744', fontWeight: 'bold' }}>
            (631) 998-9325
          </a>
        </p>
      </div>  {/* end form section */}

      {/* ── Bottom gradient fade → footer (mirrors root layout pattern) ── */}
      <div style={{ height: 160, background: 'linear-gradient(to bottom, #F7F2E8, #BCCDEB)' }} aria-hidden="true" />
    </main>
  )
}

function Field({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ marginBottom: last ? 28 : 20 }}>
      <label style={{
        display: 'block',
        color: '#1a2744',
        fontSize: 13,
        fontWeight: 'bold',
        marginBottom: 6,
        letterSpacing: 0.3,
        fontFamily: 'sans-serif',
      }}>
        {label} *
      </label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '2px solid #E8C7CB',
  borderRadius: 8,
  padding: '11px 14px',
  fontSize: 15,
  color: '#1a2744',
  background: '#fffef9',
  boxSizing: 'border-box',
  outline: 'none',
  fontFamily: 'sans-serif',
}
