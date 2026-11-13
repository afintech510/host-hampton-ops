/**
 * Make the booking behind an invitation for a client's event at a venue that is not ours
 * (`party_type = 'outside_event'`, migration 096). Called by `POST /api/admin/parties/create` when the
 * admin form says so; it returns the HTTP answer rather than a Response so it can be tested without one.
 *
 * It is stored as a CONFIRMED booking with nothing owed, so the invitation goes live (`inviteState`: a
 * status only a booked party carries), and it is kept out of the studio calendar, the crew roster, the
 * review asks and the money reports by its party type. It sends the client NOTHING: no quote, no portal
 * link, no invitation email. The admin looks at the invitation on its Invitation card and sends it from
 * there, as for any other party.
 *
 * The booking write comes first and its failure is the answer (a 500). Everything after it is a side
 * effect that never changes that answer: the audit line, the contact and the invitation are all
 * non-fatal, like every intake (AGENTS.md section 11, "an intake answers 200 only if something landed":
 * here the booking IS the thing that landed).
 */

import type { getSupabase } from '@/lib/supabase'
import { logBookingChange } from '@/lib/bookingAudit'
import { upsertContact } from '@/lib/contacts'
import { generatePartyRef } from '@/lib/partyPricing'
import { ensureEviteNonFatal } from '@/lib/evites/ensureNonFatal'
import { OUTSIDE_EVENT_EVENT_TYPE, OUTSIDE_EVENT_TYPE, screenOutsideEvent } from '@/lib/evites/outsideEventCreate'

type Supa = ReturnType<typeof getSupabase>

export interface OutsideEventAnswer {
  status: number
  body: Record<string, unknown>
}

export async function createOutsideEventBooking(
  supabase: Supa,
  input: { body: Record<string, unknown>; actor: string; origin: string },
): Promise<OutsideEventAnswer> {
  const { body, actor, origin } = input
  const screened = screenOutsideEvent(body)
  if (!screened.ok) return { status: 400, body: { error: screened.error } }
  const v = screened.value

  const contactName = String(body.contactName)
  const contactEmail = String(body.contactEmail)
  const contactPhone = typeof body.contactPhone === 'string' && body.contactPhone.trim() !== '' ? body.contactPhone : null
  const notes = typeof body.notes === 'string' && body.notes.trim() !== '' ? body.notes.slice(0, 2000) : null
  const bookingRef = generatePartyRef()

  const { data: booking, error: dbErr } = await supabase
    .from('bookings')
    .insert({
      booking_ref: bookingRef,
      status: 'confirmed',
      event_type: OUTSIDE_EVENT_EVENT_TYPE,
      party_date: v.partyDate,
      party_time: v.partyTime,
      package_type: null,
      guest_count_approx: v.guestCount,
      child_name: v.honoree,
      contact_name: contactName,
      contact_email: contactEmail,
      contact_phone: contactPhone,
      // Nothing is owed on an invitation, and nothing is priced.
      deposit_amount: 0,
      total_cents: 0,
      balance_due_cents: 0,
      card_fee_rate: 0.03,
      modification_cutoff: null,
      guest_count_cutoff: null,
      party_type: OUTSIDE_EVENT_TYPE,
      source: 'admin',
      quote_snapshot: { outsideEvent: true },
      payment_method_preference: 'card',
      notes,
      party_tags: { date_locked: true, created_by: actor, created_at: new Date().toISOString(), ...v.partyTags },
    })
    .select('id')
    .single()

  if (dbErr || !booking) {
    console.error('Admin outside-event create error:', dbErr?.message)
    return { status: 500, body: { error: dbErr?.message || 'Failed to create the invitation' } }
  }

  await logBookingChange(supabase, { bookingId: booking.id, actor, summary: `Outside-venue invitation created by admin (${v.occasion})` })

  await upsertContact({
    name: contactName,
    email: contactEmail,
    phone: contactPhone,
    sourceDetail: 'Outside-venue invitation — Admin Created',
    serviceInterests: ['event'],
  })

  // NON-FATAL: the booking exists whatever this does. The slug is read back so the admin can open the page.
  await ensureEviteNonFatal(supabase, booking.id as string)
  const { data: evite } = await supabase.from('evites').select('slug').eq('booking_id', booking.id).maybeSingle<{ slug: string }>()

  return {
    status: 200,
    body: {
      ok: true,
      bookingRef,
      bookingId: booking.id,
      inviteUrl: evite?.slug ? `${origin}/i/${evite.slug}` : null,
      adminUrl: `${origin}/admin?tab=parties&ref=${bookingRef}`,
    },
  }
}
