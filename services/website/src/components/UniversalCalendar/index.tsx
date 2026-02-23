'use client'

import { useState, useMemo, useCallback } from 'react'
import type { UniversalCalendarProps, CalendarSelection, TimeSlot, BookingType } from './types'
import { useBookingTypes } from './useBookingTypes'
import { useCalendarAvailability } from './useCalendarAvailability'
import CalendarGrid from './CalendarGrid'
import TimeSlotPanel from './TimeSlotPanel'
import EventTypeSelector from './EventTypeSelector'
import SummaryFooter from './SummaryFooter'
import CalendarShell from './CalendarShell'

export default function UniversalCalendar({
  mode = 'booking',
  defaultBookingType,
  lockedBookingType,
  defaultDate,
  tagFilter,
  expandable = false,
  initialExpanded = true,
  showSummary = true,
  onSelect,
  onBook,
}: UniversalCalendarProps) {
  const [viewDate, setViewDate] = useState(() => {
    if (defaultDate) {
      const [y, m] = defaultDate.split('-').map(Number)
      return new Date(y, m - 1, 1)
    }
    return new Date()
  })
  const [selectedDate, setSelectedDate] = useState<string | null>(defaultDate || null)
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null)
  const [activeType, setActiveType] = useState(lockedBookingType || defaultBookingType || '')

  const { types, loading: typesLoading } = useBookingTypes(tagFilter)

  // Auto-select first type when types load
  const resolvedType = activeType || types[0]?.slug || ''

  const month = useMemo(() => {
    const y = viewDate.getFullYear()
    const m = String(viewDate.getMonth() + 1).padStart(2, '0')
    return `${y}-${m}`
  }, [viewDate])

  const { slots, configured, loading } = useCalendarAvailability(
    month,
    mode === 'booking' ? resolvedType : undefined
  )

  const currentBookingType = useMemo(
    () => types.find(t => t.slug === resolvedType),
    [types, resolvedType]
  )

  const handleChangeMonth = useCallback((offset: number) => {
    setViewDate(prev => {
      const next = new Date(prev)
      next.setMonth(next.getMonth() + offset)
      return next
    })
    setSelectedDate(null)
    setSelectedSlot(null)
  }, [])

  const handleSelectDate = useCallback((dateStr: string) => {
    setSelectedDate(dateStr)
    setSelectedSlot(null)
    if (onSelect) {
      onSelect({ date: dateStr, bookingType: currentBookingType })
    }
  }, [onSelect, currentBookingType])

  const handleSelectSlot = useCallback((slot: TimeSlot) => {
    setSelectedSlot(slot)
    if (onSelect && selectedDate) {
      onSelect({ date: selectedDate, timeSlot: slot, bookingType: currentBookingType })
    }
  }, [onSelect, selectedDate, currentBookingType])

  const handleTypeChange = useCallback((slug: string) => {
    setActiveType(slug)
    setSelectedDate(null)
    setSelectedSlot(null)
  }, [])

  const handleBook = useCallback(() => {
    if (!selectedDate || !selectedSlot || !currentBookingType) return
    const selection: CalendarSelection = {
      date: selectedDate,
      timeSlot: selectedSlot,
      bookingType: currentBookingType,
    }
    if (onBook) {
      onBook(selection)
    } else {
      // Default: navigate to /book with query params
      const params = new URLSearchParams({
        date: selectedDate,
        time: selectedSlot.start,
        type: currentBookingType.slug,
      })
      window.location.href = `/book?${params}`
    }
  }, [selectedDate, selectedSlot, currentBookingType, onBook])

  const selection: CalendarSelection | null =
    selectedDate && selectedSlot && currentBookingType
      ? { date: selectedDate, timeSlot: selectedSlot, bookingType: currentBookingType }
      : null

  if (typesLoading && mode === 'booking') {
    return (
      <CalendarShell expandable={expandable} initialExpanded={initialExpanded}>
        <div className="flex items-center justify-center py-12">
          <span className="w-2 h-2 rounded-full bg-hampton-pink animate-pulse" />
          <span className="ml-2 text-xs text-hampton-mauve">Loading...</span>
        </div>
      </CalendarShell>
    )
  }

  return (
    <CalendarShell expandable={expandable} initialExpanded={initialExpanded}>
      <div className="space-y-5">
        {/* Event type selector — hidden when locked to a single type */}
        {mode === 'booking' && !lockedBookingType && types.length > 1 && (
          <EventTypeSelector
            types={types}
            selected={resolvedType}
            onSelect={handleTypeChange}
          />
        )}

        {/* Calendar grid */}
        <CalendarGrid
          viewDate={viewDate}
          onChangeMonth={handleChangeMonth}
          selectedDate={selectedDate}
          onSelectDate={handleSelectDate}
          slots={slots}
          allowedDays={currentBookingType?.allowed_days}
          loading={loading}
          configured={configured}
        />

        {/* Time slot panel — shows when a date is selected */}
        {selectedDate && slots[selectedDate] && currentBookingType && (
          <TimeSlotPanel
            dateStr={selectedDate}
            slots={slots[selectedDate]}
            selectedSlot={selectedSlot}
            onSelectSlot={handleSelectSlot}
            durationMin={currentBookingType.slot_duration_min}
          />
        )}

        {/* Summary footer with CTA */}
        {showSummary && <SummaryFooter selection={selection} onBook={handleBook} />}
      </div>
    </CalendarShell>
  )
}
