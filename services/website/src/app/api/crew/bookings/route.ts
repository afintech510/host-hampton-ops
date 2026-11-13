import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { etDateString } from '@/lib/partyTime'
import { loadBookedParties } from '@/lib/bookedParties'
import { loadBookingTiles } from '@/lib/crewAppData'
import { crewTileOf, requireBookingViewer } from '@/lib/crew/bookingView'

export const dynamic = 'force-dynamic'

/**
 * GET /api/crew/bookings - the booked and completed parties as tiles, for a crew member who has the
 * Bookings view (migration 100). The same list the admin Bookings screen reads, through
 * `crewTileOf`: first names, the date, time and guest count, and who is staffed. No money, no
 * contact details, no booking reference. Read only.
 */
export async function GET(req: NextRequest) {
  const gate = await requireBookingViewer(req)
  if (!gate.ok) return gate.response
  const booked = await loadBookedParties()
  if (!booked.ok) return NextResponse.json({ error: 'Could not read the bookings.' }, { status: 503 })
  const today = etDateString()
  const r = await loadBookingTiles(getSupabase(), booked.data.parties, today, undefined, true)
  if (!r.ok) return NextResponse.json({ error: 'Could not read the bookings.' }, { status: 503 })
  return NextResponse.json({
    bookings: r.tiles.filter(t => t.stage === 'booked' || t.stage === 'completed').map(crewTileOf),
    today,
  })
}
