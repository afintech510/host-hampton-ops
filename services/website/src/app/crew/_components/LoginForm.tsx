'use client'

import { useState } from 'react'

/** Phone or email → 6-digit code (spec §5). The request always says "check your phone/email", whoever you are. */
export default function LoginForm() {
  const [step, setStep] = useState<'who' | 'code'>('who')
  const [who, setWho] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEmail = who.includes('@')
  const identity: Record<string, string> = isEmail ? { email: who.trim() } : { phone: who.trim() }

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
      const r = await post('/api/crew/auth/request', identity)
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
      const r = await post('/api/crew/auth/verify', { ...identity, code })
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
        <p style={{ margin: 0 }}>
          If <strong>{who}</strong> is on the crew, we just {isEmail ? 'emailed' : 'texted'} it a 6-digit code.
        </p>
        <label className="crew-label" htmlFor="crew-code">Code</label>
        <input
          id="crew-code" className="crew-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
          maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required
        />
        {error && <p role="alert" className="crew-note crew-alert">{error}</p>}
        <div className="crew-row" style={{ marginTop: '.75rem' }}>
          <button className="crew-btn" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Sign in'}</button>
          <button type="button" className="crew-btn crew-btn-ghost" onClick={() => { setStep('who'); setCode(''); setError(null) }}>
            Use a different number or email
          </button>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={requestCode} className="crew-card">
      <label className="crew-label" htmlFor="crew-who" style={{ marginTop: 0 }}>Your mobile number or email</label>
      <input
        id="crew-who" className="crew-input" type="text" inputMode="email" autoComplete="username" value={who}
        placeholder="631-555-0123 or you@example.com" onChange={e => setWho(e.target.value)} required
      />
      {error && <p role="alert" className="crew-note crew-alert">{error}</p>}
      <div style={{ marginTop: '.75rem' }}>
        <button className="crew-btn" disabled={busy}>{busy ? 'Sending…' : 'Send me a code'}</button>
      </div>
    </form>
  )
}
