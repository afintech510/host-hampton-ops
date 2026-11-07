import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { etDateString } from '@/lib/partyTime'
import { bookingsWindow, fetchBooked, loadBookingTiles } from '@/lib/crewAppData'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/crew-app/bookings - the booked parties of this month and the next
 * two, as tiles, with who is staffed on each. Admin only, read only.
 */
export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const booked = await fetchBooked(req)
  if (!booked.ok) return NextResponse.json({ error: booked.error }, { status: 503 })
  const today = etDateString()
  const r = await loadBookingTiles(getSupabase(), booked.parties, today)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 503 })
  return NextResponse.json({ bookings: r.tiles, today, ...bookingsWindow(today) })
}
