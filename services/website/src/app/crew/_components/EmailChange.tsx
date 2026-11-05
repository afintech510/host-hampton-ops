'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

async function post(url: string, body: Record<string, unknown>): Promise<{ ok: boolean; error: string | null }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    if (res.status === 401) {
      window.location.href = '/crew/login'
      return { ok: false, error: null }
    }
    const data = await res.json().catch(() => ({}))
    return res.ok ? { ok: true, error: null } : { ok: false, error: typeof data?.error === 'string' ? data.error : "That didn't work. Try again." }
  } catch {
    return { ok: false, error: "The site didn't answer. Try again." }
  }
}

/**
 * Change the sign-in email. The same two calls onboarding uses: a 6-digit code
 * goes to the NEW address, and only a correct code moves it onto the member, so
 * nobody can point their account at an address they do not hold.
 */
export default function EmailChange({ email, phone, ownerName }: { email: string | null; phone: string | null; ownerName: string }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [next, setNext] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function reset() { setEditing(false); setSent(false); setNext(''); setCode(''); setError(null) }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const r = await post('/api/crew/me/email/request', { email: next })
    setBusy(false)
    if (r.ok) setSent(true)
    else setError(r.error)
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const r = await post('/api/crew/me/email/verify', { code })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    reset()
    setSaved(true)
    router.refresh()
  }

  return (
    <div className="crew-card">
      <p className="crew-label" style={{ marginTop: 0 }}>Email</p>
      <p style={{ margin: '0 0 .3rem' }}>{email ?? 'None yet'}</p>
      {saved && !editing && <p className="crew-note crew-ok" role="status">Email updated.</p>}

      {!editing && (
        <button type="button" className="crew-btn crew-btn-ghost" onClick={() => { setEditing(true); setSaved(false) }}>
          {email ? 'Change email' : 'Add email'}
        </button>
      )}

      {editing && !sent && (
        <form onSubmit={send}>
          <label className="crew-label" htmlFor="ec-email">New email address</label>
          <input id="ec-email" className="crew-input" type="email" autoComplete="email" required value={next} onChange={e => setNext(e.target.value)} />
          <p className="crew-muted crew-small">We&apos;ll email a 6-digit code to confirm it.</p>
          {error && <p role="alert" className="crew-note crew-alert">{error}</p>}
          <div className="crew-row">
            <button className="crew-btn" disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
            <button type="button" className="crew-btn crew-btn-ghost" onClick={reset} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}

      {editing && sent && (
        <form onSubmit={confirm}>
          <p style={{ marginTop: 0 }}>We sent a 6-digit code to <strong>{next}</strong>.</p>
          <label className="crew-label" htmlFor="ec-code">Code</label>
          <input id="ec-code" className="crew-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required
            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
          {error && <p role="alert" className="crew-note crew-alert">{error}</p>}
          <div className="crew-row" style={{ marginTop: '.75rem' }}>
            <button className="crew-btn" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Confirm'}</button>
            <button type="button" className="crew-btn crew-btn-ghost" onClick={() => { setSent(false); setCode(''); setError(null) }} disabled={busy}>Use a different email</button>
          </div>
        </form>
      )}

      <p className="crew-label" style={{ marginBottom: 0 }}>Phone</p>
      <p style={{ margin: '0 0 .3rem' }}>{phone ?? 'None on file'}</p>
      <p className="crew-muted crew-small" style={{ margin: 0 }}>
        To change your phone number, tell {ownerName}. Texts go to the number on file.
      </p>
    </div>
  )
}
