'use client'

import { useCallback, useEffect, useState } from 'react'

interface ProfileView {
  legalFirstName: string; legalLastName: string; preferredName: string; dateOfBirth: string
  addressLine1: string; addressLine2: string; city: string; state: string; zip: string
  emergencyName: string; emergencyRelationship: string; emergencyPhone: string
  profileDone: boolean; agreementSigned: boolean
}
interface Onboarding {
  firstName: string; phone: string | null; email: string | null; smsOptIn: boolean
  agreementRequired: boolean
  state: { required: boolean; profileDone: boolean; agreementSigned: boolean; incomplete: boolean }
  profile: ProfileView
}

type Step = 'details' | 'email' | 'texts' | 'agreement' | 'done'

function stepFor(d: Onboarding): Step {
  const p = d.profile
  const filled = !!(p.legalFirstName && p.legalLastName && p.dateOfBirth && p.addressLine1 && p.city && p.state && p.zip &&
    p.emergencyName && p.emergencyRelationship && p.emergencyPhone)
  if (!filled) return 'details'
  if (!d.email) return 'email'
  if (!p.profileDone) return 'texts'
  if (d.agreementRequired && !d.state.agreementSigned) return 'agreement'
  return 'done'
}

const STEP_LABELS: { key: Step; label: string }[] = [
  { key: 'details', label: 'About you' }, { key: 'email', label: 'Email' }, { key: 'texts', label: 'Texts' }, { key: 'agreement', label: 'Agreement' },
]

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data: data as Record<string, unknown> }
}

export default function OnboardingFlow({ boardOpen, businessName, ownerName }: { boardOpen: boolean; businessName: string; ownerName: string }) {
  const [data, setData] = useState<Onboarding | null>(null)
  const [loadError, setLoadError] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await call('/api/crew/me/onboarding', 'GET')
      if (r.status === 401) { window.location.href = '/crew/login'; return }
      if (!r.ok) { setLoadError(true); return }
      setLoadError(false)
      setData(r.data as unknown as Onboarding)
    } catch { setLoadError(true) }
  }, [])
  useEffect(() => { void load() }, [load])

  if (loadError) return <p className="crew-note crew-warn">We couldn&apos;t load this just now. Refresh to try again.</p>
  if (!data) return <p className="crew-muted">Loading…</p>

  const step = stepFor(data)
  return (
    <div>
      {step !== 'done' && (
        <ol className="crew-row crew-small" style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem', gap: '.4rem' }} aria-label="Steps">
          {STEP_LABELS.map(s => (
            <li key={s.key} className={`crew-chip ${s.key === step ? 'crew-gold' : 'crew-info'}`} aria-current={s.key === step ? 'step' : undefined}>{s.label}</li>
          ))}
        </ol>
      )}
      {step === 'details' && <DetailsStep data={data} onSaved={load} />}
      {step === 'email' && <EmailStep onDone={load} />}
      {step === 'texts' && <TextsStep data={data} onDone={load} />}
      {step === 'agreement' && <AgreementStep onDone={load} businessName={businessName} />}
      {step === 'done' && <DoneStep boardOpen={boardOpen} ownerName={ownerName} />}
    </div>
  )
}

function Field(props: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string; autoComplete?: string; required?: boolean; hint?: string; inputMode?: 'tel' | 'numeric' | 'text' }) {
  return (
    <>
      <label className="crew-label" htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id} className="crew-input" type={props.type ?? 'text'} value={props.value} autoComplete={props.autoComplete}
        inputMode={props.inputMode} required={props.required ?? true} onChange={e => props.onChange(e.target.value)}
      />
      {props.hint && <p className="crew-muted crew-small" style={{ margin: '.25rem 0 0' }}>{props.hint}</p>}
    </>
  )
}

