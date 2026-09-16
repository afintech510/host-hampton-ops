import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef, portalSigningSecret } from '@/lib/portalAuth'
import { isModificationAllowed, getDepositCents, BOOKING_DEPOSIT_CENTS } from '@/lib/partyPricing'
import {
  billedTotalCents,
  depositIsSeparateFor,
  isUnpricedPlan,
  planMoney,
  type BilledItem,
  type PaymentRow,
} from '@/lib/planBalance'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { screenPublicGuestCount, MAX_PUBLIC_GUEST_COUNT } from '@/lib/publicIntake'
import { isEditableStatus, isPayableStatus, partyDateIsSet } from '@/lib/portalWrite'
import { PUBLIC_PHONE_DISPLAY } from '@/lib/paymentContacts'

/**
 * A plan with no date has no cutoff to be past.
 *
 * `isModificationAllowed` takes `partyDateStr: string` and immediately runs
 * `partyDateStr.split('-')`. `bookings.party_date` is nullable — three rows are
 * null today, one of them a live `lead` — and both handlers below passed the
 * column in behind an `as string` cast, so a customer whose plan has no date yet
 * got a **500** from their own portal. Rule 8: the cast asserted what the column
 * denies.
 */
function modificationPermission(
  partyDate: unknown,
  changeType: 'full' | 'guest_count',
): { allowed: boolean; reason?: string } {
  if (!partyDateIsSet(partyDate)) return { allowed: true }
  return isModificationAllowed(partyDate, changeType)
}

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

const CANCELLED_REASON =
  `This booking has been cancelled. Give us a call on ${PUBLIC_PHONE_DISPLAY} if that looks wrong.`

export async function GET(req: NextRequest) {
  const secret = portalSigningSecret()
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
  const editable = isEditableStatus(booking.status)
  const fullMod = modificationPermission(partyDate, 'full')
  const guestMod = modificationPermission(partyDate, 'guest_count')

  /*
    What this booking OWES, derived here rather than in the browser.

    `/my-booking` read `balance_due_cents` straight off the row and gated its
    Pay button on `> 0`, so an unpriced plan — which owes 0 for want of a quote,
    not for want of a debt — rendered no way to pay at all. It also carried its
    own hardcoded `9900` deposit preset, which has not been the deposit since
    the flat $250 ruling. Both are now this one server-side answer, from the
    same `planMoney` the invoice and the pay route use (rule 11).
  */
  // `Array.isArray` rather than `|| []` — see the note in party-builder/load:
  // an unexpected shape must not throw inside `billedTotalCents` and take the
  // customer's whole booking page with it.
  const items = (Array.isArray(lineItemsRes.data) ? lineItemsRes.data : []) as BilledItem[]
  const payments = (Array.isArray(paymentsRes.data) ? paymentsRes.data : []) as PaymentRow[]
  const totalCents = billedTotalCents(items, booking.guest_count_approx as number | null)
  const money = planMoney({
    totalCents,
    depositCents: getDepositCents(totalCents),
    depositIsSeparate: depositIsSeparateFor(booking.party_type as string | null),
    payments,
    reservationDepositCents: isPayableStatus(booking.status) ? BOOKING_DEPOSIT_CENTS : 0,
  })

  return NextResponse.json({
    booking: {
      ...booking,
      line_items: lineItemsRes.data || [],
      payments: paymentsRes.data || [],
      modifications: modificationsRes.data || [],
    },
    money: {
      totalCents: money.totalCents,
      outstandingCents: money.outstandingCents,
      depositOwedCents: money.depositOwedCents,
      balanceDueCents: money.balanceDueCents,
      unpriced: isUnpricedPlan(totalCents),
    },
    permissions: {
      // A cancelled booking is not editable however far off its date is, and
      // the PATCH below refuses it — the page must not show an editor the
      // server will reject (rule 10: the two have to say the same thing).
      canEditFull: editable && (unlocked || fullMod.allowed),
      canEditGuestCount: editable && (unlocked || guestMod.allowed),
      fullReason: !editable ? CANCELLED_REASON : unlocked ? undefined : fullMod.reason,
      guestCountReason: !editable ? CANCELLED_REASON : unlocked ? undefined : guestMod.reason,
    },
  })
}

