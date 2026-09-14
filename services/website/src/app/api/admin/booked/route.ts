import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { sumPayments, computeBalance } from '@/lib/bookingBalance'
import { foodSelectionsFromColumns, type FoodSelections } from '@/lib/partyFood'

export const dynamic = 'force-dynamic'

/**
 * "Which parties are actually BOOKED" — the list Adam asked for on 2026-09-14.
 *
 * The Parties tab is a PIPELINE: every lead, every abandoned duplicate, every
 * unquoted enquiry, ordered by when it arrived. That is the right shape for
 * triage and the wrong shape for the question "who is definitely coming, and
 * what do they still owe" — which is answered by exactly one thing: **has money
 * landed on this booking.**
 *
 * ── Why "money landed" is not the same as `status` ────────────────────────
 *
 * `status` is a human's opinion; `booking_payments` is the receipt. They
 * disagree in production in both directions and both directions are load-bearing:
 *
 *   * `approved` with a $250 Venmo row on it IS booked. Eight of the seventeen
 *     paid bookings on 2026-09-14 sat on `approved`, because nobody re-stages a
 *     party after taking the deposit. Filtering on status would have hidden them.
 *   * `deposit_paid` with NO payment row is a legacy row from before
 *     `booking_payments` was written to — real parties, but the amount is not
 *     evidence, it is a memory.
 *
 * So this route unions both and says WHICH it is, per row, in `evidence`.
 * Nothing here infers a payment from a status or a status from a payment.
 *
 * ── Why the payments are read first, not joined ───────────────────────────
 *
 * PostgREST embeds (`bookings?select=*,booking_payments(*)`) would be one call,
 * but the filter we need is "bookings that HAVE a payment row", and an embedded
 * resource cannot restrict the parent without `!inner`, which then also drops
 * the legacy `deposit_paid` rows above. Reading payments first and resolving the
 * ids is the shape that keeps both halves.
 */

/** Statuses that mean "this party is on the books" even with no payment row. */
const BOOKED_STATUSES = ['deposit_paid', 'paid_in_full', 'modifications_locked', 'confirmed', 'completed']

/** `bookings` rows that are not parties — same exclusion the Parties tab uses. */
const NON_PARTY_EVENT_TYPES = ['vendor_registration']

/**
 * Cap on payment rows scanned. The business has taken 22 recorded payments in
 * its life, so this is years of headroom; it exists so a runaway table cannot
 * turn this tab into a full scan. When it is hit the response says so.
 */
const PAYMENT_SCAN_LIMIT = 5000

/**
 * A `.in()` filter is spelled into the URL, and PostgREST refuses one past
 * roughly 390 uuids. Chunked — and a failed chunk fails the WHOLE read, because
 * a partial list of booked parties that looks complete is worse than an error.
 */
const IN_FILTER_CHUNK = 200

const BOOKING_COLUMNS =
  'id, booking_ref, status, party_type, event_type, source, party_date, party_time, package_type, ' +
  'guest_count_approx, child_name, child_age, contact_name, contact_email, contact_phone, ' +
  'total_cents, balance_due_cents, deposit_amount, invoice_number, notes, admin_notes, ' +
  'approved_at, paid_in_full_at, photo_gallery_url, checkin_status, created_at, ' +
  'pizza_or_bagels:quote_snapshot->>pizzaOrBagels, ' +
  'cupcake_flavor:quote_snapshot->>cupcakeFlavor, ' +
  'add_mobile_cupcakes:quote_snapshot->>addMobileCupcakes'

interface PaymentRow {
  booking_id: string
  payment_type: string
  payment_method: string | null
  amount_cents: number
  paid_at: string | null
}

export interface BookedParty {
  id: string
  booking_ref: string
  status: string
  party_type: string | null
  event_type: string | null
  source: string | null
  party_date: string | null
  party_time: string | null
  package_type: string | null
  guest_count_approx: number | null
  child_name: string | null
  child_age: number | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  total_cents: number | null
  /** Recomputed here from the receipts — NOT the stored `balance_due_cents`. */
  balance_cents: number
  /** What the row itself claims, so a drift between the two is visible. */
  stored_balance_cents: number | null
  paid_cents: number
  overpaid_cents: number
  paid_in_full: boolean
  invoice_number: string | null
  notes: string | null
  admin_notes: string | null
  photo_gallery_url: string | null
  checkin_status: string | null
  approved_at: string | null
  paid_in_full_at: string | null
  created_at: string | null
  food: FoodSelections
  /** How we know this is booked. See the header. */
  evidence: 'payment' | 'status_only'
  payment_count: number
  payment_methods: string[]
  first_paid_at: string | null
  last_paid_at: string | null
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()

  // ── 1. Every recorded payment, grouped by booking ──
  const { data: payRows, error: payErr } = await supabase
    .from('booking_payments')
    .select('booking_id, payment_type, payment_method, amount_cents, paid_at')
    .order('paid_at', { ascending: true })
    .limit(PAYMENT_SCAN_LIMIT)

  if (payErr) {
    // Rule 12. An unreadable payments table cannot render as "no party has been
    // paid" — that is a screen that would have Adam chasing settled customers.
    console.error('admin/booked: booking_payments read failed —', payErr.message)
    return NextResponse.json(
      { error: `Could not read payments: ${payErr.message}` },
      { status: 503 },
    )
  }

