'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from './Modal'

interface Options {
  role: 'lead' | 'crew'
  live: { swapId: string; asked: number } | null
  standbys: string[]
  others: string[]
}

const REASONS = [
  { value: 'sick', label: 'Sick' },
  { value: 'family', label: 'Family' },
  { value: 'school', label: 'School' },
  { value: 'other', label: 'Other' },
] as const

type View =
  | { kind: 'loading' }
  | { kind: 'error'; text: string }
  | { kind: 'ready'; options: Options }
  | { kind: 'sent'; asked: number }

/**
 * "Find Cover" on a spot you committed to. It never releases you by itself:
 * it lists who is on the waitlist and free (and, if that is nobody, who else
 * is free so you can ask them yourself), and only on your confirmation texts
 * the waitlist that a spot opened. You stay on the party until one of them
 * takes it.
 */
export default function FindCover(props: { slotId: string; partyId: string; ownerName: string; ownerPhone: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function show() {
    setOpen(true)
    setView({ kind: 'loading' })
    setError(null)
    try {
      const res = await fetch(`/api/crew/slots/${props.slotId}/cover`, { cache: 'no-store' })
      if (res.status === 401) { window.location.href = '/crew/login'; return }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setView({ kind: 'error', text: typeof data?.error === 'string' ? data.error : "We couldn't load this. Try again." }); return }
      setView({ kind: 'ready', options: data as Options })
    } catch {
      setView({ kind: 'error', text: "You're offline, or the site didn't answer. Try again." })
    }
  }

  async function send() {
    if (!reason) { setError('Pick a reason.'); return }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/crew/slots/${props.slotId}/release`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason, note }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) { window.location.href = '/crew/login'; return }
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : "That didn't work. Try again.")
        if (res.status === 409) await show()
        return
      }
      setView({ kind: 'sent', asked: typeof data?.asked === 'number' ? data.asked : 0 })
      router.refresh()
    } catch {
      setError("You're offline, or the site didn't answer. Try again.")
    } finally {
      setBusy(false)
    }
  }

  const close = () => { if (!busy) setOpen(false) }
  const allie = <>Can&apos;t find anyone? Call or text {props.ownerName} at <strong>{props.ownerPhone}</strong>.</>

  return (
    <>
      <button type="button" className="crew-btn crew-btn-ghost" onClick={show}>Find Cover</button>
      <Modal open={open} onClose={close} title="Find cover">
        {view.kind === 'loading' && <p className="crew-muted">Checking who&apos;s free…</p>}
        {view.kind === 'error' && <p role="alert" className="crew-note crew-alert">{view.text}</p>}

        {view.kind === 'sent' && (
          <>
            <p className="crew-note crew-ok" role="status">
              {view.asked > 0
                ? `Done. We let ${view.asked} ${view.asked === 1 ? 'person' : 'people'} on the waitlist know your spot is open.`
                : 'Done. The waitlist has been asked.'}
            </p>
            <p>You&apos;re still on the party until someone accepts. We&apos;ll tell you the moment they do.</p>
          </>
        )}

        {view.kind === 'ready' && view.options.live && (
          <>
            <p className="crew-note crew-info">
              We&apos;ve already asked {view.options.live.asked} {view.options.live.asked === 1 ? 'person' : 'people'} to take your spot. You&apos;re still on the party until one of them accepts.
            </p>
            <p className="crew-small"><Link className="crew-link" href={`/crew/parties/${props.partyId}/cant-make-it`}>See where it stands</Link></p>
          </>
        )}

        {view.kind === 'ready' && !view.options.live && view.options.standbys.length > 0 && (
          <>
            <p style={{ marginTop: 0 }}>
              These people are on the waitlist and free then. We&apos;ll text each of them that a spot opened up and ask them to take it.
              The first to accept gets it, and you&apos;re released.
            </p>
            <ul className="crew-team" aria-label="On the waitlist">
              {view.options.standbys.map(n => <li key={n}>{n}</li>)}
            </ul>
            <p className="crew-label">Why can&apos;t you make it? Only {props.ownerName} sees this.</p>
            <div className="crew-row">
              {REASONS.map(r => (
                <label key={r.value} className="crew-chip crew-chip-pick">
                  <input type="radio" name="find-cover-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} disabled={busy} />
                  {r.label}
                </label>
              ))}
            </div>
            <label htmlFor="find-cover-note" className="crew-small crew-muted" style={{ display: 'block', margin: '.8rem 0 .3rem' }}>Anything {props.ownerName} should know? (optional)</label>
            <textarea id="find-cover-note" className="crew-input" rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} disabled={busy} />
            {error && <p role="alert" className="crew-note crew-alert">{error}</p>}
            <div className="crew-row" style={{ marginTop: '.8rem' }}>
              <button type="button" className="crew-btn" onClick={send} disabled={busy}>
                {busy ? 'Texting…' : `Text ${view.options.standbys.length === 1 ? 'them' : `all ${view.options.standbys.length}`}`}
              </button>
              <button type="button" className="crew-btn crew-btn-ghost" onClick={close} disabled={busy}>Cancel</button>
            </div>
            <p className="crew-muted crew-small">{allie}</p>
          </>
        )}

        {view.kind === 'ready' && !view.options.live && view.options.standbys.length === 0 && (
          <>
            <p className="crew-note crew-warn" style={{ marginTop: 0 }}>Nobody is on the waitlist for this party yet, so there&apos;s no one to text.</p>
            {view.options.others.length > 0 ? (
              <>
                <p>These people are free then but haven&apos;t joined the waitlist. Reach out to them yourself and ask them to open the app and tap <strong>Join the waitlist</strong> on this party:</p>
                <ul className="crew-team" aria-label="Free but not on the waitlist">
                  {view.options.others.map(n => <li key={n}>{n}</li>)}
                </ul>
                <p>Once they&apos;ve joined, come back here and tap <strong>Find Cover</strong> again. We&apos;ll text them a link to take your spot, and you&apos;re released when they accept.</p>
              </>
            ) : (
              <p>Nobody else is free then either.</p>
            )}
            <p className="crew-muted crew-small">{allie}</p>
          </>
        )}

        {view.kind === 'error' || view.kind === 'sent' || (view.kind === 'ready' && (view.options.live || view.options.standbys.length === 0)) ? (
          <div className="crew-row" style={{ marginTop: '.8rem' }}>
            <button type="button" className="crew-btn crew-btn-ghost" onClick={close}>Close</button>
          </div>
        ) : null}
      </Modal>
    </>
  )
}
