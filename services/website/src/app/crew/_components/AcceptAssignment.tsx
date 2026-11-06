'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from './Modal'

/**
 * "Accept Assignment": the manager put this person on a shift and they have to
 * say they have it. The button opens a dialog that restates exactly what is
 * being accepted (the whole shift, the role) and that it is a commitment, and
 * only its own confirm button accepts. Once accepted, the same dialog offers to
 * put the shift in a phone calendar; the page refreshes when it is dismissed,
 * not before, so the offer is not torn down under the person's thumb.
 */
export default function AcceptAssignment(props: {
  slotId: string; partyTitle: string; dayLabel: string; shiftLabel: string; roleWord: string; calUrl: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function accept() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/crew/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slotId: props.slotId }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) { window.location.href = '/crew/login'; return }
      if (!res.ok) { setError(typeof data?.error === 'string' ? data.error : "That didn't work. Try again."); return }
      setDone(true)
    } catch {
      setError("You're offline, or the site didn't answer. Try again.")
    } finally {
      setBusy(false)
    }
  }

  function close() {
    if (busy) return
    setOpen(false)
    if (done) router.refresh()
  }

  return (
    <>
      <button type="button" className="crew-btn" onClick={() => { setError(null); setOpen(true) }}>Accept Assignment</button>
      <Modal open={open} onClose={close} title={done ? "You're confirmed" : 'Accept this assignment?'}>
        <p style={{ marginTop: 0 }}>
          <strong>{props.partyTitle}</strong><br />
          {props.dayLabel}<br />
          Your shift: <strong>{props.shiftLabel}</strong><br />
          {props.roleWord}
        </p>
        {!done && (
          <>
            <p className="crew-note crew-warn">
              By accepting, you&apos;re committing to work this whole shift. If something comes up later you&apos;ll need to find someone to cover your spot.
            </p>
            {error && <p role="alert" className="crew-note crew-alert">{error}</p>}
            <div className="crew-row" style={{ marginTop: '.5rem' }}>
              <button type="button" className="crew-btn" onClick={accept} disabled={busy}>{busy ? 'Accepting…' : 'Yes, accept assignment'}</button>
              <button type="button" className="crew-btn crew-btn-ghost" onClick={close} disabled={busy}>Not yet</button>
            </div>
          </>
        )}
        {done && (
          <>
            <p className="crew-note crew-ok" role="status">Thank you. It&apos;s on your schedule.</p>
            {props.calUrl && (
              <>
                <p className="crew-label" style={{ marginBottom: '.4rem' }}>Add it to your phone&apos;s calendar</p>
                <div className="crew-row">
                  <a className="crew-btn crew-btn-ghost" href={`${props.calUrl}?format=google`} target="_blank" rel="noopener noreferrer">Google Calendar</a>
                  <a className="crew-btn crew-btn-ghost" href={`${props.calUrl}?format=ics`}>Apple Calendar</a>
                </div>
              </>
            )}
            <div style={{ marginTop: '1rem' }}>
              <button type="button" className="crew-btn" onClick={close}>Done</button>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
