'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from './Modal'

/**
 * "Commit to Party": taking a spot asks first, because a committed spot is not
 * handed back with a tap. The dialog says so, and only the confirm button
 * claims it.
 */
export default function CommitButton(props: { slotId: string; label: string; partyTitle: string; when: string; roleWord: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function commit() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/crew/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slotId: props.slotId }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) { window.location.href = '/crew/login'; return }
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : "That didn't work. Try again.")
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError("You're offline, or the site didn't answer. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="crew-btn" onClick={() => { setError(null); setOpen(true) }}>{props.label}</button>
      <Modal open={open} onClose={() => { if (!busy) setOpen(false) }} title="Commit to this party?">
        <p style={{ marginTop: 0 }}>
          <strong>{props.partyTitle}</strong><br />
          {props.when} · {props.roleWord}
        </p>
        <p className="crew-note crew-warn">
          Once you commit, you can&apos;t just remove yourself. If something comes up you&apos;ll need to find someone to cover your spot.
        </p>
        {error && <p role="alert" className="crew-note crew-alert">{error}</p>}
        <div className="crew-row" style={{ marginTop: '.5rem' }}>
          <button type="button" className="crew-btn" onClick={commit} disabled={busy}>{busy ? 'Committing…' : 'Yes, I commit'}</button>
          <button type="button" className="crew-btn crew-btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Not now</button>
        </div>
      </Modal>
    </>
  )
}