function DetailsStep({ data, onSaved }: { data: Onboarding; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({ ...data.profile })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof ProfileView) => (v: string) => setF(prev => ({ ...prev, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const r = await call('/api/crew/me/profile', 'PUT', f)
      if (!r.ok) setError(typeof r.data.error === 'string' ? r.data.error : "That didn't work. Try again.")
      else await onSaved()
    } catch { setError("The site didn't answer. Try again.") } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="crew-card">
      <h2 style={{ marginTop: 0 }}>About you</h2>
      <p className="crew-muted crew-small" style={{ marginTop: 0 }}>Hi {data.firstName}! Use your full legal name — it goes on your agreement. Only the owners can see this.</p>
      <Field id="ob-first" label="Legal first name" value={f.legalFirstName} onChange={set('legalFirstName')} autoComplete="given-name" />
      <Field id="ob-last" label="Legal last name" value={f.legalLastName} onChange={set('legalLastName')} autoComplete="family-name" />
      <Field id="ob-pref" label="Preferred first name (optional)" value={f.preferredName} onChange={set('preferredName')} required={false} />
      <Field id="ob-dob" label="Birthday" type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} autoComplete="bday" hint="You need to be 18 or older to join the crew." />
      <Field id="ob-a1" label="Home address" value={f.addressLine1} onChange={set('addressLine1')} autoComplete="address-line1" />
      <Field id="ob-a2" label="Apartment, unit (optional)" value={f.addressLine2} onChange={set('addressLine2')} autoComplete="address-line2" required={false} />
      <Field id="ob-city" label="City" value={f.city} onChange={set('city')} autoComplete="address-level2" />
      <div className="crew-row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}><Field id="ob-state" label="State" value={f.state} onChange={v => set('state')(v.toUpperCase().slice(0, 2))} autoComplete="address-level1" hint="Like NY" /></div>
        <div style={{ flex: 1 }}><Field id="ob-zip" label="ZIP" value={f.zip} onChange={v => set('zip')(v.replace(/\D/g, '').slice(0, 5))} autoComplete="postal-code" inputMode="numeric" /></div>
      </div>
      <h2>Emergency contact</h2>
      <Field id="ob-en" label="Their name" value={f.emergencyName} onChange={set('emergencyName')} />
      <Field id="ob-er" label="Relationship" value={f.emergencyRelationship} onChange={set('emergencyRelationship')} hint="For example, mom" />
      <Field id="ob-ep" label="Their phone" type="tel" value={f.emergencyPhone} onChange={set('emergencyPhone')} autoComplete="off" inputMode="tel" />
      {error && <p role="alert" className="crew-note crew-alert">{error}</p>}
      <div style={{ marginTop: '1rem' }}><button className="crew-btn" disabled={busy}>{busy ? 'Saving…' : 'Save and continue'}</button></div>
    </form>
  )
}

function EmailStep({ onDone }: { onDone: () => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const r = await call('/api/crew/me/email/request', 'POST', { email })
      if (!r.ok) setError(typeof r.data.error === 'string' ? r.data.error : "That didn't work. Try again.")
      else setSent(true)
    } catch { setError("The site didn't answer. Try again.") } finally { setBusy(false) }
  }
  async function confirm(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const r = await call('/api/crew/me/email/verify', 'POST', { code })
      if (!r.ok) setError(typeof r.data.error === 'string' ? r.data.error : "That didn't work. Try again.")
      else await onDone()
    } catch { setError("The site didn't answer. Try again.") } finally { setBusy(false) }
  }

  if (sent) {
    return (
      <form onSubmit={confirm} className="crew-card">
        <h2 style={{ marginTop: 0 }}>Check your email</h2>
        <p style={{ marginTop: 0 }}>We sent a 6-digit code to <strong>{email}</strong>.</p>
        <label className="crew-label" htmlFor="ob-code">Code</label>
        <input id="ob-code" className="crew-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required />
        {error && <p role="alert" className="crew-note crew-alert">{error}</p>}
        <div className="crew-row" style={{ marginTop: '.75rem' }}>
          <button className="crew-btn" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Confirm'}</button>
          <button type="button" className="crew-btn crew-btn-ghost" onClick={() => { setSent(false); setCode(''); setError(null) }}>Use a different email</button>
        </div>
      </form>
    )
  }
  return (
    <form onSubmit={send} className="crew-card">
      <h2 style={{ marginTop: 0 }}>Your email</h2>
      <p className="crew-muted crew-small" style={{ marginTop: 0 }}>We&apos;ll send you a code to confirm it. Your signed agreement is emailed here, and you can sign in with it too.</p>
      <Field id="ob-email" label="Email address" type="email" value={email} onChange={setEmail} autoComplete="email" />
      {error && <p role="alert" className="crew-note crew-alert">{error}</p>}
      <div style={{ marginTop: '.75rem' }}><button className="crew-btn" disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button></div>
    </form>
  )
}

