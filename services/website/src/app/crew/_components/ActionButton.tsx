'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * One button that POSTs JSON to a `/api/crew/*` route and refreshes the page's
 * server data on success. Errors are shown beside the button in the route's own
 * words; nothing is retried behind the member's back.
 */
export default function ActionButton(props: {
  endpoint: string
  body?: Record<string, unknown>
  label: string
  busyLabel?: string
  variant?: 'primary' | 'ghost'
  /** Ask first, for anything that gives up a spot. */
  confirmText?: string
  /** Hard navigation after success (sign in / sign out), instead of a refresh. */
  redirectTo?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    if (props.confirmText && !window.confirm(props.confirmText)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(props.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(props.body ?? {}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = '/crew/login'
          return
        }
        setError(typeof data?.error === 'string' ? data.error : "That didn't work. Try again.")
        return
      }
      if (props.redirectTo) {
        window.location.href = props.redirectTo
        return
      }
      router.refresh()
    } catch {
      setError("You're offline, or the site didn't answer. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: '.3rem' }}>
      <button
        type="button"
        className={props.variant === 'ghost' ? 'crew-btn crew-btn-ghost' : 'crew-btn'}
        onClick={run}
        disabled={busy}
      >
        {busy ? props.busyLabel ?? 'One moment…' : props.label}
      </button>
      {error && <span role="alert" className="crew-small" style={{ color: '#8E1043' }}>{error}</span>}
    </span>
  )
}
