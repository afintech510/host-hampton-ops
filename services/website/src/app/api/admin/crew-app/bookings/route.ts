import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { etDateString } from '@/lib/partyTime'
import { bookingsWindow, fetchBooked, loadBookingTiles } from '@/lib/crewAppData'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/crew-app/bookings - all booked/completed parties as tiles,
 * with who is staffed on each. Month filtering happens in the admin screen.
 */
export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const booked = await fetchBooked(req)
  if (!booked.ok) return NextResponse.json({ error: booked.error }, { status: 503 })
  const today = etDateString()
  // `?include=<id>` also returns that one booking (a link from Payments to a party outside the window).
  const include = req.nextUrl.searchParams.get('include') ?? undefined
  const r = await loadBookingTiles(getSupabase(), booked.parties, today, include && /^[0-9a-f-]{36}$/i.test(include) ? include : undefined, true)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 503 })
  const linked = include ? r.tiles.find(t => t.id === include && t.stage !== 'booked' && t.stage !== 'completed') ?? null : null
  return NextResponse.json({ bookings: r.tiles.filter(t => t.stage === 'booked' || t.stage === 'completed'), linked, today, ...bookingsWindow(today) })
}
