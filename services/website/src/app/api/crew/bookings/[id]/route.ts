import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isUuid } from '@/lib/crew/auth'
import { loadBookedParties } from '@/lib/bookedParties'
import { loadPartyCard } from '@/lib/assistant/partyCard'
import { crewDetailOf, requireBookingViewer, venueOf } from '@/lib/crew/bookingView'

export const dynamic = 'force-dynamic'

/**
 * GET /api/crew/bookings/<id> - one booked party's details for the tile that was opened: the date
 * and time, the child and parent (first names), theme, activities, food, desserts, add-ons and
 * decor, the venue of a mobile party and the manager's notes for the crew. Only a party that is on the
 * Booked list (never a lead), and only through `crewDetailOf`: no money, no contact details, no
 * links. Read only.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireBookingViewer(req)
  if (!gate.ok) return gate.response
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const booked = await loadBookedParties()
  if (!booked.ok) return NextResponse.json({ error: 'Could not read the booking.' }, { status: 503 })
  const party = booked.data.parties.find(p => p.id === params.id)
  if (!party || (party.stage !== 'booked' && party.stage !== 'completed')) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const sb = getSupabase()
  const [card, tags, notes] = await Promise.all([
    loadPartyCard(sb, party.booking_ref),
    sb.from('bookings').select('party_tags').eq('id', party.id).maybeSingle(),
    sb.from('crew_parties').select('notes_for_crew').eq('booking_id', party.id).maybeSingle(),
  ])
  if (card.kind === 'absent') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (card.kind !== 'ok' || tags.error || notes.error) return NextResponse.json({ error: 'Could not read the booking.' }, { status: 503 })
  const t = (tags.data as { party_tags: Record<string, unknown> | null } | null)?.party_tags ?? null
  const n = (notes.data as { notes_for_crew: string | null } | null)?.notes_for_crew ?? null
  return NextResponse.json({ detail: crewDetailOf(card.card, venueOf(t), n && n.trim() ? n.trim() : null) })
}
