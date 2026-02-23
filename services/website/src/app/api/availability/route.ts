import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import {
  getCalendarEvents,
  parseCalendarBlocks,
  addMinutes,
  rangesOverlap,
  DEFAULT_HOURS,
} from '@/lib/googleCalendar'

export interface TimeSlot {
  start: string // HH:mm
  end: string   // HH:mm
  status: 'open' | 'blocked'
}

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month')
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month param required (YYYY-MM)' }, { status: 400 })
  }

  const bookingTypeSlug = req.nextUrl.searchParams.get('bookingType')

  // Fetch Google Calendar events with full time ranges
  const calEvents = await getCalendarEvents(month)
  const calBlocks = parseCalendarBlocks(calEvents)
  const configured = calEvents.length > 0 || !!process.env.GOOGLE_CALENDAR_ID

  // Blocked dates (backward compatible)
  const blockedDatesSet = new Set<string>()
  for (const ev of calEvents) {
    const start = ev.start?.date || ev.start?.dateTime?.split('T')[0]
    if (start) blockedDatesSet.add(start)
  }

  // Without booking type → legacy day-level response
  if (!bookingTypeSlug) {
    return NextResponse.json({
      blockedDates: Array.from(blockedDatesSet).sort(),
      configured,
    })
  }

  // Look up booking type config from DB
  const supabase = getSupabase()
  const { data: bt } = await supabase
    .from('booking_types')
    .select('*')
    .eq('slug', bookingTypeSlug)
    .eq('is_active', true)
    .single()

  if (!bt) {
    return NextResponse.json({ error: 'Unknown booking type' }, { status: 404 })
  }

  // Generate time slots for each day in the month
  const [year, mon] = month.split('-').map(Number)
  const daysInMonth = new Date(year, mon, 0).getDate()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const slots: Record<string, TimeSlot[]> = {}

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, mon - 1, day)
    const dateStr = `${month}-${String(day).padStart(2, '0')}`
    const dow = date.getDay()

    // Skip if day-of-week not allowed
    if (!bt.allowed_days.includes(dow)) continue

    // Skip past dates + advance requirement
    const minDate = new Date(today)
    minDate.setDate(minDate.getDate() + bt.min_advance_days)
    if (date < minDate) continue

    // Business hours for this day
    const openTime = bt.open_time || DEFAULT_HOURS[dow].open
    const closeTime = bt.close_time || DEFAULT_HOURS[dow].close

    // Generate slots at configured intervals
    const daySlots: TimeSlot[] = []
    let cursor = openTime

    while (true) {
      const slotEnd = addMinutes(cursor, bt.slot_duration_min)
      if (slotEnd > closeTime) break

      // Check overlap with Google Calendar blocks
      const dayBlocks = calBlocks.get(dateStr) || []
      const isBlocked = dayBlocks.some(block =>
        block.allDay || rangesOverlap({ start: cursor, end: slotEnd }, block)
      )

      daySlots.push({ start: cursor, end: slotEnd, status: isBlocked ? 'blocked' : 'open' })
      cursor = addMinutes(cursor, bt.slot_duration_min + bt.buffer_min)
    }

    if (daySlots.length > 0) {
      slots[dateStr] = daySlots
    }
  }

  return NextResponse.json({
    blockedDates: Array.from(blockedDatesSet).sort(),
    configured,
    slots,
    bookingType: {
      slug: bt.slug,
      label: bt.label,
      slotDurationMin: bt.slot_duration_min,
      allowedDays: bt.allowed_days,
      depositCents: bt.deposit_cents,
      requiresDeposit: bt.requires_deposit,
      tags: bt.tags,
    },
  })
}
