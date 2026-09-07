'use client'

import { useState, useCallback } from 'react'

/**
 * Pre-arrival check-in form.
 *
 * Two steps: contact details + marketing opt-in, then the SignWell rental
 * agreement / liability waiver in their embedded modal.
 *
 * Phase 1 collects NO payment information. The $500 authorization hold is
 * Phase 2 and will use Stripe Elements — card data must reach Stripe directly
 * from the browser and must never be posted to our API, so do not add card
 * fields to the submit payload below.
 */

interface Details {
  name: string
  email: string
  phone: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
}

interface Props {
  token: string
  bookingRef: string
  partyDate: string | null
  partyTime: string | null
  childName: string | null
  checkinStatus: string
  agreementSigned: boolean
  initial: Details
}

function formatPartyDate(date: string | null): string | null {
  if (!date) return null
  // Parse as a local noon to avoid the date sliding a day across timezones.
  const d = new Date(`${date}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export default function CheckinForm({
  token, bookingRef, partyDate, partyTime, childName, checkinStatus, agreementSigned, initial,
}: Props) {
  const [details, setDetails] = useState<Details>(initial)
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [detailsSaved, setDetailsSaved] = useState(checkinStatus !== 'pending')
  const [signed, setSigned] = useState(agreementSigned)
  const [signingBusy, setSigningBusy] = useState(false)
  const [agreementUnavailable, setAgreementUnavailable] = useState(false)

  const set = (k: keyof Details) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDetails(d => ({ ...d, [k]: e.target.value }))

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const res = await fetch(`/api/checkin/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...details, marketingConsent }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error === 'expired'
          ? 'This check-in link has expired.'
          : data.error || 'Something went wrong saving your details.')
        return
      }
      setDetailsSaved(true)
    } catch {
      setError('Could not reach the server. Please check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  // SignWell's signing page sets X-Frame-Options: SAMEORIGIN, so it cannot go
  // in a raw <iframe>. Their embedded.js renders it correctly and emits the
  // `completed` event. Same approach as the studio rental flow.
  const loadSignwellScript = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      const w = window as unknown as { SignWellEmbed?: unknown }
      if (w.SignWellEmbed) return resolve()
      const id = 'signwell-embedded-js'
      const existing = document.getElementById(id)
      if (existing) {
        existing.addEventListener('load', () => resolve())
        existing.addEventListener('error', () => reject(new Error('SignWell script error')))
        return
      }
      const s = document.createElement('script')
      s.id = id
      s.src = 'https://static.signwell.com/assets/embedded.js'
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('Failed to load SignWell'))
      document.body.appendChild(s)
    })
  }, [])

  const openAgreement = useCallback(async () => {
    setError('')
    setSigningBusy(true)
    try {
      const res = await fetch(`/api/checkin/${encodeURIComponent(token)}/agreement`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))

      if (data.alreadySigned) { setSigned(true); return }
      if (data.unavailable) { setAgreementUnavailable(true); return }
      if (!res.ok || !data.signingUrl) {
        setError(data.error || 'Could not open the agreement. Please try again.')
        return
      }

      await loadSignwellScript()
      const Embed = (window as unknown as {
        SignWellEmbed: new (o: Record<string, unknown>) => { open: () => void }
      }).SignWellEmbed

      // Modal mode (no containerId) — inline embedding leaves the document
      // body blank because the iframe can't resolve a height.
      new Embed({
        url: data.signingUrl,
        allowDecline: false,
        events: {
          // Client-side signal only. The authoritative record is the webhook.
          completed: () => setSigned(true),
          error: () => setError('There was a problem loading the agreement. Please try again.'),
        },
      }).open()
    } catch {
      setError('Could not load the signing window. Please try again.')
    } finally {
      setSigningBusy(false)
    }
  }, [token, loadSignwellScript])

  const prettyDate = formatPartyDate(partyDate)

  if (signed && detailsSaved) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <h1 className="font-serif text-3xl font-bold text-hampton-navy mb-3">You&apos;re all set! 🎉</h1>
        <p className="text-hampton-navy/70 mb-6">
          Check-in is complete for <strong>{bookingRef}</strong>. We&apos;ll see you
          {prettyDate ? <> on <strong>{prettyDate}</strong></> : ' soon'}!
        </p>
        <p className="text-sm text-hampton-navy/60">
          A copy of your signed agreement has been emailed to you. A refundable $500 security hold is
          authorized on your card when you arrive.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 pb-24">
      <div className="text-center mb-8">
        <h1 className="font-serif text-3xl font-bold text-hampton-navy mb-2">Party Check-In</h1>
        <p className="text-hampton-navy/70">
          {childName ? <>{childName}&apos;s party</> : 'Your party'}
          {prettyDate ? <> — {prettyDate}</> : null}
          {partyTime ? <> at {partyTime}</> : null}
        </p>
        <p className="text-sm text-hampton-navy/50 mt-1">Booking {bookingRef}</p>
      </div>

      {error ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {/* ── Step 1: details ─────────────────────────────────── */}
      <form onSubmit={saveDetails} className="bg-hampton-ivory rounded-2xl border border-hampton-pink/20 p-6 mb-6">
        <h2 className="font-serif text-xl font-bold text-hampton-navy mb-4">
          1. Your details
          {detailsSaved ? <span className="ml-2 text-sm font-sans font-normal text-green-700">✓ saved</span> : null}
        </h2>

        <div className="space-y-4">
          <Field label="Full name" required value={details.name} onChange={set('name')} autoComplete="name" />
          <Field label="Email" required type="email" value={details.email} onChange={set('email')} autoComplete="email" />
          <Field label="Phone" type="tel" value={details.phone} onChange={set('phone')} autoComplete="tel" />
          <Field label="Address" value={details.addressLine1} onChange={set('addressLine1')} autoComplete="address-line1" />
          <Field label="Apt / unit (optional)" value={details.addressLine2} onChange={set('addressLine2')} autoComplete="address-line2" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="City" value={details.city} onChange={set('city')} autoComplete="address-level2" />
            <Field label="State" value={details.state} onChange={set('state')} autoComplete="address-level1" />
            <Field label="ZIP" value={details.postalCode} onChange={set('postalCode')} autoComplete="postal-code" />
          </div>
        </div>

        <label className="flex items-start gap-3 mt-5 text-sm text-hampton-navy/80 cursor-pointer">
          <input
            type="checkbox"
            checked={marketingConsent}
            onChange={e => setMarketingConsent(e.target.checked)}
            className="mt-1"
          />
          <span>
            Keep me posted on Host Hampton news, seasonal parties and special offers by email and text.
            Optional — unchecking this won&apos;t affect your booking, and you can reply STOP any time.
          </span>
        </label>

        <button type="submit" disabled={saving} className="btn-primary w-full mt-6 py-3 disabled:opacity-60">
          {saving ? 'Saving…' : detailsSaved ? 'Update my details' : 'Save my details'}
        </button>
      </form>

      {/* ── Step 2: agreement ───────────────────────────────── */}
      <div className="bg-hampton-ivory rounded-2xl border border-hampton-pink/20 p-6">
        <h2 className="font-serif text-xl font-bold text-hampton-navy mb-2">
          2. Rental agreement &amp; liability waiver
          {signed ? <span className="ml-2 text-sm font-sans font-normal text-green-700">✓ signed</span> : null}
        </h2>

        {signed ? (
          <p className="text-sm text-hampton-navy/70">
            Thank you — your signed copy has been emailed to you.
          </p>
        ) : agreementUnavailable ? (
          <p className="text-sm text-hampton-navy/70">
            The agreement isn&apos;t available online right now. Don&apos;t worry — we&apos;ll have a
            copy ready for you to sign when you arrive. Your details above are saved.
          </p>
        ) : (
          <>
            <p className="text-sm text-hampton-navy/70 mb-4">
              Please review and sign before your party. It opens in a secure signing window.
            </p>
            <button
              onClick={openAgreement}
              disabled={signingBusy || !detailsSaved}
              className="btn-primary w-full py-3 disabled:opacity-60"
            >
              {signingBusy ? 'Opening…' : 'Review & sign'}
            </button>
            {!detailsSaved ? (
              <p className="text-xs text-hampton-navy/50 mt-2 text-center">
                Save your details first so we can fill the agreement in for you.
              </p>
            ) : null}
          </>
        )}
      </div>

      <p className="text-xs text-hampton-navy/50 text-center mt-6">
        Can&apos;t finish now? No problem — your party goes ahead either way, and we can complete this
        when you arrive.
      </p>
    </div>
  )
}

function Field({
  label, value, onChange, type = 'text', required = false, autoComplete,
}: {
  label: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  type?: string
  required?: boolean
  autoComplete?: string
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-hampton-navy mb-1">
        {label}{required ? <span className="text-red-600"> *</span> : null}
      </span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        required={required}
        autoComplete={autoComplete}
        className="w-full rounded-lg border border-hampton-navy/20 px-3 py-2 text-hampton-navy focus:border-hampton-pink focus:outline-none focus:ring-1 focus:ring-hampton-pink"
      />
    </label>
  )
}
