import { useState, useEffect, useCallback } from 'react'
import type { TimeSlot, AvailabilityResponse } from './types'

export function useCalendarAvailability(month: string, bookingType?: string) {
  const [slots, setSlots] = useState<Record<string, TimeSlot[]>>({})
  const [blockedDates, setBlockedDates] = useState<Set<string>>(new Set())
  const [configured, setConfigured] = useState(false)
  const [loading, setLoading] = useState(false)

  const fetchAvailability = useCallback(async () => {
    if (!month) return
    setLoading(true)

    const params = new URLSearchParams({ month })
    if (bookingType) params.set('bookingType', bookingType)

    try {
      const res = await fetch(`/api/availability?${params}`)
      const data: AvailabilityResponse = await res.json()

      setBlockedDates(new Set(data.blockedDates || []))
      setConfigured(data.configured ?? false)
      setSlots(data.slots || {})
    } catch {
      setSlots({})
      setBlockedDates(new Set())
    } finally {
      setLoading(false)
    }
  }, [month, bookingType])

  useEffect(() => {
    fetchAvailability()
  }, [fetchAvailability])

  return { slots, blockedDates, configured, loading }
}
