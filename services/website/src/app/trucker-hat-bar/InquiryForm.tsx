'use client'

import { useState } from 'react'
import { Loader2, CheckCircle } from 'lucide-react'
import { trackContact } from '@/lib/gtag'

const c = {
  oat:      '#F5F0EB',
  cream:    '#FDFBF9',
  espresso: '#3C2A21',
  rose:     '#C9A5A5',
  roseLight:'#E8D5D5',
  warmGray: '#8C7B72',
}

const eventTypes = [
  'Brand Activation',
  'Corporate Event',
  'Product Launch',
  'Holiday Party',
  'Trade Show',
  'Private Event',
  'Other',
]

export default function InquiryForm() {
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [consent, setConsent] = useState(false)

  if (submitted) {
    return (
      <div
        className="rounded-3xl p-12 text-center"
        style={{ background: c.cream, border: `1px solid ${c.roseLight}` }}
      >
        <CheckCircle size={48} className="mx-auto mb-4" style={{ color: '#4ade80' }} />
        <p
          className="text-3xl mb-4"
          style={{ fontFamily: 'var(--font-cormorant), serif', fontWeight: 500, color: c.espresso }}
        >
          Thank You
        </p>
        <p className="text-base" style={{ color: c.warmGray, fontWeight: 300 }}>
          We&apos;ve received your inquiry. Our team will be in touch within 24 hours to discuss your vision.
        </p>
      </div>
    )
  }

  return (
    <form
      className="rounded-3xl p-8 md:p-10 space-y-6"
      style={{ background: c.cream, border: `1px solid ${c.roseLight}` }}
      onSubmit={async (e) => {
        e.preventDefault()
        setSubmitting(true)
        setError('')

        const form = e.currentTarget
        const data = new FormData(form)

        try {
          const res = await fetch('/api/trucker-inquiry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: data.get('name'),
              email: data.get('email'),
              phone: data.get('phone') || null,
              company: data.get('company') || null,
              eventType: data.get('eventType') || null,
              date: data.get('date') || null,
              guests: data.get('guests') || null,
              vision: data.get('vision') || null,
              marketingConsent: consent,
            }),
          })

          if (!res.ok) {
            const d = await res.json().catch(() => ({}))
            throw new Error(d.error || 'Something went wrong')
          }

          setSubmitted(true)
          trackContact('inquiry_form')
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
        } finally {
          setSubmitting(false)
        }
      }}
    >
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="block text-xs tracking-[0.15em] uppercase mb-2" style={{ color: c.warmGray, fontWeight: 500 }}>
            Your Name *
          </label>
          <input
            name="name"
            type="text"
            required
            placeholder="Jane Smith"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
            style={{ border: `1px solid ${c.roseLight}`, background: c.oat, color: c.espresso }}
          />
        </div>
        <div>
          <label className="block text-xs tracking-[0.15em] uppercase mb-2" style={{ color: c.warmGray, fontWeight: 500 }}>
            Email *
          </label>
          <input
            name="email"
            type="email"
            required
            placeholder="jane@agency.com"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
            style={{ border: `1px solid ${c.roseLight}`, background: c.oat, color: c.espresso }}
          />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="block text-xs tracking-[0.15em] uppercase mb-2" style={{ color: c.warmGray, fontWeight: 500 }}>
            Phone
          </label>
          <input
            name="phone"
            type="tel"
            placeholder="(555) 123-4567"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
            style={{ border: `1px solid ${c.roseLight}`, background: c.oat, color: c.espresso }}
          />
        </div>
        <div>
          <label className="block text-xs tracking-[0.15em] uppercase mb-2" style={{ color: c.warmGray, fontWeight: 500 }}>
            Company / Brand
          </label>
          <input
            name="company"
            type="text"
            placeholder="Agency or brand name"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
            style={{ border: `1px solid ${c.roseLight}`, background: c.oat, color: c.espresso }}
          />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="block text-xs tracking-[0.15em] uppercase mb-2" style={{ color: c.warmGray, fontWeight: 500 }}>
            Event Type
          </label>
          <select
            name="eventType"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all appearance-none"
            style={{ border: `1px solid ${c.roseLight}`, background: c.oat, color: c.espresso }}
          >
            <option value="">Select...</option>
            {eventTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs tracking-[0.15em] uppercase mb-2" style={{ color: c.warmGray, fontWeight: 500 }}>
            Estimated Date
          </label>
          <input
            name="date"
            type="text"
            placeholder="e.g. March 2026 or TBD"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
            style={{ border: `1px solid ${c.roseLight}`, background: c.oat, color: c.espresso }}
          />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="block text-xs tracking-[0.15em] uppercase mb-2" style={{ color: c.warmGray, fontWeight: 500 }}>
            Expected Guests
          </label>
          <input
            name="guests"
            type="text"
            placeholder="e.g. 50-100"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
            style={{ border: `1px solid ${c.roseLight}`, background: c.oat, color: c.espresso }}
          />
        </div>
        <div />
      </div>

      <div>
        <label className="block text-xs tracking-[0.15em] uppercase mb-2" style={{ color: c.warmGray, fontWeight: 500 }}>
          The Vision
        </label>
        <textarea
          name="vision"
          rows={4}
          placeholder="Tell us about the mood, the aesthetic, and the experience you're envisioning. Think moodboard energy — we'll take it from there."
          className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all resize-none"
          style={{ border: `1px solid ${c.roseLight}`, background: c.oat, color: c.espresso }}
        />
      </div>

      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={consent}
          onChange={e => setConsent(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded"
          style={{ accentColor: c.espresso }}
        />
        <span className="text-xs leading-relaxed" style={{ color: `${c.warmGray}` }}>
          I agree to receive event updates and promotions from Host Hampton via email and text message.
          Msg frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help.
          View our{' '}
          <a href="/privacy-policy" className="underline">Privacy Policy</a> &amp;{' '}
          <a href="/terms-of-service" className="underline">Terms</a>.
        </span>
      </label>

      {error && (
        <p className="text-sm text-center" style={{ color: '#dc2626' }}>{error}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-4 rounded-full text-sm tracking-[0.15em] uppercase transition-all hover:opacity-90 disabled:opacity-60"
        style={{ background: c.espresso, color: c.cream, fontWeight: 600 }}
      >
        {submitting ? 'Sending...' : 'Send Inquiry'}
      </button>

      <p className="text-center text-xs" style={{ color: `${c.warmGray}99` }}>
        We respond within 24 hours. No commitment required.
      </p>
    </form>
  )
}
