/**
 * Google Calendar helper — shared by availability API and webhook write-back.
 */

import { etToUtc } from '@/lib/partyTime'

export interface CalendarEvent {
  summary?: string
  start: { date?: string; dateTime?: string }
  end: { date?: string; dateTime?: string }
}

export interface CalendarTimeRange {
  start: string // HH:mm
  end: string   // HH:mm
  allDay: boolean
}

// Default business hours (from schema.org in layout.tsx)
export const DEFAULT_HOURS: Record<number, { open: string; close: string }> = {
  0: { open: '10:00', close: '20:00' }, // Sunday
  1: { open: '12:00', close: '19:00' }, // Monday
  2: { open: '12:00', close: '19:00' },
  3: { open: '12:00', close: '19:00' },
  4: { open: '12:00', close: '19:00' },
  5: { open: '12:00', close: '19:00' }, // Friday
  6: { open: '10:00', close: '20:00' }, // Saturday
}

/**
 * Per-day earlier opening for a booking type, over its single `open_time`
 * column. `kids-party` opens at 11:00 every day, but Saturdays take a 10am
 * party (Adam, 2026-11-03). Keyed by slug, then day of week (0 = Sunday).
 */
export const DAY_OPEN_OVERRIDES: Record<string, Partial<Record<number, string>>> = {
  'kids-party': { 6: '10:00' },
}

/** The first slot start for a booking type on a given day of the week. */
export function openTimeFor(bt: { slug: string; open_time: string | null }, dow: number): string {
  return DAY_OPEN_OVERRIDES[bt.slug]?.[dow] || bt.open_time || DEFAULT_HOURS[dow].open
}

/** Refresh Google OAuth access token */
export async function getGoogleAccessToken(): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) return null

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  return data.access_token || null
}

/** Fetch Google Calendar events for a month, returning full time ranges */
export async function getCalendarEvents(month: string): Promise<CalendarEvent[]> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID
  const accessToken = await getGoogleAccessToken()
  if (!calendarId || !accessToken) return []

  // The month in EASTERN time. The window used to be UTC midnight to UTC
  // midnight, which dropped any party starting after 7–8pm ET on the last day
  // of the month (it is already the 1st in UTC), so that slot read as free.
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  const timeMin = etToUtc(`${month}-01`, 0).toISOString()
  const timeMax = etToUtc(`${next}-01`, 0).toISOString()

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?` +
    new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      fields: 'items(start,end,summary)',
    }),
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!res.ok) {
    console.error('Google Calendar API error:', res.status)
    return []
  }

  const data = await res.json()
  return data.items || []
}

export interface ListedCalendarEvent {
  id: string
  summary?: string
  description?: string
  start: { date?: string; dateTime?: string }
  end: { date?: string; dateTime?: string }
}

/**
 * Every event ending after `timeMin`, across all pages, optionally narrowed by
 * Google's free-text `q`. Three outcomes, not two: a failed read is
 * `{ ok: false }`, never an empty list, because the caller deletes and creates
 * events based on what it believes is already there.
 */
export async function listCalendarEvents(opts: { timeMin: string; q?: string }): Promise<
  { ok: true; events: ListedCalendarEvent[] } | { ok: false; error: string }
> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID
  const accessToken = await getGoogleAccessToken().catch(() => null)
  if (!calendarId) return { ok: false, error: 'GOOGLE_CALENDAR_ID not set' }
  if (!accessToken) return { ok: false, error: 'no Google access token' }

  const events: ListedCalendarEvent[] = []
  let pageToken: string | undefined
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({
      timeMin: opts.timeMin,
      singleEvents: 'true',
      maxResults: '250',
      fields: 'nextPageToken,items(id,summary,description,start,end)',
    })
    if (opts.q) params.set('q', opts.q)
    if (pageToken) params.set('pageToken', pageToken)
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    ).catch(() => null)
    if (!res || !res.ok) return { ok: false, error: `Google Calendar list failed (${res ? res.status : 'network'})` }
    const data = await res.json()
    events.push(...(data.items || []))
    pageToken = data.nextPageToken
    if (!pageToken) return { ok: true, events }
  }
  return { ok: false, error: 'Google Calendar list did not finish in 20 pages' }
}

/** One event by id; `null` when it does not exist (404/410) or is cancelled. */
export async function getCalendarEvent(eventId: string): Promise<
  { ok: true; event: ListedCalendarEvent | null } | { ok: false; error: string }
> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID
  const accessToken = await getGoogleAccessToken().catch(() => null)
  if (!calendarId || !accessToken) return { ok: false, error: 'Google Calendar not configured' }
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  ).catch(() => null)
  if (res && (res.status === 404 || res.status === 410)) return { ok: true, event: null }
  if (!res || !res.ok) return { ok: false, error: `Google Calendar get failed (${res ? res.status : 'network'})` }
  const data = await res.json()
  return { ok: true, event: data.status === 'cancelled' ? null : data }
}

/** An instant as Eastern `{ date: YYYY-MM-DD, time: HH:mm }`. */
export function etParts(iso: string): { date: string; time: string } {
  const parts = new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  const [datePart, timePart] = parts.split(', ')
  const [mm, dd, yyyy] = datePart.split('/')
  return { date: `${yyyy}-${mm}-${dd}`, time: timePart.replace(/^24:/, '00:') }
}

/** Parse Google Calendar events into date-keyed time ranges */
export function parseCalendarBlocks(events: CalendarEvent[]): Map<string, CalendarTimeRange[]> {
  const blocks = new Map<string, CalendarTimeRange[]>()

  for (const ev of events) {
    if (ev.start.date) {
      // All-day event — blocks entire day
      const date = ev.start.date
      if (!blocks.has(date)) blocks.set(date, [])
      blocks.get(date)!.push({ start: '00:00', end: '23:59', allDay: true })
    } else if (ev.start.dateTime) {
      // Timed event — blocks specific range
      // Use toLocaleString to get Eastern time (server runs in UTC)
      const TZ = 'America/New_York'
      const dt = new Date(ev.start.dateTime)
      const startParts = dt.toLocaleString('en-US', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      const [datePart, timePart] = startParts.split(', ')
      const [mm, dd, yyyy] = datePart.split('/')
      const date = `${yyyy}-${mm}-${dd}`
      const startTime = timePart.replace(/^24:/, '00:')

      const endDt = new Date(ev.end.dateTime!)
      const endParts = endDt.toLocaleString('en-US', { timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit' })
      const endTime = endParts.replace(/^24:/, '00:')

      if (!blocks.has(date)) blocks.set(date, [])
      blocks.get(date)!.push({ start: startTime, end: endTime, allDay: false })
    }
  }

  return blocks
}

/** Convert 12-hr time string ("2:00 PM") to 24-hr ("14:00") */
export function to24hr(time12: string): string {
  const match = time12.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!match) return time12 // already 24hr or unknown format
  let h = parseInt(match[1])
  const m = match[2]
  const ampm = match[3].toUpperCase()
  if (ampm === 'PM' && h < 12) h += 12
  if (ampm === 'AM' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${m}`
}

