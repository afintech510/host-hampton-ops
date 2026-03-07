'use client'

import { useState, useEffect } from 'react'
import { Send, CheckCircle } from 'lucide-react'
import { trackLead } from '@/lib/gtag'
import { captureUtm, getUtmParams } from '@/lib/utm'

export default function RoomRentalLeadForm() {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    preferredDate: '',
    eventName: '',
    guestCount: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [consent, setConsent] = useState(false)

  useEffect(() => { captureUtm() }, [])

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName,
          email: form.email,
          phone: form.phone,
          preferredDate: form.preferredDate || undefined,
          guestCount: form.guestCount || undefined,
          eventType: form.eventName || 'Room Rental',
          sourcePage: 'party-room-rental',
          marketingConsent: consent,
          utm: getUtmParams(),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Something went wrong')
      }

      setSubmitted(true)
      trackLead('room-rental', form.email)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <section className="py-16 px-4 sm:px-6">
        <div className="max-w-2xl mx-auto text-center">
          <div className="bg-white rounded-2xl border border-hampton-pink/20 p-10 shadow-sm">
            <CheckCircle size={48} className="mx-auto text-green-500 mb-4" />
            <h3 className="font-serif text-2xl text-hampton-navy mb-3">
              Thank You, {form.fullName.split(' ')[0]}!
            </h3>
            <p className="text-hampton-navy/70 mb-6">
              We&apos;ve received your inquiry and sent a confirmation to <strong>{form.email}</strong>.
              Our team will be in touch within 24 hours.
            </p>
            <a
              href="/book?type=room-rental"
              className="btn-primary inline-block px-8 py-3 text-sm"
            >
              Check Availability &amp; Reserve
            </a>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="py-16 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h2 className="section-heading">Interested? Let&apos;s Talk.</h2>
          <p className="text-hampton-navy max-w-lg mx-auto">
            Tell us about your event and we&apos;ll follow up with availability, pricing details, and next steps.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl border border-hampton-pink/20 p-6 sm:p-8 shadow-sm space-y-4"
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-hampton-navy uppercase tracking-wide mb-1">
                Name <span className="text-hampton-pink">*</span>
              </label>
              <input
                type="text"
                required
                value={form.fullName}
                onChange={set('fullName')}
                placeholder="Jane Smith"
                className="w-full border border-hampton-pink/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-pink/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-hampton-navy uppercase tracking-wide mb-1">
                Email <span className="text-hampton-pink">*</span>
              </label>
              <input
                type="email"
                required
                value={form.email}
                onChange={set('email')}
                placeholder="you@email.com"
                className="w-full border border-hampton-pink/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-pink/40"
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-hampton-navy uppercase tracking-wide mb-1">
                Phone <span className="text-hampton-pink">*</span>
              </label>
              <input
                type="tel"
                required
                value={form.phone}
                onChange={set('phone')}
                placeholder="(555) 123-4567"
                className="w-full border border-hampton-pink/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-pink/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-hampton-navy uppercase tracking-wide mb-1">
                Preferred Date
              </label>
              <input
                type="date"
                value={form.preferredDate}
                onChange={set('preferredDate')}
                className="w-full border border-hampton-pink/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-pink/40"
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-hampton-navy uppercase tracking-wide mb-1">
                Event Name / Type
              </label>
              <input
                type="text"
                value={form.eventName}
                onChange={set('eventName')}
                placeholder="e.g. Birthday Party, Baby Shower"
                className="w-full border border-hampton-pink/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-pink/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-hampton-navy uppercase tracking-wide mb-1">
                Estimated Guest Count
              </label>
              <input
                type="number"
                min="1"
                max="200"
                value={form.guestCount}
                onChange={set('guestCount')}
                placeholder="e.g. 30"
                className="w-full border border-hampton-pink/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-pink/40"
              />
            </div>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={consent}
              onChange={e => setConsent(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-hampton-mauve/40 text-hampton-navy focus:ring-hampton-blue"
            />
            <span className="text-xs text-hampton-navy/60 leading-relaxed">
              I agree to receive event updates and promotions from Host Hampton via email and text message.
              Msg frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help.
              View our{' '}
              <a href="/privacy-policy" className="underline">Privacy Policy</a> &amp;{' '}
              <a href="/terms-of-service" className="underline">Terms</a>.
            </span>
          </label>

          {error && (
            <p className="text-red-600 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full text-center flex items-center justify-center gap-2 py-3"
          >
            <Send size={16} />
            {submitting ? 'Sending...' : 'Send Inquiry'}
          </button>

          <p className="text-xs text-hampton-navy/50 text-center">
            We&apos;ll send you a confirmation email with next steps and a link to reserve your date.
          </p>
        </form>
      </div>
    </section>
  )
}
