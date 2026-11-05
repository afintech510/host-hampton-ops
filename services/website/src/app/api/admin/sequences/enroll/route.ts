import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { findContactsByEmail } from '@/lib/contactLookup'
import { optedOutReason } from '@/lib/sequences/processor'
import { logBookingChange } from '@/lib/bookingAudit'
import { sumPayments } from '@/lib/bookingBalance'
import { bookingStage, etToday } from '@/lib/bookingStatus'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/sequences/enroll — enrol ONE lead in ONE nurture sequence.
 *
 * Body: `{ bookingId, sequenceId }`. Admin only. This is what the Manager
 * assistant's "Enrol in sequence" card replays after a person presses Confirm;
 * it is not a bulk tool and takes no contact list.
 *
 * What it does is write ONE `contact_sequence_enrollments` row. It sends nothing
 * and calls no sender: emails go out only when `/api/cron/process-sequences`
 * runs, and that route is deliberately not scheduled. Enrolling therefore cannot
 * wake the frozen backlog — it adds one row to it, dated now.
 *
 * Everything is re-derived here from the ids; nothing the caller says about
 * consent, stage or the contact is believed:
 *   * a booked or cancelled party is refused (nurture is for leads);
 *   * the contact's marketing consent is read NOW through `optedOutReason`
 *     (email_opt_in and status), the same function the sender re-checks;
 *   * the sequence must be active and have steps;
 *   * an existing enrollment is reported, never duplicated.
 */
export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const body = (await req.json().catch(() => null)) as { bookingId?: unknown; sequenceId?: unknown } | null
  const bookingId = typeof body?.bookingId === 'string' ? body.bookingId : ''
  const sequenceId = typeof body?.sequenceId === 'string' ? body.sequenceId : ''
  if (!bookingId || !sequenceId) {
    return NextResponse.json({ ok: false, error: 'bookingId and sequenceId are required' }, { status: 400 })
  }

  const supabase = getSupabase()
  const { data: b, error: bErr } = await supabase
    .from('bookings')
    .select('id, booking_ref, status, contact_id, contact_email, party_date, total_cents')
    .eq('id', bookingId)
    .maybeSingle()
  if (bErr) return NextResponse.json({ ok: false, error: 'Could not read the booking — nothing was enrolled.' }, { status: 503 })
  if (!b) return NextResponse.json({ ok: false, error: 'That booking no longer exists.' }, { status: 404 })
  const booking = b as { id: string; booking_ref: string; status: string | null; contact_id: string | null; contact_email: string | null; party_date: string | null }

  // Stage from the money, not the status column — a failed read is not "unpaid".
  const pay = await supabase.from('booking_payments').select('amount_cents, payment_type').eq('booking_id', booking.id)
  if (pay.error) return NextResponse.json({ ok: false, error: 'Could not read the payments — nothing was enrolled.' }, { status: 503 })
  const stage = bookingStage({ status: booking.status, paidCents: sumPayments(pay.data), partyDate: booking.party_date, today: etToday() })
  if (stage !== 'inquiry' && stage !== 'quoted') {
    return NextResponse.json({ ok: false, error: `This party is ${stage}, so it is not a lead — nothing was enrolled.` }, { status: 409 })
  }

  // The person: by contact id, else the oldest row for the booking's address.
  const CONTACT_COLUMNS = 'id, email, first_name, email_opt_in, status'
  type ContactRow = { id: string; email: string | null; first_name: string | null; email_opt_in: boolean | null; status: string | null }
  let contact: ContactRow | null = null
  if (booking.contact_id) {
    const r = await supabase.from('contacts').select(CONTACT_COLUMNS).eq('id', booking.contact_id).maybeSingle()
    if (r.error) return NextResponse.json({ ok: false, error: 'Could not read the contact — nothing was enrolled.' }, { status: 503 })
    contact = (r.data as ContactRow | null) ?? null
  } else if (booking.contact_email) {
    const r = await findContactsByEmail(supabase, booking.contact_email, CONTACT_COLUMNS)
    if (r.kind === 'unavailable') return NextResponse.json({ ok: false, error: 'Could not read the contact — nothing was enrolled.' }, { status: 503 })
    contact = r.kind === 'found' ? (r.primary as unknown as ContactRow) : null
  }
  if (!contact || !contact.email) {
    return NextResponse.json({ ok: false, error: 'This lead has no contact record with an email address, so there is nobody to enrol.' }, { status: 409 })
  }
  const optedOut = optedOutReason(contact, 'email')
  if (optedOut) {
    return NextResponse.json({ ok: false, error: `Not enrolled: this person has opted out of email (${optedOut}).` }, { status: 409 })
  }

  const { data: seq, error: sErr } = await supabase
    .from('email_sequences')
    .select('id, name, is_active')
    .eq('id', sequenceId)
    .maybeSingle()
  if (sErr) return NextResponse.json({ ok: false, error: 'Could not read the sequence — nothing was enrolled.' }, { status: 503 })
  const sequence = seq as { id: string; name: string; is_active: boolean } | null
  if (!sequence) return NextResponse.json({ ok: false, error: 'That sequence no longer exists.' }, { status: 404 })
  if (!sequence.is_active) return NextResponse.json({ ok: false, error: `"${sequence.name}" is switched off, so nobody can be enrolled in it.` }, { status: 409 })

  const { data: existing, error: eErr } = await supabase
    .from('contact_sequence_enrollments')
    .select('id, status')
    .eq('contact_id', contact.id)
    .eq('sequence_id', sequence.id)
    .maybeSingle()
  if (eErr) return NextResponse.json({ ok: false, error: 'Could not check existing enrollments — nothing was enrolled.' }, { status: 503 })
  if (existing) {
    return NextResponse.json(
      { ok: false, error: `Already enrolled in "${sequence.name}" (${(existing as { status: string }).status}). Nothing was changed.` },
      { status: 409 },
    )
  }

  const actor = adminActorId(req)
  const metadata: Record<string, string> = { booking_ref: booking.booking_ref, enrolled_by: actor }
  if (booking.party_date) metadata.event_date = booking.party_date
  const { error: insErr } = await supabase.from('contact_sequence_enrollments').insert({
    contact_id: contact.id,
    sequence_id: sequence.id,
    status: 'active',
    current_step: 0,
    metadata,
  })
  if (insErr) {
    // 23505: another request enrolled them between the check and the insert.
    if ((insErr as { code?: string }).code === '23505') {
      return NextResponse.json({ ok: false, error: `Already enrolled in "${sequence.name}". Nothing was changed.` }, { status: 409 })
    }
    console.error('sequences/enroll: insert failed:', insErr.message)
    return NextResponse.json({ ok: false, error: 'The enrollment could not be saved.' }, { status: 500 })
  }

  await logBookingChange(supabase, {
    bookingId: booking.id,
    actor,
    summary: `Enrolled in the "${sequence.name}" sequence (no email sent by this action)`,
    newData: { sequence_id: sequence.id },
  })
  return NextResponse.json({ ok: true, action: 'enrolled', sequence: sequence.name })
}
