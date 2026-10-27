'use client'

import { useState } from 'react'
import type { TestPickView } from '@/lib/crew/view'
import { formatCents } from '@/lib/crew/rules'

/**
 * "Testing: pick a crew member" (CREW_TEST_LOGIN only). Invented members, no
 * email or phone in these props. The server re-checks every pick
 * (`/api/crew/auth/test-login`), so this list is a convenience, not a gate.
 */
export default function TestPicker({ members }: { members: TestPickView[] }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function pick(id: string) {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch('/api/crew/auth/test-login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memberId: id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : "That didn't work.")
        return
      }
      window.location.href = '/crew'
    } catch {
      setError("The site didn't answer. Try again.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="crew-test-pick" className="crew-card" style={{ borderStyle: 'dashed', borderColor: '#F4B740' }}>
      <h2 id="crew-test-pick" style={{ marginTop: 0 }}>Testing: pick a crew member</h2>
      <p className="crew-muted crew-small" style={{ marginTop: 0 }}>
        These are made-up test people. Tap one to see the app as her. No password.
      </p>
      {members.length === 0 ? (
        <p className="crew-muted">No test crew members are set up.</p>
      ) : (
        <div className="crew-grid">
          {members.map(m => (
            <button key={m.id} type="button" className="crew-pick" onClick={() => pick(m.id)} disabled={busy !== null}>
              <strong>{m.firstName}{m.lastName ? ` ${m.lastName}` : ''}</strong>
              <span className="crew-small crew-muted" style={{ display: 'block' }}>{formatCents(m.rateCents)} a party</span>
              {m.canLead && <span className="crew-chip crew-info" style={{ marginTop: '.3rem' }}>Can lead</span>}
              {busy === m.id && <span className="crew-small" style={{ display: 'block' }}>Signing in…</span>}
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="crew-note crew-alert">{error}</p>}
    </section>
  )
}
