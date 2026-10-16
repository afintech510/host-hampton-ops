'use client'

import { useState } from 'react'
import { Send, CheckCircle } from 'lucide-react'
import { trackLead } from '@/lib/gtag'
import { getAttribution } from '@/lib/utm'
import HeardAboutSelect, { heardAboutFields } from '@/components/HeardAboutSelect'
import { DRAFT_PARTY_EVENT_TYPE, DRAFT_PARTY_SOURCE_PAGE, DRAFT_PACKAGES } from '@/lib/draftParty'

const DRAFT_STYLES = [
  'Online — everyone on laptops',
  'Live draft board (stickers / paper)',
  'Auction draft',
  'Not sure yet',
]

const inputClass =
  'w-full border border-hampton-pink/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-pink/40'
const labelClass = 'block text-xs font-medium text-hampton-navy uppercase tracking-wide mb-1'

/**
 * The /fantasy-football-draft-party inquiry. Posts to /api/lead like
 * RoomRentalLeadForm does, so the lead lands in the same contact, plan, agent
 * and owner-SMS path — only the copy and the two draft-specific questions
 * differ, and those ride in `notes` (the commissioner's answers, verbatim).
 */
export default function DraftPartyLeadForm() {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    preferredDate: '',
    leagueSize: '',
    draftStyle: '',
    packageChoice: '',
    notes: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [consent, setConsent] = useState(false)
  const [heardAbout, setHeardAbout] = useState('')
  const [heardAboutNote, setHeardAboutNote] = useState('')

  const set = (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    const notes = [
      form.packageChoice ? `Package: ${form.packageChoice}` : null,
      form.draftStyle ? `Draft style: ${form.draftStyle}` : null,
      form.notes.trim() || null,
    ].filter(Boolean).join('\n')

    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName,
          email: form.email,
          phone: form.phone,
          preferredDate: form.preferredDate || undefined,
          guestCount: form.leagueSize || undefined,
          eventType: DRAFT_PARTY_EVENT_TYPE,
          notes: notes || undefined,
          sourcePage: DRAFT_PARTY_SOURCE_PAGE,
          marketingConsent: consent,
          attribution: getAttribution(),
          ...heardAboutFields(heardAbout, heardAboutNote),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Something went wrong')
      }

      setSubmitted(true)
      trackLead('draft-party', form.email)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="bg-white rounded-2xl border border-hampton-pink/20 p-10 shadow-sm text-center">
        <CheckCircle size={48} className="mx-auto text-green-500 mb-4" />
        <h3 className="font-serif text-2xl text-hampton-navy mb-3">
          You&apos;re on the clock, {form.fullName.split(' ')[0]}.
        </h3>
        <p className="text-hampton-navy/70">
          We got your draft night request and sent a confirmation to <strong>{form.email}</strong>.
          We&apos;ll text or call within 24 hours to lock in your night.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-2xl border border-hampton-pink/20 p-6 sm:p-8 shadow-sm space-y-4"
    >
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>
            Commissioner&apos;s name <span className="text-hampton-pink">*</span>
          </label>
          <input type="text" required value={form.fullName} onChange={set('fullName')} placeholder="Mike Russo" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>
            Phone <span className="text-hampton-pink">*</span>
          </label>
          <input type="tel" required value={form.phone} onChange={set('phone')} placeholder="(631) 555-0123" className={inputClass} />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>
            Email <span className="text-hampton-pink">*</span>
          </label>
          <input type="email" required value={form.email} onChange={set('email')} placeholder="you@email.com" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Draft night</label>
          <input type="date" value={form.preferredDate} onChange={set('preferredDate')} className={inputClass} />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Teams in the league</label>
          <input type="number" min="2" max="40" value={form.leagueSize} onChange={set('leagueSize')} placeholder="e.g. 12" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>How you draft</label>
          <select value={form.draftStyle} onChange={set('draftStyle')} className={`${inputClass} bg-white`}>
            <option value="">Select one (optional)</option>
            {DRAFT_STYLES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass}>Package</label>
        <select value={form.packageChoice} onChange={set('packageChoice')} className={`${inputClass} bg-white`}>
          <option value="">Select one (optional)</option>
          {DRAFT_PACKAGES.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
          <option value="Not sure — send me both">Not sure — send me both</option>
        </select>
      </div>

      <div>
        <label className={labelClass}>Anything else?</label>
        <textarea
          rows={3}
          maxLength={1000}
          value={form.notes}
          onChange={set('notes')}
          placeholder="Start time, a backup night, food preferences…"
          className={inputClass}
        />
      </div>

      <HeardAboutSelect
        value={heardAbout}
        note={heardAboutNote}
        onChange={setHeardAbout}
        onNoteChange={setHeardAboutNote}
      />

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

      {error && <p className="text-red-600 text-sm text-center">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="btn-primary w-full text-center flex items-center justify-center gap-2 py-3"
      >
        <Send size={16} />
        {submitting ? 'Sending...' : 'Request My Draft Night'}
      </button>

      <p className="text-xs text-hampton-navy/50 text-center">
        No payment now. We confirm availability first, then a deposit holds your night.
      </p>
    </form>
  )
}
