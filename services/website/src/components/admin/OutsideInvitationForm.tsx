'use client'

/**
 * "+ Outside-venue invitation": make a digital invitation for a client's event at a venue that is not
 * ours (a baby shower at a restaurant, a retirement party at a hall). It posts to
 * `POST /api/admin/parties/create` with `partyType: 'outside_event'`, which screens every field
 * (`lib/evites/outsideEventCreate.ts`) and sends the client nothing. The invitation then lives on the
 * party's Invitation card like any other: look at it, pick a design, and send it from there.
 */

import { useState } from 'react'

interface Props {
  headers: HeadersInit
  /** Called after a successful create, so the Parties list can refresh. */
  onCreated: () => void
}

interface Created {
  bookingRef: string
  inviteUrl: string | null
  adminUrl: string
}

const BLANK = {
  contactName: '', contactEmail: '', contactPhone: '',
  childName: '', occasion: '', venueName: '', locationAddress: '',
  partyDate: '', partyTime: '', eventEndTime: '', guestCount: '', audience: 'guests',
}

const FIELD = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm'
const LABEL = 'block text-xs font-semibold text-gray-600 mb-1'

export default function OutsideInvitationForm({ headers, onCreated }: Props) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<Created | null>(null)

  const set = (k: keyof typeof BLANK) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  function close() {
    setOpen(false)
    setForm(BLANK)
    setError('')
    setCreated(null)
  }

  async function create() {
    setBusy(true)
    setError('')
    const res = await fetch('/api/admin/parties/create', {
      method: 'POST',
      headers: { ...Object.fromEntries(new Headers(headers).entries()), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partyType: 'outside_event',
        contactName: form.contactName,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone || undefined,
        childName: form.childName,
        occasion: form.occasion,
        venueName: form.venueName || undefined,
        locationAddress: form.locationAddress || undefined,
        partyDate: form.partyDate,
        partyTime: form.partyTime,
        eventEndTime: form.eventEndTime || undefined,
        guestCount: form.guestCount ? Number(form.guestCount) : undefined,
        audience: form.audience,
      }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(data.error || 'Could not create the invitation')
      return
    }
    setCreated({ bookingRef: data.bookingRef, inviteUrl: data.inviteUrl ?? null, adminUrl: data.adminUrl })
    onCreated()
  }

  const ready = form.contactName && form.contactEmail && form.childName && form.occasion && form.partyDate && form.partyTime && (form.venueName || form.locationAddress)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 border border-[#1a2744] text-[#1a2744] rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors"
      >
        + Outside-venue invitation
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={close}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b sticky top-0 bg-white rounded-t-2xl flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#1a2744]">New outside-venue invitation</h2>
              <button type="button" onClick={close} aria-label="Close" className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>

            {created ? (
              <div className="p-6 space-y-3 text-sm">
                <p className="font-semibold text-green-700">Created {created.bookingRef}. Nothing was sent.</p>
                {created.inviteUrl ? (
                  <p>Invitation page: <a className="underline" href={created.inviteUrl} target="_blank" rel="noopener noreferrer">{created.inviteUrl}</a></p>
                ) : (
                  <p className="text-amber-700">The invitation page is not set up yet. It appears within a few minutes; open the party to check.</p>
                )}
                <p>Open the party in Parties, look at the invitation on its Invitation card, then send it to the client from there.</p>
                <p className="text-gray-500">This is not one of our own parties: it is not on the studio calendar, the crew schedule or the money reports.</p>
                <div className="flex gap-2 pt-2">
                  <a className="px-4 py-2 bg-[#1a2744] text-white rounded-lg text-sm font-semibold" href={created.adminUrl}>Open the party</a>
                  <button type="button" onClick={close} className="px-4 py-2 border rounded-lg text-sm">Close</button>
                </div>
              </div>
            ) : (
              <form className="p-6 space-y-4" onSubmit={e => { e.preventDefault(); if (ready && !busy) void create() }}>
                <p className="text-xs text-gray-500">For a client&apos;s event somewhere else. It makes only the invitation and its RSVP page, and sends the client nothing.</p>

                <fieldset className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <legend className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-1">Client (gets the invitation link)</legend>
                  <div><label className={LABEL} htmlFor="oi-name">Name</label><input id="oi-name" className={FIELD} value={form.contactName} onChange={set('contactName')} autoComplete="off" /></div>
                  <div><label className={LABEL} htmlFor="oi-email">Email</label><input id="oi-email" type="email" className={FIELD} value={form.contactEmail} onChange={set('contactEmail')} autoComplete="off" /></div>
                  <div><label className={LABEL} htmlFor="oi-phone">Phone</label><input id="oi-phone" type="tel" className={FIELD} value={form.contactPhone} onChange={set('contactPhone')} autoComplete="off" /></div>
                </fieldset>

                <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <legend className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-1">The event</legend>
                  <div><label className={LABEL} htmlFor="oi-honoree">Honoree&apos;s name on the invitation</label><input id="oi-honoree" className={FIELD} value={form.childName} onChange={set('childName')} placeholder="Maeghan" /></div>
                  <div><label className={LABEL} htmlFor="oi-occasion">What is it?</label><input id="oi-occasion" className={FIELD} value={form.occasion} onChange={set('occasion')} placeholder="Baby Shower" maxLength={40} /></div>
                  <div><label className={LABEL} htmlFor="oi-venue">Venue name</label><input id="oi-venue" className={FIELD} value={form.venueName} onChange={set('venueName')} placeholder="James Joyce" maxLength={60} /></div>
                  <div><label className={LABEL} htmlFor="oi-address">Street address</label><input id="oi-address" className={FIELD} value={form.locationAddress} onChange={set('locationAddress')} placeholder="49 S Ocean Ave, Patchogue, NY 11772" /></div>
                </fieldset>

                <fieldset className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <legend className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-1">When, and who</legend>
                  <div className="col-span-2 sm:col-span-1"><label className={LABEL} htmlFor="oi-date">Date</label><input id="oi-date" type="date" className={FIELD} value={form.partyDate} onChange={set('partyDate')} /></div>
                  <div><label className={LABEL} htmlFor="oi-start">Starts</label><input id="oi-start" type="time" className={FIELD} value={form.partyTime} onChange={set('partyTime')} /></div>
                  <div><label className={LABEL} htmlFor="oi-end">Ends</label><input id="oi-end" type="time" className={FIELD} value={form.eventEndTime} onChange={set('eventEndTime')} /></div>
                  <div><label className={LABEL} htmlFor="oi-count">Guests (optional)</label><input id="oi-count" type="number" min="1" max="500" className={FIELD} value={form.guestCount} onChange={set('guestCount')} /></div>
                  <div>
                    <label className={LABEL} htmlFor="oi-audience">Guests are</label>
                    <select id="oi-audience" className={FIELD} value={form.audience} onChange={set('audience')}>
                      <option value="guests">Adults</option>
                      <option value="kids">Kids</option>
                    </select>
                  </div>
                </fieldset>

                {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

                <div className="flex gap-2 justify-end pt-2">
                  <button type="button" onClick={close} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                  <button type="submit" disabled={!ready || busy} className="px-4 py-2 bg-[#1a2744] text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                    {busy ? 'Creating…' : 'Create invitation'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
