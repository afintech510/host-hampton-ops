import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef } from '@/lib/portalAuth'
import { isModificationAllowed } from '@/lib/partyPricing'

/**
 * Columns the customer's own portal may see.
 *
 * This was `select('*')`, and `bookings` has **62 columns**. Confirmed against
 * production on 2026-09-12 with a real portal session: the response carried
 * `admin_notes` (12 rows hold one — Adam's internal notes about the customer),
 * `approved_by`, `options_locked_by`, `quote_snapshot`, `portal_token_hash`,
 * `stripe_payment_intent_id`, `stripe_session_id`, `google_calendar_event_id`,
 * `signwell_document_id` and `security_deposit_pi_id`.
 *
 * The check-in route next door already does this properly — `publicBookingView`
 * in `app/api/checkin/[token]/route.ts`, under the comment *"Only ever expose
 * these. The booking row holds pricing, admin notes and payment ids."* The
 * codebase knew, in a comment, in an adjacent file reading the same table for
 * the same audience. Rule 11's sharpest form: a concept defined twice.
 *
 * An ALLOW-list, not a deny-list, so a column added by the next migration is
 * private until somebody decides otherwise.
 */
const PORTAL_BOOKING_COLUMNS = [
  'id', 'booking_ref', 'status', 'event_type', 'party_type',
  'party_date', 'party_time', 'package_type', 'guest_count_approx',
  'child_name', 'child_age',
  'contact_name', 'contact_email', 'contact_phone',
  'deposit_amount', 'total_cents', 'balance_due_cents', 'card_fee_rate',
  'refund_amount_cents', 'paid_in_full_at',
  'modification_cutoff', 'guest_count_cutoff',
  'party_tags', 'notes',
  'payment_method_preference', 'photo_gallery_url', 'invoice_number',
  'agreement_signed_at', 'agreement_pdf_url',
  'security_deposit_status',
  'checkin_status', 'checkin_started_at', 'checkin_completed_at',
  'checkin_address_line1', 'checkin_address_line2',
  'checkin_city', 'checkin_state', 'checkin_postal_code',
  'checkin_agreement_signed_at', 'checkin_agreement_pdf_url',
  'created_at', 'updated_at',
].join(', ')

export async function GET(req: NextRequest) {
  const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
  const cookieHeader = req.headers.get('cookie')
  const bookingRef = getPortalBookingRef(cookieHeader, secret)

  if (!bookingRef) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const supabase = getSupabase()

  const { data: booking, error } = await supabase
    .from('bookings')
    .select(PORTAL_BOOKING_COLUMNS)
    .eq('booking_ref', bookingRef)
    .maybeSingle<Record<string, unknown>>()

  // Rule 12: three outcomes. A blip told as "Booking not found" to a customer
  // holding a valid session is a confident false statement about their party.
  if (error) {
    console.error('portal booking: read failed for', bookingRef, '—', error.message)
    return NextResponse.json({ error: 'Could not load your booking — try again.' }, { status: 503 })
  }
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  // Fetch related data
  const [lineItemsRes, paymentsRes, modificationsRes] = await Promise.all([
    supabase.from('booking_line_items').select('*').eq('booking_id', booking.id).order('sort_order'),
    supabase.from('booking_payments')
      .select('id, amount_cents, card_fee_cents, total_charged_cents, payment_type, payment_method, paid_at, notes, created_at')
      .eq('booking_id', booking.id).order('paid_at', { ascending: false }),
    supabase.from('booking_modifications')
      .select('id, modified_by, change_summary, created_at')
      .eq('booking_id', booking.id).order('created_at', { ascending: false }).limit(20),
  ])

  // Compute modification permissions
  const unlocked = !!(booking.party_tags as Record<string, unknown> | null)?.modifications_unlocked
  const partyDate = (booking.party_date as string | null) ?? null
  const fullMod = isModificationAllowed(partyDate as string, 'full')
  const guestMod = isModificationAllowed(partyDate as string, 'guest_count')

  return NextResponse.json({
    booking: {
      ...booking,
      line_items: lineItemsRes.data || [],
      payments: paymentsRes.data || [],
      modifications: modificationsRes.data || [],
    },
    permissions: {
      canEditFull: unlocked || fullMod.allowed,
      canEditGuestCount: unlocked || guestMod.allowed,
      fullReason: unlocked ? undefined : fullMod.reason,
      guestCountReason: unlocked ? undefined : guestMod.reason,
    },
  })
}

