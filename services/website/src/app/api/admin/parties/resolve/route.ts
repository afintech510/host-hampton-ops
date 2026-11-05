import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/parties/resolve?ref=HH-PTY-XXXXX → `{ id }`
 *
 * The admin dashboard opens a party by its row id; the links in our own
 * notification emails and in the Manager assistant's replies carry the booking
 * REFERENCE (`/admin?tab=parties&ref=HH-PTY-…`). This turns one into the other so
 * those links land on the party instead of on the dashboard home. Admin only, an
 * exact match on the reference (an `.eq`, never a pattern), read only.
 */
export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const ref = (req.nextUrl.searchParams.get('ref') ?? '').trim()
  if (!/^[A-Za-z0-9-]{3,40}$/.test(ref)) {
    return NextResponse.json({ error: 'A booking reference is required' }, { status: 400 })
  }
  const { data, error } = await getSupabase().from('bookings').select('id').eq('booking_ref', ref).maybeSingle()
  if (error) return NextResponse.json({ error: 'Could not look that up' }, { status: 503 })
  if (!data) return NextResponse.json({ error: 'No party with that reference' }, { status: 404 })
  return NextResponse.json({ id: (data as { id: string }).id })
}
