'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { parseGuestList } from '@/lib/evites/guestList'

/**
 * The host's simple RSVP management: a guest list (pasted or from a CSV file), who has answered, a text
 * link per guest that opens the HOST's own messaging app (we send nothing), and a form to add an answer
 * for someone who replied by phone. Talks to `/api/portal/invitation/guests` and `.../rsvps`.
 *
 * `onChanged` is called after any change so the parent can reload the RSVP summary above.
 */

const CARD = 'bg-white rounded-xl shadow-sm p-5 md:p-6'
const H2 = 'font-display text-lg text-[#1a2744] mb-3'
const LABEL = 'block text-sm font-medium text-[#1a2744] mb-1'
const INPUT =
  'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-[#1a2744] outline-none focus:ring-2 focus:ring-[#A1B5C8] focus:border-transparent'
const BTN =
  'flex min-h-[2.75rem] w-full items-center justify-center rounded-lg bg-[#1a2744] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2a3754] transition-colors disabled:opacity-40'
const BTN_2 =
  'flex min-h-[2.75rem] w-full items-center justify-center rounded-lg border border-[#1a2744] px-4 py-2.5 text-sm font-medium text-[#1a2744] hover:bg-gray-50 transition-colors disabled:opacity-40'
const LINK_BTN = 'text-sm text-[#1a2744] underline disabled:opacity-40'

const LOGIN = '/my-booking/login?next=/my-booking/invitation'
const GUESTS_API = '/api/portal/invitation/guests'
const RSVPS_API = '/api/portal/invitation/rsvps'

export interface HostGuestListProps {
  shareText: string
  reshareText: string
  inviteUrl: string
  audience: 'kids' | 'guests'
  onChanged: () => void
}

interface GuestItem {
  id: string
  name: string
  phone: string | null
  phoneE164: string | null
  answer: 'yes' | 'no' | null
}

interface RsvpItem {
  id: string
  status: 'yes' | 'no'
  name: string
  guests: string[]
  hasAllergy: boolean
  allergyNote: string | null
  addedByHost: boolean
}

/** `sms:+1XXXXXXXXXX?&body=...` opens the host's own messaging app (the `?&` form works on iOS and Android). */
export function smsLinkFor(phoneE164: string, body: string): string {
  return `sms:${phoneE164}?&body=${encodeURIComponent(body)}`
}