export async function PATCH(req: NextRequest) {
  const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
  const cookieHeader = req.headers.get('cookie')
  const bookingRef = getPortalBookingRef(cookieHeader, secret)

  if (!bookingRef) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const supabase = getSupabase()
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'No valid changes' }, { status: 400 })
  }

  const { data: booking, error: readErr } = await supabase
    .from('bookings')
    .select('id, party_date, status, party_tags')
    .eq('booking_ref', bookingRef)
    .maybeSingle()

  if (readErr) {
    console.error('portal booking PATCH: read failed for', bookingRef, '—', readErr.message)
    return NextResponse.json({ error: 'Could not save that — try again.' }, { status: 503 })
  }
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  // Check if the change type is allowed (admin unlock bypasses date cutoffs)
  const unlocked = !!(booking.party_tags as Record<string, unknown> | null)?.modifications_unlocked
  if (!unlocked) {
    const changeType = body.guest_count_approx !== undefined ? 'guest_count' : 'full'
    const permission = isModificationAllowed(booking.party_date, changeType)
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.reason }, { status: 403 })
    }
  }

  // Only allow certain fields from customer — and only in the SHAPE the column
  // holds. The whitelist was right about which columns; it took whatever JSON
  // arrived for their values, so an object or an array reached the row and the
  // failure surfaced as a 500 rather than a refusal.
  const allowed: Record<string, unknown> = {}
  const asInt = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
    return Number.isInteger(n) && n >= 0 && n <= 10_000 ? n : null
  }
  const asText = (v: unknown, max: number): string | null =>
    typeof v === 'string' && v.length <= max ? v : null

  if (body.guest_count_approx !== undefined) {
    const n = asInt(body.guest_count_approx)
    if (n === null) return NextResponse.json({ error: 'Guest count must be a whole number' }, { status: 400 })
    allowed.guest_count_approx = n
  }
  if (body.notes !== undefined) {
    const t = asText(body.notes, 5000)
    if (t === null) return NextResponse.json({ error: 'Notes must be text under 5000 characters' }, { status: 400 })
    allowed.notes = t
  }
  if (body.child_name !== undefined) {
    const t = asText(body.child_name, 120)
    if (t === null) return NextResponse.json({ error: 'Name must be text under 120 characters' }, { status: 400 })
    allowed.child_name = t
  }
  if (body.child_age !== undefined) {
    const n = asInt(body.child_age)
    if (n === null || n > 120) return NextResponse.json({ error: 'Age must be a whole number' }, { status: 400 })
    allowed.child_age = n
  }

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: 'No valid changes' }, { status: 400 })
  }

  allowed.updated_at = new Date().toISOString()

  const { error: updateErr } = await supabase
    .from('bookings')
    .update(allowed)
    .eq('id', booking.id)

  if (updateErr) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  // Log modification. Rule 19: the audit trail's own write was unchecked, so an
  // edit could land on the booking with nothing recording who changed what.
  const { error: auditErr } = await supabase.from('booking_modifications').insert({
    booking_id: booking.id,
    modified_by: 'customer',
    change_summary: Object.keys(allowed).filter(k => k !== 'updated_at').join(', ') + ' updated',
    old_data: null,
    new_data: allowed,
  })
  if (auditErr) {
    console.error('portal booking PATCH: audit log write FAILED for', bookingRef, '—', auditErr.message)
  }

  return NextResponse.json({ ok: true, audited: !auditErr })
}
