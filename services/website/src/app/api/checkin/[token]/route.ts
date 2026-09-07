import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { upsertContact } from '@/lib/contacts'
import { resolveCheckinToken } from '@/lib/checkinLink'
import { cancelCheckinReminders } from '@/lib/checkinReminders'

export const dynamic = 'force-dynamic'

/**
 * Public, token-gated check-in endpoint.
 *
 * GET  — validate the token and return the minimum needed to render the form.
 * POST — save contact details + address, and record the marketing opt-in.
 *
 * Nothing here is behind a login, so the token is the entire security boundary:
 * no booking data is returned or written until resolveCheckinToken succeeds.
 */

/** Only ever expose these. The booking row holds pricing, admin notes and payment ids. */
function publicBookingView(booking: Record<string, unknown>) {
  return {
    bookingRef: booking.booking_ref,
    partyDate: booking.party_date,
    partyTime: booking.party_time,
    packageType: booking.package_type,
    childName: booking.child_name,
    checkinStatus: booking.checkin_status ?? 'pending',
    agreementSignedAt: booking.checkin_agreement_signed_at ?? null,
    contact: {
      name: booking.contact_name ?? '',
      email: booking.contact_email ?? '',
      phone: booking.contact_phone ?? '',
      addressLine1: booking.checkin_address_line1 ?? '',
      addressLine2: booking.checkin_address_line2 ?? '',
      city: booking.checkin_city ?? '',
      state: booking.checkin_state ?? '',
      postalCode: booking.checkin_postal_code ?? '',
    },
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await resolveCheckinToken(token)

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.reason === 'expired' ? 410 : 404 })
  }

  return NextResponse.json(publicBookingView(result.booking))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await resolveCheckinToken(token)

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.reason === 'expired' ? 410 : 404 })
  }

  const booking = result.booking
  const bookingId = booking.id as string
  const bookingRef = booking.booking_ref as string

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const name = String(body.name ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const phone = String(body.phone ?? '').trim()
  const marketingConsent = body.marketingConsent === true

  if (!name || !email) {
    return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 })
  }

  const supabase = getSupabase()

  // Repeat submissions are expected — the link is shared and texted twice.
  // Last write wins; there is no reason to reject a correction.
  const updates: Record<string, unknown> = {
    contact_name: name,
    contact_email: email,
    contact_phone: phone || null,
    checkin_address_line1: String(body.addressLine1 ?? '').trim() || null,
    checkin_address_line2: String(body.addressLine2 ?? '').trim() || null,
    checkin_city: String(body.city ?? '').trim() || null,
    checkin_state: String(body.state ?? '').trim() || null,
    checkin_postal_code: String(body.postalCode ?? '').trim() || null,
    updated_at: new Date().toISOString(),
  }

  // Details are in, but the agreement may not be signed yet — that flips the
  // status to 'complete' from the SignWell webhook, not from here.
  if ((booking.checkin_status ?? 'pending') === 'pending') {
    updates.checkin_status = 'started'
    updates.checkin_started_at = new Date().toISOString()
  }

  const { error } = await supabase.from('bookings').update(updates).eq('id', bookingId)
  if (error) {
    console.error('checkin:save error:', error)
    return NextResponse.json({ error: 'Could not save your details' }, { status: 500 })
  }

  await recordCheckinConsent({ name, email, phone, bookingId, bookingRef, marketingConsent, booking })

  // If the agreement was already signed on an earlier visit, this submission
  // completes the check-in and the pending texts should stop.
  if (booking.checkin_agreement_signed_at) {
    await supabase.from('bookings').update({
      checkin_status: 'complete',
      checkin_completed_at: new Date().toISOString(),
    }).eq('id', bookingId)
    await cancelCheckinReminders(bookingRef)
  }

  return NextResponse.json({ ok: true })
}

/**
 * Record the marketing opt-in through the same path every other public form
 * uses (lib/contacts.ts → upsertContact), so it lands in the columns the
 * campaign/sequence/reminder senders actually gate on. Deliberately NOT a
 * boolean on the booking row.
 *
 * upsertContact unconditionally resets status→'lead' and source→'direct'. That
 * is harmless on a first-touch lead form, but a check-in is by definition
 * someone who has already booked, so we restore those two fields afterwards
 * rather than demoting a customer back to a lead.
 */
async function recordCheckinConsent({
  name, email, phone, bookingId, bookingRef, marketingConsent, booking,
}: {
  name: string
  email: string
  phone: string
  bookingId: string
  bookingRef: string
  marketingConsent: boolean
  booking: Record<string, unknown>
}): Promise<void> {
  try {
    const supabase = getSupabase()

    const { data: existing } = await supabase
      .from('contacts')
      .select('id, status, source')
      .eq('email', email)
      .maybeSingle()

    const contactId = await upsertContact({
      name,
      email,
      phone: phone || null,
      sourceDetail: `Check-in — ${bookingRef}`,
      serviceInterests: [String(booking.event_type ?? 'kid-party')],
      marketingConsent,
    })

    if (!contactId) {
      // Non-fatal by design: the customer's details are already saved, and a
      // failed consent write must not cost them their check-in.
      console.error('checkin:consent — upsertContact returned null for', email)
      return
    }

    // Undo the status/source clobber described above.
    if (existing && (existing.status !== 'lead' || existing.source !== 'direct')) {
      await supabase
        .from('contacts')
        .update({ status: existing.status, source: existing.source })
        .eq('id', contactId)
    }

    // Note: bookings has no contact_id column (migration 004 recreated the
    // table without one) — booking↔contact is resolved by email everywhere
    // else in this codebase, e.g. lib/reminders.ts. Don't add a second link.

    await supabase.from('contact_interactions').insert({
      contact_id: contactId,
      type: 'form_submission',
      summary: `Pre-arrival check-in — ${bookingRef}`,
      metadata: { bookingId, bookingRef, marketingConsent },
    })
  } catch (err) {
    console.error('checkin:consent error (non-fatal):', err)
  }
}
