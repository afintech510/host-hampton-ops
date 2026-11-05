'use client'

import { useEffect, useState } from 'react'

interface P {
  legalFirstName: string; legalLastName: string; preferredName: string; dateOfBirth: string
  addressLine1: string; addressLine2: string; city: string; state: string; zip: string
  emergencyName: string; emergencyRelationship: string; emergencyPhone: string; agreementSigned: boolean
}

/** Edit my own address, emergency contact and preferred name. The API refuses legal name / birthday changes after signing. */
export default function ProfileForm({ ownerName }: { ownerName: string }) {
  const [p, setP] = useState<P | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/crew/me/onboarding').then(async r => {
      if (r.status === 401) { window.location.href = '/crew/login'; return }
      const d = await r.json().catch(() => null)
      if (r.ok && d) { setP(d.profile as P); setEmail(d.email ?? null) } else setMsg({ ok: false, text: "We couldn't load this. Refresh to try again." })
    }).catch(() => setMsg({ ok: false, text: "We couldn't load this. Refresh to try again." }))
  }, [])

  if (!p) return msg ? <p className="crew-note crew-warn">{msg.text}</p> : <p className="crew-muted">Loading…</p>
  const set = (k: keyof P) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: e.target.value } as P)
  const locked = p.agreementSigned

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/crew/me/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) })
      const d = await res.json().catch(() => ({}))
      setMsg(res.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: typeof d.error === 'string' ? d.error : "That didn't work. Try again." })
    } catch { setMsg({ ok: false, text: "The site didn't answer. Try again." }) } finally { setBusy(false) }
  }

  const row = (id: string, label: string, k: keyof P, opts: { disabled?: boolean; required?: boolean; type?: string } = {}) => (
    <>
      <label className="crew-label" htmlFor={id}>{label}</label>
      <input id={id} className="crew-input" type={opts.type ?? 'text'} value={String(p[k] ?? '')} onChange={set(k)} disabled={opts.disabled} required={opts.required ?? true} />
    </>
  )

  return (
    <form onSubmit={save} className="crew-card">
      {email && <p className="crew-small crew-muted" style={{ marginTop: 0 }}>Signed in as {email}</p>}
      {locked && <p className="crew-note crew-info">Your legal name and birthday are on your signed agreement. To change them, tell {ownerName}.</p>}
      {row('pf-first', 'Legal first name', 'legalFirstName', { disabled: locked })}
      {row('pf-last', 'Legal last name', 'legalLastName', { disabled: locked })}
      {row('pf-dob', 'Birthday', 'dateOfBirth', { disabled: locked, type: 'date' })}
      {row('pf-pref', 'Preferred first name (optional)', 'preferredName', { required: false })}
      {row('pf-a1', 'Home address', 'addressLine1')}
      {row('pf-a2', 'Apartment, unit (optional)', 'addressLine2', { required: false })}
      {row('pf-city', 'City', 'city')}
      {row('pf-state', 'State', 'state')}
      {row('pf-zip', 'ZIP', 'zip')}
      {row('pf-en', 'Emergency contact name', 'emergencyName')}
      {row('pf-er', 'Relationship', 'emergencyRelationship')}
      {row('pf-ep', 'Emergency contact phone', 'emergencyPhone', { type: 'tel' })}
      {msg && <p role="alert" className={`crew-note ${msg.ok ? 'crew-ok' : 'crew-alert'}`}>{msg.text}</p>}
      <div style={{ marginTop: '1rem' }}><button className="crew-btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
    </form>
  )
}
