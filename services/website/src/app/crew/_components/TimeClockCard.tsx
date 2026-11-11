'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const TZ = 'America/New_York'
const clock = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

function elapsed(fromIso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60000))
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
}

type Fix = { lat?: number; lng?: number; accuracy?: number; locationStatus?: 'denied' | 'unavailable' }

/** Ask the phone where it is. Never rejects: a refusal or a timeout is a status the server records, not a block. */
function getFix(): Promise<Fix> {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve({ locationStatus: 'unavailable' })
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      err => resolve({ locationStatus: err.code === 1 ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  })
}

/**
 * The time clock card on /crew. Rendered only for a member with a time clock. The first punch asks
 * her to read and accept the notice once; after that the button just works.
 */
export default function TimeClockCard({ open, noticeAccepted }: { open: string | null; noticeAccepted: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(noticeAccepted)
  const [showNotice, setShowNotice] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!open) return
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [open])

  async function post(body: Record<string, unknown>) {
    const res = await fetch('/api/crew/time', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) { window.location.href = '/crew/login'; throw new Error('signed out') }
    return { ok: res.ok, data }
  }

  async function punch() {
    setBusy(true); setError(null)
    try {
      const fix = await getFix()
      const r = await post({ action: open ? 'out' : 'in', ...fix })
      if (!r.ok) {
        if (r.data?.needsNotice) { setAccepted(false); setShowNotice(true); return }
        setError(typeof r.data?.error === 'string' ? r.data.error : "That didn't work. Try again.")
        return
      }
      router.refresh()
    } catch (e) {
      if ((e as Error).message !== 'signed out') setError("You're offline, or the site didn't answer. Try again.")
    } finally {
      setBusy(false)
    }
  }

  async function accept() {
    setBusy(true); setError(null)
    try {
      const r = await post({ action: 'accept_notice' })
      if (!r.ok) { setError("That didn't save. Try again."); return }
      setAccepted(true); setShowNotice(false)
    } catch { setError("You're offline, or the site didn't answer. Try again.") } finally { setBusy(false) }
  }

  return (
    <section className="crew-card" aria-labelledby="crew-time-h">
      <h2 id="crew-time-h" style={{ marginTop: 0 }}>Time clock</h2>
      {showNotice && !accepted ? (
        <div>
          <p className="crew-small">
            When you punch in or out, we record the time, your phone&apos;s location, and whether you&apos;re on the
            studio&apos;s internet connection. Only you and the managers can see your hours. Punching still works if you
            turn location off, but the manager will see that it was off.
          </p>
          <button type="button" className="crew-btn" onClick={accept} disabled={busy}>{busy ? 'One moment…' : 'I understand, continue'}</button>
        </div>
      ) : (
        <>
          {open
            ? <p style={{ margin: '0 0 .6rem' }}><strong>Punched in at {clock(open)}</strong><br /><span className="crew-muted">{elapsed(open, now)} so far</span></p>
            : <p className="crew-muted" style={{ margin: '0 0 .6rem' }}>You&apos;re punched out.</p>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
            <button
              type="button"
              className={open ? 'crew-btn crew-btn-ghost' : 'crew-btn'}
              onClick={() => (accepted ? punch() : setShowNotice(true))}
              disabled={busy}
            >
              {busy ? (open ? 'Punching out…' : 'Punching in…') : open ? 'Punch out' : 'Punch in'}
            </button>
            <Link className="crew-btn crew-btn-ghost" href="/crew/time">My hours</Link>
          </div>
        </>
      )}
      {error && <p role="alert" className="crew-small" style={{ color: 'var(--c-alert-ink)', marginBottom: 0 }}>{error}</p>}
    </section>
  )
}
