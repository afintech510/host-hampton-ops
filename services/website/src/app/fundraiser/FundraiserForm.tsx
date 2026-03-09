'use client'

import { useState } from 'react'
import { Loader2, CheckCircle } from 'lucide-react'
import { trackLead } from '@/lib/gtag'

const ORG_TYPES = [
  { value: '', label: 'Select your organization type...' },
  { value: 'school', label: 'School / PTA' },
  { value: 'team', label: 'Sports Team' },
  { value: 'dance', label: 'Dance Studio / Cheer' },
  { value: 'church', label: 'Church / Faith Group' },
  { value: 'other', label: 'Other Organization' },
]

const QTY_RANGES = [
  { value: '', label: 'Estimated items to sell...' },
  { value: '25–49', label: '25–49 items' },
  { value: '50–99', label: '50–99 items' },
  { value: '100–199', label: '100–199 items' },
  { value: '200+', label: '200+ items' },
  { value: 'not sure', label: 'Not sure yet' },
]

export default function FundraiserForm() {
  const [organizationName, setOrganizationName] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [organizationType, setOrganizationType] = useState('')
  const [estimatedQuantity, setEstimatedQuantity] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [consent, setConsent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!organizationName || !contactName || !email) {
      setError('Organization name, your name, and email are required.')
      return
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/fundraiser-inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationName,
          contactName,
          email,
          phone: phone || null,
          organizationType: organizationType || null,
          estimatedQuantity: estimatedQuantity || null,
          message: message || null,
          marketingConsent: consent,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Something went wrong')

      trackLead('fundraiser', email)
      setSubmitted(true)
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="bg-white rounded-2xl border border-hampton-pink/20 p-8 text-center">
        <CheckCircle size={48} className="text-green-500 mx-auto mb-4" />
        <h3 className="font-serif text-2xl text-hampton-navy mb-2">Request Received!</h3>
        <p className="text-hampton-mauve text-base mb-4">
          We'll design a custom mockup for <strong className="text-hampton-navy">{organizationName}</strong> and
          send it to <strong className="text-hampton-navy">{email}</strong> within 24 hours.
        </p>
        <p className="text-hampton-mauve text-sm">
          Questions? Call or text us at{' '}
          <a href="tel:6319989325" className="text-hampton-navy font-semibold hover:underline">
            (631) 998-9325
          </a>
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-hampton-pink/20 p-8">
      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="form-label">Organization Name *</label>
          <input
            type="text"
            value={organizationName}
            onChange={e => setOrganizationName(e.target.value)}
            required
            className="form-input"
            placeholder="e.g. Lincoln Elementary PTA"
          />
        </div>
        <div>
          <label className="form-label">Your Name *</label>
          <input
            type="text"
            value={contactName}
            onChange={e => setContactName(e.target.value)}
            required
            className="form-input"
            placeholder="Your full name"
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="form-label">Email *</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="form-input"
            placeholder="you@email.com"
          />
        </div>
        <div>
          <label className="form-label">Phone</label>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            className="form-input"
            placeholder="(optional)"
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="form-label">Organization Type</label>
          <select
            value={organizationType}
            onChange={e => setOrganizationType(e.target.value)}
            className="form-input"
          >
            {ORG_TYPES.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label">Estimated Quantity</label>
          <select
            value={estimatedQuantity}
            onChange={e => setEstimatedQuantity(e.target.value)}
            className="form-input"
          >
            {QTY_RANGES.map(q => (
              <option key={q.value} value={q.value}>{q.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-5">
        <label className="form-label">Message</label>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          className="form-input min-h-[80px]"
          placeholder="Tell us about your fundraiser — any details, timeline, or questions (optional)"
          rows={3}
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
        <p className="text-red-600 text-sm mb-4 bg-red-50 p-3 rounded-lg">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="btn-primary w-full py-4 text-center flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {loading ? 'Submitting...' : 'Request Your Free Mockup'}
      </button>
    </form>
  )
}
