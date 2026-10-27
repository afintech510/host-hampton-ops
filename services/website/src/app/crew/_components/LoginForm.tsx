'use client'

import { useState } from 'react'

/** Email → 6-digit code (spec §5). The request always says "check your email", whoever you are. */
export default function LoginForm() {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function post(url: string, body: Record<string, string>) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, error: typeof data?.error === 'string' ? data.error : null }
  }

  async function requestCode(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await post('/api/crew/auth/request', { email })
      if (!r.ok) setError(r.error ?? "That didn't work. Try again.")
      else setStep('code')
    } catch {
      setError("The site didn't answer. Try again.")
    } finally {
      setBusy(false)
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await post('/api/crew/auth/verify', { email, code })
      if (!r.ok) setError(r.error ?? "That didn't work. Try again.")
      else window.location.href = '/crew'
    } catch {
      setError("The site didn't answer. Try again.")
    } finally {
      setBusy(false)
    }
  }

  if (step === 'code') {
    return (
      <form onSubmit={verify} className="crew-card">
        <p style={{ margin: 0 }}>If <strong>{email}</strong> is on the crew, we just emailed it a 6-digit code.</p>
        <label className="crew-label" htmlFor="crew-code">Code</label>
        <input
          id="crew-code" className="crew-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
          maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required
        />
        {error && <p role="alert" className="crew-note crew-alert">{error}</p>}
        <div className="crew-row" style={{ marginTop: '.75rem' }}>
          <button className="crew-btn" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Sign in'}</button>
          <button type="button" className="crew-btn crew-btn-ghost" onClick={() => { setStep('email'); setCode(''); setError(null) }}>
            Use a different email
          </button>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={requestCode} className="crew-card">
      <label className="crew-label" htmlFor="crew-email" style={{ marginTop: 0 }}>Your email</label>
      <input
        id="crew-email" className="crew-input" type="email" autoComplete="email" value={email}
        onChange={e => setEmail(e.target.value)} required
      />
      {error && <p role="alert" className="crew-note crew-alert">{error}</p>}
      <div style={{ marginTop: '.75rem' }}>
        <button className="crew-btn" disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
      </div>
    </form>
  )
}