function TextsStep({ data, onDone }: { data: Onboarding; onDone: () => Promise<void> }) {
  const [optIn, setOptIn] = useState(data.smsOptIn)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const r = await call('/api/crew/me/onboarding/complete', 'POST', { smsOptIn: optIn })
      if (!r.ok) setError(typeof r.data.error === 'string' ? r.data.error : "That didn't work. Try again.")
      else await onDone()
    } catch { setError("The site didn't answer. Try again.") } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="crew-card">
      <h2 style={{ marginTop: 0 }}>Party texts</h2>
      <label className="crew-row" style={{ alignItems: 'flex-start', gap: '.6rem' }}>
        <input type="checkbox" checked={optIn} onChange={e => setOptIn(e.target.checked)} style={{ width: 24, height: 24, marginTop: 2 }} disabled={!data.phone} />
        <span>
          Yes, text me about parties, spots and schedule changes at {data.phone ?? 'my number'}. Message frequency varies.
          Message and data rates may apply. Reply STOP to opt out, HELP for help.
        </span>
      </label>
      <p className="crew-muted crew-small">Optional. You can still use the crew app without texts.</p>
      {error && <p role="alert" className="crew-note crew-alert">{error}</p>}
      <div style={{ marginTop: '.75rem' }}><button className="crew-btn" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button></div>
    </form>
  )
}

function loadSignwellScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { SignWellEmbed?: unknown }
    if (w.SignWellEmbed) return resolve()
    const id = 'signwell-embedded-js'
    const existing = document.getElementById(id)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('SignWell script error')))
      return
    }
    const s = document.createElement('script')
    s.id = id
    s.src = 'https://static.signwell.com/assets/embedded.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load SignWell'))
    document.body.appendChild(s)
  })
}

function AgreementStep({ onDone, businessName }: { onDone: () => Promise<void>; businessName: string }) {
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The webhook is what records the signature; after the embed says "completed"
  // we poll until the server agrees, rather than trusting the browser.
  async function waitForRecord() {
    setWaiting(true)
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1500))
      const r = await call('/api/crew/me/onboarding', 'GET').catch(() => null)
      const d = r?.data as unknown as Onboarding | undefined
      if (r?.ok && d?.state.agreementSigned) { await onDone(); return }
    }
    setWaiting(false)
    setError("We haven't seen your signature yet. Give it a minute and refresh this page.")
  }

  async function open() {
    setBusy(true); setError(null)
    try {
      const r = await call('/api/crew/me/agreement', 'POST')
      if (r.data.alreadySigned) { await onDone(); return }
      if (!r.ok || typeof r.data.signingUrl !== 'string') {
        setError(typeof r.data.error === 'string' ? r.data.error : 'Could not open the agreement. Try again.')
        return
      }
      await loadSignwellScript()
      const Embed = (window as unknown as { SignWellEmbed: new (o: Record<string, unknown>) => { open: () => void } }).SignWellEmbed
      new Embed({
        url: r.data.signingUrl,
        allowDecline: false,
        events: {
          completed: () => { void waitForRecord() },
          error: () => setError('There was a problem loading the agreement. Try again.'),
        },
      }).open()
    } catch { setError('Could not load the signing window. Try again.') } finally { setBusy(false) }
  }

  return (
    <div className="crew-card">
      <h2 style={{ marginTop: 0 }}>Your agreement</h2>
      <p style={{ marginTop: 0 }}>
        Last step. Read the {businessName} crew agreement and sign it on screen. It covers how you&apos;re paid,
        choosing and cancelling parties, child safety and keeping families&apos; information private. A copy is emailed to you.
      </p>
      {error && <p role="alert" className="crew-note crew-alert">{error}</p>}
      {waiting && <p className="crew-note crew-info">Recording your signature…</p>}
      <button className="crew-btn" onClick={open} disabled={busy || waiting}>{busy ? 'Opening…' : 'Read and sign'}</button>
    </div>
  )
}

function DoneStep({ boardOpen, ownerName }: { boardOpen: boolean; ownerName: string }) {
  return (
    <div className="crew-card">
      <h2 style={{ marginTop: 0 }}>You&apos;re all set! 🎉</h2>
      {boardOpen
        ? <p>Your account is ready. <a className="crew-link" href="/crew">Go to the party board</a>.</p>
        : <p>Thanks for finishing up. {ownerName} will text you when the party board opens.</p>}
      <p className="crew-small"><a className="crew-link" href="/crew/profile">Update my details</a></p>
    </div>
  )
}
