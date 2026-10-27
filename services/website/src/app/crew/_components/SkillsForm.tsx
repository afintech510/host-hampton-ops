'use client'

import { useState } from 'react'

/** Self-reported skills (informational only). The server screens every save. */
export default function SkillsForm(props: { options: readonly string[]; picked: string[]; extras: string[]; maxExtras: number; maxLength: number }) {
  const [picked, setPicked] = useState<Set<string>>(new Set(props.picked))
  const [extras, setExtras] = useState<string[]>(props.extras.length ? props.extras : [''])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  function toggle(s: string) {
    const next = new Set(picked)
    if (next.has(s)) next.delete(s)
    else next.add(s)
    setPicked(next)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/crew/skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skills: Array.from(picked), extras: extras.filter(x => x.trim()) }),
      })
      if (res.status === 401) {
        window.location.href = '/crew/login'
        return
      }
      const data = await res.json().catch(() => ({}))
      setMsg(res.ok ? { ok: true, text: 'Saved.' } : { ok: false, text: typeof data?.error === 'string' ? data.error : "That didn't save." })
    } catch {
      setMsg({ ok: false, text: "The site didn't answer. Try again." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <fieldset className="crew-card" style={{ margin: '0 0 .75rem' }}>
        <legend className="crew-small crew-muted">Tick what you can do</legend>
        {props.options.map(s => (
          <label key={s} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', minHeight: 44 }}>
            <input type="checkbox" checked={picked.has(s)} onChange={() => toggle(s)} style={{ width: 20, height: 20 }} />
            {s}
          </label>
        ))}
      </fieldset>

      <div className="crew-card">
        <p style={{ marginTop: 0 }}><strong>Anything else?</strong> <span className="crew-muted crew-small">Up to {props.maxExtras}, short.</span></p>
        {extras.map((x, i) => (
          <input
            key={i} className="crew-input" style={{ marginBottom: '.4rem' }} maxLength={props.maxLength} value={x}
            aria-label={`Other skill ${i + 1}`}
            onChange={e => setExtras(extras.map((y, j) => (j === i ? e.target.value : y)))}
          />
        ))}
        {extras.length < props.maxExtras && (
          <button type="button" className="crew-btn crew-btn-ghost" onClick={() => setExtras([...extras, ''])}>Add another</button>
        )}
      </div>

      <button className="crew-btn" disabled={busy}>{busy ? 'Saving…' : 'Save skills'}</button>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`crew-note ${msg.ok ? 'crew-ok' : 'crew-alert'}`}>{msg.text}</p>}
    </form>
  )
}
