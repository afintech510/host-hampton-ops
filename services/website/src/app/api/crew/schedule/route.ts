import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { loadCrewSettings } from '@/lib/crew/settings'
import { loadAdminOverview } from '@/lib/crew/admin'
import { crewScheduleRowOf, requireBookingViewer } from '@/lib/crew/bookingView'

export const dynamic = 'force-dynamic'

/**
 * GET /api/crew/schedule - the next six weeks of crew parties and who is on each, for a crew member
 * who has the Bookings view (migration 100). The same read as the admin Schedule, through
 * `crewScheduleRowOf`: no alerts, sync flags, pick counts or availability, and no way to change
 * anything. Read only.
 */
export async function GET(req: NextRequest) {
  const gate = await requireBookingViewer(req)
  if (!gate.ok) return gate.response
  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return NextResponse.json({ error: 'Could not read the schedule.' }, { status: 503 })
  const overview = await loadAdminOverview(sb, new Date(), settings.settings)
  if (overview.kind !== 'ok') return NextResponse.json({ error: 'Could not read the schedule.' }, { status: 503 })
  const now = new Date(overview.data.now).getTime()
  // The schedule shows what is ahead (and today): the overview also carries the last 30 days for its alerts.
  return NextResponse.json({
    now: overview.data.now,
    parties: overview.data.parties.filter(p => new Date(p.endsAt).getTime() >= now - 12 * 3_600_000).map(crewScheduleRowOf),
  })
}
