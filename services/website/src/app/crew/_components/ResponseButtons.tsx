'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Answer = 'work' | 'unavailable' | 'standby'

const notes = (who: string): Record<Answer | 'none', string> => ({
  none: `Answering doesn't lock you in. ${who} picks the crew fairly.`,
  work: `You asked to work this. ${who} will let you know. It doesn't lock you in, and you can change your answer until the crew is picked.`,
  unavailable: `You told ${who} you can't work this one. Tap it again to take that back.`,
  standby: "You're on standby. If a spot opens you'll be asked, in turn. Tap it again to take that back.",
})

/**
 * The three answers on a party the manager picks: "I want to work this",
 * "Unavailable to work", "Add me as standby". None of them takes a spot. Tapping
 * the answer you already gave takes it back. The server (`/api/crew/respond`)
 * refuses only what the person could not do anyway.
 */
export default function ResponseButtons(props: { partyId: string; current: Answer | null; canWork: boolean; noun: 'party' | 'shift'; managerName: string }) {
  const router = useRouter()
  const [current, setCurrent] = useState<Answer | null>(props.current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function answer(next: Answer) {
    const response = current === next ? null : next
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/crew/respond', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ partyId: props.partyId, response }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) { window.location.href = '/crew/login'; return }
      if (!res.ok) { setError(typeof data?.error === 'string' ? data.error : "That didn't work. Try again."); return }
      setCurrent(response)
      router.refresh()
    } catch {
      setError("You're offline, or the site didn't answer. Try again.")
    } finally {
      setBusy(false)
    }
  }

  const btn = (a: Answer, label: string) => (
    <button key={a} type="button" aria-pressed={current === a} disabled={busy}
      className={current === a ? 'crew-btn' : 'crew-btn crew-btn-ghost'} onClick={() => answer(a)}>
      {current === a ? '✓ ' : ''}{label}
    </button>
  )

  return (
    <div className="crew-resp">
      {props.canWork && btn('work', `I want to work this ${props.noun}`)}
      {btn('unavailable', 'Unavailable to work')}
      {btn('standby', props.canWork ? 'Add me as standby' : 'Add me to the waitlist')}
      <p className="crew-resp-note" role="status">{notes(props.managerName)[current ?? 'none']}</p>
      {error && <p role="alert" className="crew-small" style={{ color: 'var(--c-alert-ink)', margin: 0 }}>{error}</p>}
    </div>
  )
}
