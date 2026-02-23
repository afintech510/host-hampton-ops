import { useState, useEffect } from 'react'
import type { BookingType } from './types'

export function useBookingTypes(tagFilter?: string[]) {
  const [types, setTypes] = useState<BookingType[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams()
    if (tagFilter?.length) params.set('tags', tagFilter.join(','))

    fetch(`/api/booking-types?${params}`)
      .then(r => r.json())
      .then(data => setTypes(data.types || []))
      .catch(() => setTypes([]))
      .finally(() => setLoading(false))
  }, [tagFilter?.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  return { types, loading }
}
