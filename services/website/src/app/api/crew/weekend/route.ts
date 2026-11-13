import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { loadWeekendSummary } from '@/lib/crew/weekendSummary'
import { crewWeekendOf, requireBookingViewer } from '@/lib/crew/bookingView'

export const dynamic = 'force-dynamic'

/**
 * GET /api/crew/weekend - the upcoming weekend's prep list (what to gather for each party and in
 * total), for a crew member who has the Bookings view (migration 100). The admin "This weekend:
 * what to prep" data with first names only; it carries no money or contact details. Read only.
 */
export async function GET(req: NextRequest) {
  const gate = await requireBookingViewer(req)
  if (!gate.ok) return gate.response
  const r = await loadWeekendSummary(getSupabase(), new Date())
  if (r.kind !== 'ok') return NextResponse.json({ error: 'Could not read the weekend.' }, { status: 503 })
  return NextResponse.json(crewWeekendOf(r.data))
}