/** Add minutes to HH:mm time string */
export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + minutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Check if two time ranges overlap */
export function rangesOverlap(
  a: { start: string; end: string },
  b: { start: string; end: string }
): boolean {
  return a.start < b.end && a.end > b.start
}

/** Create a Google Calendar event (write-back) */
export async function createCalendarEvent(details: {
  summary: string
  startDate: string   // YYYY-MM-DD
  startTime: string   // HH:mm
  endTime: string     // HH:mm
  description?: string
}): Promise<string | null> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID
  const accessToken = await getGoogleAccessToken()
  if (!calendarId || !accessToken) return null

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: details.summary,
        start: { dateTime: `${details.startDate}T${details.startTime}:00`, timeZone: 'America/New_York' },
        end: { dateTime: `${details.startDate}T${details.endTime}:00`, timeZone: 'America/New_York' },
        description: details.description || '',
      }),
    }
  )

  if (!res.ok) {
    console.error('Google Calendar create error:', res.status, await res.text())
    return null
  }

  const data = await res.json()
  return data.id || null
}

/**
 * Update an existing calendar event's window (and optionally summary/description).
 * Returns true on success. Used when a studio rental's time is extended/changed.
 */
export async function updateCalendarEvent(eventId: string, details: {
  startDate: string   // YYYY-MM-DD
  startTime: string   // HH:mm
  endTime: string     // HH:mm
  summary?: string
  description?: string
}): Promise<boolean> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID
  const accessToken = await getGoogleAccessToken()
  if (!calendarId || !accessToken || !eventId) return false

  const patch: Record<string, unknown> = {
    start: { dateTime: `${details.startDate}T${details.startTime}:00`, timeZone: 'America/New_York' },
    end: { dateTime: `${details.startDate}T${details.endTime}:00`, timeZone: 'America/New_York' },
  }
  if (details.summary) patch.summary = details.summary
  if (details.description != null) patch.description = details.description

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }
  )

  if (!res.ok) {
    console.error('Google Calendar update error:', res.status, await res.text())
    return false
  }
  return true
}

/**
 * Delete a calendar event. Used when a booking is hard-deleted from admin.
 * Treats 404/410 (already gone) as success. Returns true on success.
 */
export async function deleteCalendarEvent(eventId: string): Promise<boolean> {
  const calendarId = process.env.GOOGLE_CALENDAR_ID
  const accessToken = await getGoogleAccessToken()
  if (!calendarId || !accessToken || !eventId) return false

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  )

  // 204 = deleted; 404/410 = already gone — both fine.
  if (res.ok || res.status === 404 || res.status === 410) return true
  console.error('Google Calendar delete error:', res.status, await res.text())
  return false
}
