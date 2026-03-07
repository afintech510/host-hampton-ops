'use client'

import { useState, useEffect } from 'react'
import { Send, CheckCircle } from 'lucide-react'
import { trackContact } from '@/lib/gtag'
import { captureUtm, getUtmParams } from '@/lib/utm'

export default function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' })
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
      const res = await fetch('/api/contact', {
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
      <div className="bg-white rounded-2xl border border-hampton-pink/20 p-6 shadow-sm text-center">
        <CheckCircle size={40} className="mx-auto text-green-500 mb-3" />
        <h3 className="font-serif text-xl text-hampton-navy mb-2">Message Sent!</h3>
        <p className="text-hampton-navy/70 text-sm">
          Thanks, {form.name.split(' ')[0]}! We&apos;ll get back to you within 24 hours.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-hampton-pink/20 p-6 shadow-sm">
      <h2 className="font-serif text-2xl text-hampton-navy mb-5">Send a Message</h2>
      <form className="space-y-4" onSubmit={handleSubmit}>
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
            Phone
          </label>
          <input
            type="tel"
            value={form.phone}
            onChange={set('phone')}
            placeholder="(optional)"
            className="w-full border border-hampton-pink/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-pink/40"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-hampton-navy uppercase tracking-wide mb-1">
            Message <span className="text-hampton-pink">*</span>
          </label>
          <textarea
            required
            rows={4}
            value={form.message}
            onChange={set('message')}
            placeholder="Tell us about your event..."
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
          className="btn-primary w-full text-center flex items-center justify-center gap-2"
        >
          <Send size={16} />
          {submitting ? 'Sending...' : 'Send Message'}
        </button>
      </form>
    </div>
  )
}
