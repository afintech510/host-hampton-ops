import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { loadPartyCard } from '@/lib/assistant/partyCard'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/admin/crew-app/booking/<id> - everything about one booking, for the tile
 * that was opened: the full party card (contact, when, type, theme, activities,
 * add-ons, food, desserts, money) plus the venue and the admin notes. Admin only,
 * read only. The sign-in links are not here; the buttons mint those on demand.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Unknown booking' }, { status: 404 })
  const sb = getSupabase()
  const { data, error } = await sb.from('bookings').select('booking_ref, admin_notes, party_tags').eq('id', params.id).maybeSingle()
  if (error) return NextResponse.json({ error: 'Could not read the booking.' }, { status: 503 })
  if (!data) return NextResponse.json({ error: 'Unknown booking' }, { status: 404 })
  const row = data as { booking_ref: string; admin_notes: string | null; party_tags: Record<string, unknown> | null }
  const card = await loadPartyCard(sb, row.booking_ref)
  if (card.kind === 'absent') return NextResponse.json({ error: 'Unknown booking' }, { status: 404 })
  if (card.kind !== 'ok') return NextResponse.json({ error: 'Could not read the booking.' }, { status: 503 })
  const tags = row.party_tags ?? {}
  return NextResponse.json({
    card: card.card,
    venue: typeof tags.location_address === 'string' ? tags.location_address : typeof tags.address === 'string' ? tags.address : null,
    adminNotes: row.admin_notes,
  })
}
