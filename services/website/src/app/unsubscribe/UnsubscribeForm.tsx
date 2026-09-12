'use client'

import { useState } from 'react'

type State = 'idle' | 'working' | 'done' | 'error'

export default function UnsubscribeForm({ token }: { token: string }) {
  const [state, setState] = useState<State>('idle')
  const [message, setMessage] = useState<string>('')

  async function submit() {
    setState('working')
    try {
      const res = await fetch(`/api/unsubscribe?t=${encodeURIComponent(token)}`, {
        method: 'POST',
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setState('error')
        setMessage(body?.error || 'Something went wrong. Please try again in a moment.')
        return
      }
      setState('done')
    } catch {
      setState('error')
      setMessage('Something went wrong. Please try again in a moment.')
    }
  }

  if (state === 'done') {
    return (
      <p className="mt-8 rounded-lg bg-[#eef3f1] px-5 py-4 text-[#2f3e46]">
        You&apos;re unsubscribed. Thanks for letting us know — sorry to see you go.
      </p>
    )
  }

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={submit}
        disabled={state === 'working'}
        className="rounded-full bg-[#7d94a3] px-7 py-3 text-white transition hover:bg-[#6b8090] disabled:opacity-60"
      >
        {state === 'working' ? 'Unsubscribing…' : 'Unsubscribe me'}
      </button>
      {state === 'error' && <p className="mt-4 text-sm text-[#a0453f]">{message}</p>}
    </div>
  )
}
