import { useState, useEffect, useCallback } from 'react'
import type { TimeSlot, AvailabilityResponse } from './types'

interface Availability {
  key: string
  slots: Record<string, TimeSlot[]>
  blockedDates: Set<string>
  configured: boolean
  error: string | null
}
const EMPTY: Pick<Availability, 'slots' | 'blockedDates' | 'configured'> = { slots: {}, blockedDates: new Set<string>(), configured: false }

export function useCalendarAvailability(month: string, bookingType?: string) {
  const key = `${month}:${bookingType ?? ''}`
  const [result, setResult] = useState<Availability | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setResult(null); setAttempt(n => n + 1) }, [])

  useEffect(() => {
    const controller = new AbortController()
    let current = true
    setResult(null)
    const params = new URLSearchParams({ month })
    if (bookingType) params.set('bookingType', bookingType)
    async function read() {
      try {
        const res = await fetch(`/api/availability?${params}`, { signal: controller.signal, cache: 'no-store' })
        const data: AvailabilityResponse = await res.json()
        if (!res.ok || data.calendarFailed || !data.configured) throw new Error('Calendar unavailable')
        if (current) setResult({ key, slots: data.slots ?? {}, blockedDates: new Set(data.blockedDates ?? []), configured: true, error: null })
      } catch {
        if (current) setResult({ key, ...EMPTY, error: 'We could not check availability. Please try again or contact us to confirm your date.' })
      }
    }
    void read()
    return () => { current = false; controller.abort() }
  }, [month, bookingType, key, attempt])

  // Never expose the previous month's slots while the next month's read starts.
  const current = result?.key === key ? result : null
  return { ...(current ?? { ...EMPTY, error: null }), loading: !current, retry }
}
