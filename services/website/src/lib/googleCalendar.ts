/**
 * Google Calendar helper — shared by availability API and webhook write-back.
 */

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

  const timeMin = `${month}-01T00:00:00Z`
  const [y, m] = month.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  const timeMax = `${month}-${String(lastDay).padStart(2, '0')}T23:59:59Z`

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
      const dt = new Date(ev.start.dateTime)
      const date = dt.toISOString().split('T')[0]
      const startTime = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`

      const endDt = new Date(ev.end.dateTime!)
      const endTime = `${String(endDt.getHours()).padStart(2, '0')}:${String(endDt.getMinutes()).padStart(2, '0')}`

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
