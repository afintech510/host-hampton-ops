'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * A GET of one of the crew app's own read-only endpoints (the session cookie rides along). `url` null = do not fetch.
 * A refusal or a failure is `error`, never an empty answer.
 */
export function useCrewData<T>(url: string | null): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!url)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])

  useEffect(() => {
    if (!url) { setData(null); setError(null); setLoading(false); return }
    let alive = true
    setLoading(true)
    setError(null)
    fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      .then(async res => {
        const json = await res.json().catch(() => ({}))
        if (!alive) return
        if (res.ok) setData(json as T)
        else setError(res.status === 401 ? 'Please sign in again.' : (json as { error?: string }).error || 'Could not load this. Try again in a moment.')
      })
      .catch(() => { if (alive) setError('Could not load this. Check your connection and try again.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [url, tick])

  return { data, error, loading, reload }
}
