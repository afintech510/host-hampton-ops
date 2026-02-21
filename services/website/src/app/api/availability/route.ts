import { NextRequest, NextResponse } from 'next/server'

interface BusySlot {
  start: string
  end: string
}

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') // YYYY-MM format
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month param required (YYYY-MM)' }, { status: 400 })
  }

  const calendarId = process.env.GOOGLE_CALENDAR_ID
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN

  // If Calendar isn't configured, return all dates as available
  if (!calendarId || !clientId || !clientSecret || !refreshToken) {
    return NextResponse.json({ blockedDates: [], configured: false })
  }

  try {
    // Get fresh access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      console.error('Google token refresh failed:', tokenData)
      return NextResponse.json({ blockedDates: [], configured: false })
    }

    // Query calendar for busy times in the requested month
    const timeMin = `${month}-01T00:00:00Z`
    const lastDay = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0).getDate()
    const timeMax = `${month}-${String(lastDay).padStart(2, '0')}T23:59:59Z`

    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?` +
      new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        fields: 'items(start,end,summary)',
      }),
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    )

    if (!calRes.ok) {
      console.error('Google Calendar API error:', calRes.status, await calRes.text())
      return NextResponse.json({ blockedDates: [], configured: false })
    }

    const calData = await calRes.json()
    const events = calData.items || []

    // Extract dates that have events (blocked)
    const blockedSet = new Set<string>()
    for (const event of events) {
      const start = event.start?.date || event.start?.dateTime?.split('T')[0]
      if (start) blockedSet.add(start)
    }

    return NextResponse.json({
      blockedDates: Array.from(blockedSet).sort(),
      configured: true,
    })
  } catch (err) {
    console.error('Availability check error:', err)
    return NextResponse.json({ blockedDates: [], configured: false })
  }
}
