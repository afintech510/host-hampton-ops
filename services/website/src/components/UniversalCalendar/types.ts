export interface BookingType {
  slug: string
  label: string
  description?: string
  allowed_days: number[]
  slot_duration_min: number
  buffer_min: number
  open_time: string | null
  close_time: string | null
  requires_deposit: boolean
  deposit_cents: number
  min_advance_days: number
  tags: string[]
  sort_order: number
}

export interface TimeSlot {
  start: string // HH:mm
  end: string   // HH:mm
  status: 'open' | 'blocked'
}

export interface CalendarSelection {
  date: string          // YYYY-MM-DD
  timeSlot?: TimeSlot
  bookingType?: BookingType
}

export interface AvailabilityResponse {
  blockedDates: string[]
  configured: boolean
  slots?: Record<string, TimeSlot[]>
  bookingType?: {
    slug: string
    label: string
    slotDurationMin: number
    allowedDays: number[]
    depositCents: number
    requiresDeposit: boolean
    tags: string[]
  }
}

export interface UniversalCalendarProps {
  mode?: 'booking' | 'events' | 'browse'
  defaultBookingType?: string
  lockedBookingType?: string
  defaultDate?: string // YYYY-MM-DD — pre-selects this date and navigates to its month
  defaultTime?: string // HH:mm — auto-selects this time slot once availability loads
  tagFilter?: string[]
  expandable?: boolean
  initialExpanded?: boolean
  compact?: boolean
  showSummary?: boolean
  onSelect?: (selection: CalendarSelection) => void
  onBook?: (selection: CalendarSelection) => void
}
