import { NextRequest, NextResponse } from 'next/server'
import { guardRate, intakeRule } from '@/lib/rateLimit'
import { logInteraction } from '@/lib/contactInteractions'
import { getSupabase } from '@/lib/supabase'
import { upsertContact } from '@/lib/contacts'
import { resolveCheckinToken, requiresRentalAgreement } from '@/lib/checkinLink'
import { cancelCheckinReminders } from '@/lib/checkinReminders'
import { findContactsByEmail, isPlausibleEmailAddress } from '@/lib/contactLookup'

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
    requiresAgreement: requiresRentalAgreement(booking),
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
  const limited = guardRate(req, intakeRule('checkin'))
  if (limited) return limited

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
  // One definition of "looks like an email address", shared with the portal
  // login — this regex was the third copy (rule 11).
  if (!isPlausibleEmailAddress(email)) {
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

  // Complete the check-in (and stop the pending texts) once there's nothing
  // left to collect: either the agreement was already signed on an earlier
  // visit, or this booking doesn't require one at all (theme/mobile parties —
  // only room rentals carry the liability waiver).
  if (booking.checkin_agreement_signed_at || !requiresRentalAgreement(booking)) {
    const { error: completeErr } = await supabase.from('bookings').update({
      checkin_status: 'complete',
      checkin_completed_at: new Date().toISOString(),
    }).eq('id', bookingId)
    // Rule 19. This write is what stops the pre-arrival texts; if it fails
    // silently the customer has checked in and is texted anyway, and nothing
    // anywhere says which of the two happened.
    if (completeErr) {
      console.error('checkin: could not mark complete for', bookingRef, '—', completeErr.message)
    } else {
      await cancelCheckinReminders(bookingRef)
    }
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

    // Case-INSENSITIVE. `.eq('email', …)` against a lowercased input missed the
    // 21 mixed-case contacts entirely, so `existing` came back null for them and
    // the status/source restore below never ran — meaning a customer who checked
    // in for a party they had already paid for was silently demoted back to
    // `lead`. Same defect as `docs/phase-4-campaign-automation.md` §11.6, in a
    // place that fix did not reach. See lib/contactLookup.ts.
    const existingLookup = await findContactsByEmail(supabase, email, 'id, email, status, source')
    const existing = existingLookup.kind === 'found'
      ? (existingLookup.contacts[0] as unknown as { id: string; status?: string | null; source?: string | null })
      : null
    if (existingLookup.kind === 'unavailable') {
      // Rule 12: we could not tell whether this person exists. Do NOT write the
      // restore below on a guess — say so and let the upsert stand.
      console.error('checkin:consent — contact lookup unavailable:', existingLookup.error)
    }

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
      const { error: restoreErr } = await supabase
        .from('contacts')
        .update({ status: existing.status, source: existing.source })
        .eq('id', contactId)
      if (restoreErr) {
        console.error('checkin:consent — could not restore status/source for', bookingRef, '—', restoreErr.message)
      }
    }

    // NOTE, corrected 2026-09-12: this comment used to read *"bookings has no
    // contact_id column (migration 004 recreated the table without one)"* and
    // tell the reader not to add one. **`bookings.contact_id` has existed since
    // migration 035 §9** — it was added precisely because resolving
    // booking↔contact by email had never worked. Rule 13: a constraint asserted
    // in a comment and contradicted by the schema is worse than no comment.
    // Linking here is left to `linkFirstTouchEvent`/`ensureLeadPlan`, which own
    // that column; this route deliberately writes only consent.

    // Through `logInteraction`, which is typed against
    // `contact_interactions_type_check` and reports a refusal itself. This route
    // already read its error — it was the only one on the surface that did — but a
    // raw insert is still a second implementation of a constrained write, and the
    // type is checked at the call site rather than at 2am (rules 11 and 13).
    const logged = await logInteraction(supabase, {
      contactId,
      type: 'form_submission',
      summary: `Pre-arrival check-in — ${bookingRef}`,
      metadata: { bookingId, bookingRef, marketingConsent },
    })
    // Rule 19: the consent record is the whole point of this function.
    if (!logged) {
      console.error('checkin:consent — interaction write FAILED for', bookingRef)
    }
  } catch (err) {
    console.error('checkin:consent error (non-fatal):', err)
  }
}