  const payments = (payRows ?? []) as PaymentRow[]
  const byBooking = new Map<string, PaymentRow[]>()
  for (const p of payments) {
    if (!p.booking_id) continue
    const list = byBooking.get(p.booking_id)
    if (list) list.push(p)
    else byBooking.set(p.booking_id, [p])
  }

  // ── 2. The bookings behind those payments, plus the legacy status-only ones ──
  const paidIds = Array.from(byBooking.keys())
  const rows: Record<string, unknown>[] = []
  const seen = new Set<string>()

  for (let i = 0; i < paidIds.length; i += IN_FILTER_CHUNK) {
    const chunk = paidIds.slice(i, i + IN_FILTER_CHUNK)
    const { data, error } = await supabase
      .from('bookings')
      .select(BOOKING_COLUMNS)
      .in('id', chunk)
      .not('event_type', 'in', `(${NON_PARTY_EVENT_TYPES.join(',')})`)
    if (error) {
      console.error('admin/booked: bookings chunk read failed —', error.message)
      return NextResponse.json(
        { error: `Could not read bookings: ${error.message}` },
        { status: 503 },
      )
    }
    // Cast via `unknown`: the generated types cannot describe a `->>` jsonb
    // alias in a select string, so they widen to GenericStringError[].
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      const id = String(r.id)
      if (seen.has(id)) continue
      seen.add(id)
      rows.push(r)
    }
  }

  const { data: statusRows, error: statusErr } = await supabase
    .from('bookings')
    .select(BOOKING_COLUMNS)
    .in('status', BOOKED_STATUSES)
    .not('event_type', 'in', `(${NON_PARTY_EVENT_TYPES.join(',')})`)
  if (statusErr) {
    console.error('admin/booked: status read failed —', statusErr.message)
    return NextResponse.json(
      { error: `Could not read bookings: ${statusErr.message}` },
      { status: 503 },
    )
  }
  for (const r of (statusRows ?? []) as unknown as Record<string, unknown>[]) {
    const id = String(r.id)
    if (seen.has(id)) continue
    seen.add(id)
    rows.push(r)
  }

  // ── 3. Derive ──
  const parties: BookedParty[] = rows.map(r => {
    const id = String(r.id)
    const mine = byBooking.get(id) ?? []
    const paidSum = sumPayments(mine)
    const total = typeof r.total_cents === 'number' ? r.total_cents : null
    const bal = computeBalance(total, paidSum)
    const dates = mine.map(p => p.paid_at).filter((d): d is string => !!d).sort()

    return {
      id,
      booking_ref: String(r.booking_ref ?? ''),
      status: String(r.status ?? ''),
      party_type: (r.party_type as string | null) ?? null,
      event_type: (r.event_type as string | null) ?? null,
      source: (r.source as string | null) ?? null,
      party_date: (r.party_date as string | null) ?? null,
      party_time: (r.party_time as string | null) ?? null,
      package_type: (r.package_type as string | null) ?? null,
      guest_count_approx: (r.guest_count_approx as number | null) ?? null,
      child_name: (r.child_name as string | null) ?? null,
      child_age: (r.child_age as number | null) ?? null,
      contact_name: (r.contact_name as string | null) ?? null,
      contact_email: (r.contact_email as string | null) ?? null,
      contact_phone: (r.contact_phone as string | null) ?? null,
      total_cents: total,
      balance_cents: bal.balanceCents,
      stored_balance_cents: (r.balance_due_cents as number | null) ?? null,
      paid_cents: paidSum,
      overpaid_cents: bal.overpaidCents,
      paid_in_full: bal.paidInFull,
      invoice_number: (r.invoice_number as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      admin_notes: (r.admin_notes as string | null) ?? null,
      photo_gallery_url: (r.photo_gallery_url as string | null) ?? null,
      checkin_status: (r.checkin_status as string | null) ?? null,
      approved_at: (r.approved_at as string | null) ?? null,
      paid_in_full_at: (r.paid_in_full_at as string | null) ?? null,
      created_at: (r.created_at as string | null) ?? null,
      food: foodSelectionsFromColumns(
        r.pizza_or_bagels as string | null,
        r.cupcake_flavor as string | null,
        r.add_mobile_cupcakes as string | null,
      ),
      evidence: mine.length ? 'payment' : 'status_only',
      payment_count: mine.length,
      payment_methods: Array.from(new Set(mine.map(p => p.payment_method).filter((m): m is string => !!m))),
      first_paid_at: dates[0] ?? null,
      last_paid_at: dates[dates.length - 1] ?? null,
    }
  })

  // Soonest party first, undated last — the order Adam works in.
  parties.sort((a, b) => {
    if (!a.party_date && !b.party_date) return a.booking_ref.localeCompare(b.booking_ref)
    if (!a.party_date) return 1
    if (!b.party_date) return -1
    return a.party_date.localeCompare(b.party_date)
  })

  const collected = parties.reduce(
    (acc, p) => {
      acc.paid += p.paid_cents
      acc.outstanding += p.balance_cents
      return acc
    },
    { paid: 0, outstanding: 0 },
  )

  return NextResponse.json({
    parties,
    totals: {
      count: parties.length,
      withPaymentRow: parties.filter(p => p.evidence === 'payment').length,
      paidCents: collected.paid,
      outstandingCents: collected.outstanding,
    },
    // True when the payment cap was hit, i.e. the sums are a floor not a total.
    truncated: payments.length >= PAYMENT_SCAN_LIMIT,
  })
}
