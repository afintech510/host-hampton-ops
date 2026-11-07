'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Answer = 'work' | 'unavailable' | 'standby'

const notes = (who: string): Record<Answer | 'none', string> => ({
  none: `Tell ${who} if you can work this one. Answering doesn't put you on it; the crew is picked fairly and you'll hear when it's set.`,
  work: `You said you're available. ${who} will let you know when the crew is set. You can change your answer until then.`,
  unavailable: `You told ${who} you can't work this one. Tap it again to take that back.`,
  standby: "You're on standby. If a spot opens you'll be asked first.",
})

/**
 * The two answers on a party that still has a spot: "Available to work" and "Not
 * available". Neither puts the person on it (the manager does that, or puts them on
 * standby, from her side). Tapping the answer you already gave takes it back. The
 * server (`/api/crew/respond`) refuses only what the person could not do anyway.
 *
 * `standby` is not something a person picks any more; it is shown (not pressed) when
 * the manager put them there, and either button moves them out of it.
 */
export default function ResponseButtons(props: { partyId: string; current: Answer | null; canWork: boolean; managerName: string }) {
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
      {(props.canWork || current === 'work') && btn('work', 'Available to work')}
      {btn('unavailable', 'Not available')}
      <p className="crew-resp-note" role="status">{notes(props.managerName)[current ?? 'none']}</p>
      {error && <p role="alert" className="crew-small" style={{ color: 'var(--c-alert-ink)', margin: 0 }}>{error}</p>}
    </div>
  )
}
