'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const REASONS = [
  { value: 'sick', label: 'Sick' },
  { value: 'family', label: 'Family' },
  { value: 'school', label: 'School' },
  { value: 'other', label: 'Other' },
] as const

/**
 * The reason and the send. A reason is required (spec §3.7); only Allie ever
 * sees it. The button says what will happen, in the words the page already used.
 */
export default function CantMakeItForm(props: { slotId: string; submitLabel: string; confirmText: string }) {
  const router = useRouter()
  const [reason, setReason] = useState<string>('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!reason) { setError('Pick a reason.'); return }
    if (!window.confirm(props.confirmText)) return
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
      if (!res.ok) { setError(typeof data?.error === 'string' ? data.error : "That didn't work. Try again."); return }
      router.refresh()
    } catch {
      setError("You're offline, or the site didn't answer. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="crew-card">
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend style={{ fontWeight: 600, marginBottom: '.4rem' }}>Why? Only Allie sees this.</legend>
        <div className="crew-row" style={{ flexWrap: 'wrap', gap: '.5rem' }}>
          {REASONS.map(r => (
            <label key={r.value} className="crew-chip" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: '.35rem', cursor: 'pointer' }}>
              <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} disabled={busy} />
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor="crew-cant-note" className="crew-small crew-muted" style={{ display: 'block', margin: '.8rem 0 .3rem' }}>
        Anything Allie should know? (optional)
      </label>
      <textarea id="crew-cant-note" className="crew-input" rows={3} maxLength={500} value={note} onChange={e => setNote(e.target.value)} disabled={busy} />
      <div style={{ marginTop: '.8rem' }}>
        <button type="submit" className="crew-btn" disabled={busy}>{busy ? 'One moment…' : props.submitLabel}</button>
      </div>
      {error && <p role="alert" className="crew-small" style={{ color: '#8E1043', marginBottom: 0 }}>{error}</p>}
    </form>
  )
}