async function call(method: string, url: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  try {
    const res = await fetch(url, {
      method,
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.status === 401) {
      window.location.href = LOGIN
    }
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
    return { ok: res.ok, status: res.status, data }
  } catch {
    return { ok: false, status: 0, data: null }
  }
}

const errorOf = (r: { data: Record<string, unknown> | null }, fallback: string): string =>
  typeof r.data?.error === 'string' ? (r.data.error as string) : fallback

export default function HostGuestList({ shareText, reshareText, inviteUrl, audience, onChanged }: HostGuestListProps) {
  const [guests, setGuests] = useState<GuestItem[] | null>(null)
  const [rsvps, setRsvps] = useState<RsvpItem[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const [paste, setPaste] = useState('')
  const [adding, setAdding] = useState(false)
  const [addMsg, setAddMsg] = useState<{ tone: 'ok' | 'err'; text: string; skipped?: string[] } | null>(null)
  const [copied, setCopied] = useState(false)

  const [who, setWho] = useState('')
  const [answer, setAnswer] = useState<'yes' | 'no'>('yes')
  const [attending, setAttending] = useState('')
  const [allergy, setAllergy] = useState(false)
  const [allergyNote, setAllergyNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [rsvpMsg, setRsvpMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    const [g, r] = await Promise.all([call('GET', GUESTS_API), call('GET', RSVPS_API)])
    if (g.ok && Array.isArray(g.data?.guests)) setGuests(g.data.guests as GuestItem[])
    else if (g.status !== 401) setLoadError(errorOf(g, 'Could not load your guest list - try again.'))
    if (r.ok && Array.isArray(r.data?.rsvps)) setRsvps(r.data.rsvps as RsvpItem[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const changed = useCallback(async () => {
    await load()
    onChanged()
  }, [load, onChanged])

  const preview = useMemo(() => parseGuestList(paste), [paste])
  const phones = preview.guests.filter((g) => g.phone_e164).length

  const guestsWord = audience === 'guests' ? 'guest' : 'family'

  async function onFile(file: File | undefined) {
    if (!file) return
    if (file.size > 200_000) {
      setAddMsg({ tone: 'err', text: 'That file is too big. Please choose a CSV of names (and phone numbers).' })
      return
    }
    const text = await file.text().catch(() => '')
    setPaste(text)
    setAddMsg(null)
  }

  async function addGuests() {
    setAdding(true)
    setAddMsg(null)
    const r = await call('POST', GUESTS_API, { text: paste })
    setAdding(false)
    if (!r.ok) {
      setAddMsg({ tone: 'err', text: errorOf(r, 'Could not save your guest list - try again.') })
      return
    }
    const added = Number(r.data?.added ?? 0)
    setAddMsg({
      tone: 'ok',
      text: added === 0 ? 'Everyone in that list was already on your guest list.' : `Added ${added} ${added === 1 ? guestsWord : `${guestsWord}s`}.`,
      skipped: Array.isArray(r.data?.skipped) ? (r.data.skipped as string[]) : [],
    })
    setPaste('')
    await changed()
  }

  async function removeGuest(id: string) {
    const r = await call('DELETE', GUESTS_API, { id })
    if (!r.ok) setLoadError(errorOf(r, 'Could not remove that - try again.'))
    await changed()
  }

  async function removeAll() {
    if (!window.confirm('Remove everyone from your guest list? Answers you have already received stay as they are.')) return
    const r = await call('DELETE', GUESTS_API, { all: true })
    if (!r.ok) setLoadError(errorOf(r, 'Could not clear the list - try again.'))
    await changed()
  }

  async function removeRsvp(id: string) {
    if (!window.confirm('Remove this answer?')) return
    const r = await call('DELETE', RSVPS_API, { id })
    if (!r.ok) setRsvpMsg({ tone: 'err', text: errorOf(r, 'Could not remove that - try again.') })
    await changed()
  }

  async function saveRsvp() {
    setSaving(true)
    setRsvpMsg(null)
    const names = attending
      .split(/[,\n;]/)
      .map((n) => n.trim())
      .filter(Boolean)
    const body: Record<string, unknown> = { status: answer, parentName: who }
    if (answer === 'yes') {
      // An adult RSVP lists the person answering by their own name; "names" here are only who comes with them.
      body.children = audience === 'guests' ? names : names.length > 0 ? names : who.trim() ? [who.trim()] : []
      body.hasAllergy = allergy
      if (allergy) body.allergyNote = allergyNote
    }
    const r = await call('POST', RSVPS_API, body)
    setSaving(false)
    if (!r.ok) {
      setRsvpMsg({ tone: 'err', text: errorOf(r, 'Could not save that - try again.') })
      return
    }
    setRsvpMsg({ tone: 'ok', text: 'Saved. It now counts in your RSVPs.' })
    setWho('')
    setAttending('')
    setAllergy(false)
    setAllergyNote('')
    setAnswer('yes')
    await changed()
  }

  const waiting = (guests ?? []).filter((g) => g.answer === null)
  const body = (text: string) => `${text} ${inviteUrl}`

  async function copyReminder() {
    const text = body(reshareText)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      window.prompt('Copy this message:', text)
    }
  }

  return (
    <div className="space-y-6" data-host-tools="guest-list">
      <section aria-label="Your guest list" className={CARD}>
        <h2 className={H2}>Your guest list</h2>
        <p className="mb-3 text-sm text-gray-600">
          Paste the names of the people you are inviting, one per line. Add a phone number after a comma if you would like a quick text link
          for each person. You can also choose a spreadsheet saved as CSV. We never text your guests: the Text link opens the messaging app on your own phone.
        </p>
        <label htmlFor="hh-guest-paste" className={LABEL}>
          Names and phone numbers
        </label>
        <textarea
          id="hh-guest-paste"
          value={paste}
          onChange={(e) => {
            setPaste(e.target.value)
            setAddMsg(null)
          }}
          rows={5}
          placeholder={'Ann Lee, 631-555-0142\nBob and Carol Diaz\nGrandma June, 6315550100'}
          className={INPUT}
        />
        <div className="mt-2">
          <label htmlFor="hh-guest-file" className={`${LINK_BTN} cursor-pointer`}>
            Choose a CSV file
          </label>
          <input id="hh-guest-file" type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        {paste.trim() !== '' && (
          <p data-guest-preview="" className="mt-2 text-sm text-[#1a2744]">
            {preview.guests.length} {preview.guests.length === 1 ? 'guest' : 'guests'} found, {phones} phone {phones === 1 ? 'number' : 'numbers'},{' '}
            {preview.skipped.length} skipped
          </p>
        )}
        {preview.skipped.length > 0 && paste.trim() !== '' && (
          <ul className="mt-1 list-disc pl-5 text-xs text-amber-800">
            {preview.skipped.slice(0, 5).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <button type="button" onClick={() => void addGuests()} disabled={adding || preview.guests.length === 0} className={BTN}>
            {adding ? 'Adding…' : 'Add to my list'}
          </button>
        </div>
        {addMsg && (
          <div role={addMsg.tone === 'err' ? 'alert' : 'status'} className={`mt-2 text-sm ${addMsg.tone === 'err' ? 'text-red-600' : 'text-green-700'}`}>
            <p>{addMsg.text}</p>
            {addMsg.skipped && addMsg.skipped.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs text-amber-800">
                {addMsg.skipped.slice(0, 5).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {loadError && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {loadError}
          </p>
        )}

        {guests && guests.length > 0 && (
          <div className="mt-5">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#1a2744]">
                {guests.length} on your list &middot; {waiting.length} not yet answered
              </h3>
              <button type="button" onClick={() => void removeAll()} className={LINK_BTN}>
                Clear list
              </button>
            </div>
            <p className="mb-2 text-xs text-gray-500">&ldquo;Answered&rdquo; is matched by name, so it is a guide. If it is wrong, add or remove an answer below.</p>
            <ul data-guest-rows="" className="divide-y divide-gray-100">
              {guests.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 font-medium text-[#1a2744]">
                    {g.name}
                    {g.phone && <span className="ml-2 font-normal text-gray-500">{g.phone}</span>}
                  </span>
                  <span
                    data-guest-status={g.answer ?? 'none'}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      g.answer === 'yes' ? 'bg-green-100 text-green-800' : g.answer === 'no' ? 'bg-gray-200 text-gray-700' : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {g.answer === 'yes' ? 'Yes' : g.answer === 'no' ? 'No' : 'Not yet answered'}
                  </span>
                  {g.phoneE164 && (
                    <a href={smsLinkFor(g.phoneE164, body(g.answer === null ? reshareText : shareText))} className="text-[#1a2744] underline">
                      Text
                    </a>
                  )}
                  <button type="button" onClick={() => void removeGuest(g.id)} className="text-gray-500 underline" aria-label={`Remove ${g.name}`}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            {waiting.length > 0 && (
              <div className="mt-3">
                <button type="button" onClick={() => void copyReminder()} className={BTN_2}>
                  Copy reminder for those who haven&apos;t answered
                </button>
                {copied && (
                  <p role="status" className="mt-2 text-sm text-green-700">
                    Copied. Paste it into a group text to: {waiting.map((g) => g.name).join(', ')}.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section aria-label="Add an RSVP yourself" className={CARD}>
        <h2 className={H2}>Add an RSVP yourself</h2>
        <p className="mb-3 text-sm text-gray-600">Someone told you in person, or by call or text? Add their answer here so your count is right. Nobody is emailed or texted.</p>
        {guests && guests.length > 0 && (
          <div className="mb-3">
            <label htmlFor="hh-rsvp-pick" className={LABEL}>
              Pick from your guest list (optional)
            </label>
            <select
              id="hh-rsvp-pick"
              className={INPUT}
              value=""
              onChange={(e) => {
                const g = guests.find((x) => x.id === e.target.value)
                if (g) {
                  setWho(g.name)
                  if (audience === 'guests') setAttending(g.name)
                }
              }}
            >
              <option value="">Choose a guest…</option>
              {guests.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <label htmlFor="hh-rsvp-who" className={LABEL}>
          {audience === 'guests' ? 'Who answered? (first and last name)' : 'Who answered?'}
        </label>
        <input id="hh-rsvp-who" value={who} onChange={(e) => setWho(e.target.value)} maxLength={120} className={INPUT} />
        <fieldset className="mt-3">
          <legend className={LABEL}>Their answer</legend>
          <div className="flex gap-4 text-sm text-[#1a2744]">
            <label className="flex items-center gap-2">
              <input type="radio" name="hh-rsvp-answer" checked={answer === 'yes'} onChange={() => setAnswer('yes')} /> Coming
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="hh-rsvp-answer" checked={answer === 'no'} onChange={() => setAnswer('no')} /> Can&apos;t make it
            </label>
          </div>
        </fieldset>
        {answer === 'yes' && (
          <>
            <label htmlFor="hh-rsvp-names" className={`${LABEL} mt-3`}>
              {audience === 'guests' ? 'Anyone coming with them? (optional, names separated by commas)' : 'Who is coming? (first names, separated by commas)'}
            </label>
            <input id="hh-rsvp-names" value={attending} onChange={(e) => setAttending(e.target.value)} placeholder={audience === 'guests' ? 'Ann Lee, Bob Lee' : 'Ann, Bob'} className={INPUT} />
            <label className="mt-3 flex items-center gap-2 text-sm text-[#1a2744]">
              <input type="checkbox" checked={allergy} onChange={(e) => setAllergy(e.target.checked)} /> There is a food allergy
            </label>
            {allergy && (
              <input value={allergyNote} onChange={(e) => setAllergyNote(e.target.value)} maxLength={300} placeholder="What should we know?" aria-label="Food allergy details" className={`${INPUT} mt-2`} />
            )}
          </>
        )}
        <div className="mt-4">
          <button type="button" onClick={() => void saveRsvp()} disabled={saving || who.trim() === ''} className={BTN}>
            {saving ? 'Saving…' : 'Save this answer'}
          </button>
        </div>
        {rsvpMsg && (
          <p role={rsvpMsg.tone === 'err' ? 'alert' : 'status'} className={`mt-2 text-sm ${rsvpMsg.tone === 'err' ? 'text-red-600' : 'text-green-700'}`}>
            {rsvpMsg.text}
          </p>
        )}

        {rsvps.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-1 text-sm font-semibold text-[#1a2744]">Answers so far</h3>
            <ul data-rsvp-rows="" className="divide-y divide-gray-100">
              {rsvps.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 text-[#1a2744]">
                    {r.name} <span className="text-gray-500">{r.status === 'yes' ? '· coming' : '· can’t make it'}{r.addedByHost ? ' · added by you' : ''}</span>
                  </span>
                  <button type="button" onClick={() => void removeRsvp(r.id)} className="shrink-0 text-gray-500 underline" aria-label={`Remove the answer from ${r.name}`}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}
