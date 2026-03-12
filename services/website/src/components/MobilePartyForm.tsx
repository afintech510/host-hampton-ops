'use client'

import { useState, useEffect } from 'react'
import { Send, CheckCircle } from 'lucide-react'
import { trackContact } from '@/lib/gtag'
import { captureUtm, getUtmParams } from '@/lib/utm'

export default function MobilePartyForm() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', date: '', details: '' })
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { captureUtm() }, [])

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/mobile-party-inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, marketingConsent: consent, utm: getUtmParams() }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Something went wrong')
      }

      setSubmitted(true)
      trackContact('form')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="bg-white rounded-2xl border border-hampton-pink/20 p-8 shadow-sm text-center">
        <CheckCircle size={44} className="mx-auto text-green-500 mb-4" />
        <h3 className="font-serif text-2xl text-hampton-navy mb-2">Request Sent!</h3>
        <p className="text-hampton-navy/70 text-sm leading-relaxed">
          Thanks, {form.name.split(' ')[0]}! We&apos;ll get back to you within 24 hours with a custom quote.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-hampton-pink/20 p-6 shadow-sm">
      <h2 className="font-serif text-2xl text-hampton-navy mb-1">Book Your Mobile Party</h2>
      <p className="text-hampton-navy/60 text-sm mb-5">Tell us about your event and we&apos;ll put together a custom quote.</p>
      <form className="space-y-4" onSubmit={handleSubmit}>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-hampton-navy uppercase tracking-wide mb-1">
              Your Name <span className="text-hampton-pink">*</span>
            </label>
            <input
              type="text"
              required
              value={form.name}
              onChange={set('name')}
              placeholder="Jane Smith"
              className="w-full border border-hampton-pink/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-pink/40"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-hampton-navy uppercase tracking-wide mb-1">
              Phone
            </label>
            <input
              type="tel"
              value={form.phone}
              onChange={set('phone')}
              placeholder="(631) 555-0100"
              className="w-full border border-hampton-pink/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-pink/40"
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
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
          <div>
            <label className="block text-xs font-medium text-hampton-navy uppercase tracking-wide mb-1">
              Event Date
            </label>
            <input
              type="date"
              value={form.date}
              onChange={set('date')}
              className="w-full border border-hampton-pink/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-pink/40"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-hampton-navy uppercase tracking-wide mb-1">
            Tell Us About Your Event <span className="text-hampton-pink">*</span>
          </label>
          <textarea
            required
            rows={4}
            value={form.details}
            onChange={set('details')}
            placeholder="Where is your party? How many guests? Which stations are you interested in? Any themes or special requests?"
            className="w-full border border-hampton-pink/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-pink/40 resize-none"
          />
        </div>

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={consent}
            onChange={e => setConsent(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-hampton-mauve/40 text-hampton-navy focus:ring-hampton-blue"
          />
          <span className="text-xs text-hampton-navy/60 leading-relaxed">
            I agree to receive updates and promotions from Host Hampton via email and text.
            Msg &amp; data rates may apply. Reply STOP to opt out.{' '}
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
          className="btn-primary w-full text-center flex items-center justify-center gap-2"
        >
          <Send size={16} />
          {submitting ? 'Sending...' : 'Send My Request'}
        </button>
      </form>
    </div>
  )
}
