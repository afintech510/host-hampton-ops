import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cronAuth'
import { getSupabase } from '@/lib/supabase'
import { reconcileCalendar } from '@/lib/calendarSync'

export const dynamic = 'force-dynamic'

/**
 * Reconcile Google Calendar with the bookings table — `lib/calendarSync.ts`.
 *
 * The backstop for every path that changes a party without telling the
 * calendar: a Stripe Payment Link, a GoDaddy import, a status edited in SQL. The
 * admin route syncs a booking the moment it changes; this catches the rest.
 *
 * `?dryRun=1` reports what it WOULD change and touches nothing. A calendar or
 * database that cannot be read is a 503, so the watchdog reports it, and
 * nothing is changed on a partial picture.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1'
  const report = await reconcileCalendar(getSupabase(), { dryRun })
  const unreadable = report.bookingsChecked === 0 && report.errors.length > 0
  return NextResponse.json(report, { status: unreadable ? 503 : 200 })
}