export async function PATCH(req: NextRequest) {
  const limited = guardRate(req, plannerRule('portal/booking'))
  if (limited) return limited

  const secret = portalSigningSecret()
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

  // The four editable columns are read back as well, so the audit row can say
  // what the value WAS. `old_data` was hard-coded `null`, which makes
  // `booking_modifications` a log of the fact that something changed and not of
  // what changed from — the half a human actually needs when a customer rings up
  // to ask why their headcount is wrong.
  const { data: booking, error: readErr } = await supabase
    .from('bookings')
    .select('id, party_date, status, party_tags, guest_count_approx, notes, child_name, child_age')
    .eq('booking_ref', bookingRef)
    .maybeSingle()

  if (readErr) {
    console.error('portal booking PATCH: read failed for', bookingRef, '—', readErr.message)
    return NextResponse.json({ error: 'Could not save that — try again.' }, { status: 503 })
  }
  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  // A cancelled party is not one a customer edits. The date cutoff below does
  // not catch this: a booking cancelled six months before its date is still
  // inside every modification window.
  if (!isEditableStatus(booking.status)) {
    return NextResponse.json({ error: CANCELLED_REASON }, { status: 409 })
  }

  // Check if the change type is allowed (admin unlock bypasses date cutoffs)
  const unlocked = !!(booking.party_tags as Record<string, unknown> | null)?.modifications_unlocked
  if (!unlocked) {
    const changeType = body.guest_count_approx !== undefined ? 'guest_count' : 'full'
    const permission = modificationPermission(booking.party_date, changeType)
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

  /**
   * ── THE GUEST COUNT IS A MONEY INPUT ───────────────────────────────────
   *
   * Link 20 screened `unit_price_cents` because the browser chose it. The
   * MULTIPLIER still came from the browser, through the one route link 20
   * deliberately left out of its rules.
   *
   * `loadPlanInvoice()` computes a guest-multiplied line item as
   * `unit_price_cents × quantity × guest_count_approx`, and
   * `/api/plan/[ref]/pay-link` — which accepts a PORTAL COOKIE for
   * `purpose: 'deposit' | 'balance'` — derives the Stripe charge from that
   * invoice, as does `recordPlanPayment`'s `newBalanceCents`. So the chain was:
   *
   *   PATCH { guest_count_approx: 1 }  →  invoice total drops
   *   POST /api/plan/<ref>/pay-link { purpose: 'balance' }  →  charge follows it
   *   pay  →  `invoice.totalCents - paid === 0`  →  `paid_in_full`
   *
   * Five live bookings carry guest-multiplied items (measured 2026-09-13); the
   * per-head component is $190–$200 on those, and unbounded on any future plan
   * priced per head. The old bound was `0 ≤ n ≤ 10_000`: **zero** removes every
   * per-head charge, and ten thousand multiplies a $20/head item to $200,000.
   *
   * `screenPublicGuestCount` is the bound the public intake routes already use
   * (1…500, seven times the largest real party). Rule 11 — this concept had an
   * owner and this route was not asking it. `lib/plan.ts` and
   * `lib/inquiryDrafts.ts` independently treat `> 0` as the validity test, which
   * is a third and fourth copy of the same idea.
   *
   * What this does NOT do is re-derive `total_cents` / `balance_due_cents` after
   * the change. Those columns go stale against the invoice, which is the same
   * disagreement as needs-Adam 41 and is Adam's to settle — so the delta is put
   * in the audit row below instead, where the Parties tab renders it.
   */
  if (body.guest_count_approx !== undefined) {
    const n = screenPublicGuestCount(body.guest_count_approx)
    if (n === null) {
      return NextResponse.json(
        { error: `Guest count must be a whole number between 1 and ${MAX_PUBLIC_GUEST_COUNT}.` },
        { status: 400 },
      )
    }
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

  /**
   * Capture the BEFORE values before the write, not after it.
   *
   * Written after the UPDATE first, and the route-level test caught it: the
   * audit row recorded the new value as the old one and the summary read
   * *"guest count 2 → 2"*. Against a real PostgREST client `booking` is a
   * freshly parsed object the update does not touch, so it would have been
   * right in production and wrong in the one place that could tell me — which
   * is the same trap from the other side, and exactly why the ordering should
   * not depend on knowing that. Read the old values first and the question
   * does not arise.
   */
  const changedKeys = Object.keys(allowed).filter(k => k !== 'updated_at')
  const oldData: Record<string, unknown> = {}
  for (const k of changedKeys) oldData[k] = (booking as Record<string, unknown>)[k]
  const previousGuestCount = booking.guest_count_approx

  const { error: updateErr } = await supabase
    .from('bookings')
    .update(allowed)
    .eq('id', booking.id)

  if (updateErr) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  // Log modification. Rule 19: the audit trail's own write was unchecked, so an
  // edit could land on the booking with nothing recording who changed what.

  /**
   * Name the guest-count move explicitly, because it is the one field here that
   * moves what the plan costs — see the note on the screen above. `change_summary`
   * is what the Parties tab and the customer's own portal render, so this is the
   * line a human reads when the headcount and the invoice disagree.
   */
  const summary =
    allowed.guest_count_approx !== undefined
      ? `guest count ${String(previousGuestCount ?? '—')} → ${String(allowed.guest_count_approx)}` +
        (changedKeys.length > 1
          ? `; ${changedKeys.filter(k => k !== 'guest_count_approx').join(', ')} updated`
          : '') +
        ' (customer, via portal — per-head pricing follows this number)'
      : changedKeys.join(', ') + ' updated'

  const { error: auditErr } = await supabase.from('booking_modifications').insert({
    booking_id: booking.id,
    modified_by: 'customer',
    change_summary: summary,
    old_data: oldData,
    new_data: allowed,
  })
  if (auditErr) {
    console.error('portal booking PATCH: audit log write FAILED for', bookingRef, '—', auditErr.message)
  }

  return NextResponse.json({ ok: true, audited: !auditErr })
}
