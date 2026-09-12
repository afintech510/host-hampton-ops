/**
 * The invoice view model — one plan, read from the DB, shaped for the summary
 * page (Phase 5 item 1).
 *
 * Kept apart from the page component on purpose: the arithmetic and the studio
 * deposit rule are the parts worth testing, and a React server component is an
 * awkward place to test them. The page renders this and makes no decisions.
 *
 * ── The deposit rule, which differs by product ──────────────────────────────
 *
 * SKILL.md and plan §3 both say it twice, so it is stated once here and obeyed
 * everywhere:
 *
 *   * **Studio rental** — Balance Due is the FULL total. The $250 is a security
 *     deposit held against damage, refundable after the event; it is not a part
 *     payment, so subtracting it would misstate what the client owes. It is
 *     rendered in the `.deposit-callout`, deliberately OUTSIDE `.totals-section`,
 *     because an earlier version put it inside and clients read it as already
 *     deducted.
 *   * **Everything else** — the deposit is a reservation payment and does come
 *     off the balance.
 *
 * The $500 studio security hold is a separate thing again: a refundable card
 * authorisation placed on the day, NOT this deposit, and its value is the
 * catalog key `studio_security_hold`. It is shown as a note, never as a charge.
 */

import { getSupabase } from '@/lib/supabase'
import { getDepositCents } from '@/lib/partyPricing'
import { loadPricingCatalog, type PricingCatalog } from '@/lib/pricingCatalog'
import { loadPlanContent, type PlanContent } from '@/lib/planContent'
import type { BookingLineItem } from '@/types/booking-flow'

type Supa = ReturnType<typeof getSupabase>

export const INVOICE_BOOKING_COLUMNS =
  'id, booking_ref, status, party_type, event_type, package_type, invoice_number, ' +
  'contact_name, contact_email, contact_phone, party_date, party_time, guest_count_approx, ' +
  'child_name, child_age, party_tags, notes, total_cents, deposit_amount, balance_due_cents, created_at'

export interface InvoiceBooking {
  id: string
  booking_ref: string
  status: string | null
  party_type: string | null
  event_type: string | null
  package_type: string | null
  invoice_number: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  party_date: string | null
  party_time: string | null
  guest_count_approx: number | null
  child_name: string | null
  child_age: number | null
  party_tags: Record<string, unknown> | null
  notes: string | null
  total_cents: number | null
  deposit_amount: number | null
  balance_due_cents: number | null
  created_at: string | null
}

export interface InvoiceLineItem {
  name: string
  description: string | null
  amountCents: number
  quantity: number
  isFeatured: boolean
  isOptional: boolean
}

export interface PlanInvoice {
  booking: InvoiceBooking
  partyType: string
  /** The doc title in the header, e.g. "Studio Rental Quotation". */
  docTitle: string
  invoiceNumber: string | null
  dateIssued: string
  /** Featured first, then billed items, then optional ones. */
  lineItems: InvoiceLineItem[]
  totalCents: number
  depositCents: number
  balanceDueCents: number
  /** True for a studio rental: the deposit is NOT deducted from the balance. */
  depositIsSeparate: boolean
  /** The day-of refundable card hold, studio only. Never a charge. */
  securityHoldCents: number | null
  content: PlanContent
  catalog: PricingCatalog
  /** Mobile only, and never showing a price. */
  mobileStations: { name: string; emoji: string | null }[]
  eventDateTime: string | null
  venueAddress: string | null
  guestCount: number | null
}

/** Cents → "$1,234.00". The only money formatter this page uses. */
export function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const DOC_TITLES: Record<string, string> = {
  studio_rental: 'Studio Rental Quotation',
  mobile_party: 'Mobile Party Quotation',
  in_studio_theme: 'Party Quotation',
  unknown: 'Party Quotation',
}

/**
 * Once a deposit is paid the document stops being a quote and becomes the
 * booking record — SKILL.md's own rule for when the title changes.
 */
const BOOKED_STATUSES = new Set(['deposit_paid', 'approved', 'modifications_locked', 'paid_in_full', 'completed'])

export function docTitleFor(partyType: string, status: string | null): string {
  const base = DOC_TITLES[partyType] ?? DOC_TITLES.unknown
  return status && BOOKED_STATUSES.has(status) ? base.replace('Quotation', 'Invoice') : base
}

/** "Saturday, March 14, 2026 · 11:00 AM" — or null when we have no date yet. */
export function formatEventDateTime(date: string | null, time: string | null): string | null {
  if (!date) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return time ? `${date} · ${time}` : date
  // Constructed in UTC and formatted in UTC: a party_date is a calendar day, and
  // building it in local time shifts it a day west of the date line.
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).format(dt)
  return time ? `${day} · ${time}` : day
}

/**
 * Order the line items the way the template lays them out: the featured package
 * first, then everything billed, then the optional add-ons (which carry a tag
 * and are NOT in the total).
 */
export function orderLineItems(rows: BookingLineItem[], guestCount: number): InvoiceLineItem[] {
  const mapped = rows.map(r => {
    const item = r as BookingLineItem & {
      description?: string | null; is_featured?: boolean; is_optional?: boolean
    }
    const unitTotal = item.unit_price_cents * item.quantity
    return {
      name: item.name,
      description: item.description ?? null,
      amountCents: item.guest_multiplied ? unitTotal * guestCount : unitTotal,
      quantity: item.quantity,
      isFeatured: item.is_featured === true,
      isOptional: item.is_optional === true,
    }
  })
  const rank = (i: InvoiceLineItem) => (i.isFeatured ? 0 : i.isOptional ? 2 : 1)
  return mapped.sort((a, b) => rank(a) - rank(b))
}

/**
 * Build the invoice for a plan.
 *
 * The total is RECOMPUTED from the line items rather than trusted from
 * `bookings.total_cents`, for the same reason `buildPlanSnapshot` spreads the
 * caller's `quoteData` first: a stored total can be stale relative to the items
 * beneath it, and an invoice whose rows do not add up to its own total is the
 * one error a client always catches.
 */
export type LoadPlanInvoiceResult =
  | { ok: true; invoice: PlanInvoice }
  /**
   * Three outcomes, not two. `notFound: true` means "there is no such plan";
   * `notFound: false` means "we could not find out". The pay path is why that
   * distinction now has to be carried: a webhook that reads a DB blip as "no
   * such plan" drops a payment that really happened, and a page that reads it
   * as 404 tells a customer their invoice is gone. The caller decides which of
   * those it can tolerate — see api/plan/[ref]/pay-link (503, try again) and
   * lib/planPayment.ts (500, so Stripe redelivers).
   */
  | { ok: false; notFound: boolean; error: string }

export async function loadPlanInvoice(
  bookingRef: string,
  supabase?: Supa,
): Promise<LoadPlanInvoiceResult> {
  const db = supabase ?? getSupabase()

  const { data: bookingRow, error } = await db
    .from('bookings')
    .select(INVOICE_BOOKING_COLUMNS)
    .eq('booking_ref', bookingRef)
    .maybeSingle()
  if (error) return { ok: false, notFound: false, error: error.message }
  if (!bookingRow) return { ok: false, notFound: true, error: 'not found' }

  const booking = bookingRow as unknown as InvoiceBooking
  const partyType = booking.party_type || 'unknown'

  const [{ data: itemRows }, catalog, content] = await Promise.all([
    db.from('booking_line_items').select('*').eq('booking_id', booking.id).order('sort_order', { ascending: true }),
    loadPricingCatalog(db),
    loadPlanContent(partyType, db),
  ])

  const guestCount = booking.guest_count_approx && booking.guest_count_approx > 0 ? booking.guest_count_approx : 0
  const lineItems = orderLineItems((itemRows ?? []) as BookingLineItem[], guestCount || 1)

  // Optional items are quoted, not charged — they must not move the total.
  const billed = lineItems.filter(i => !i.isOptional)
  const totalCents = billed.reduce((sum, i) => sum + i.amountCents, 0)

  const depositCents = getDepositCents(totalCents)
  const depositIsSeparate = partyType === 'studio_rental'
  const balanceDueCents = depositIsSeparate ? totalCents : Math.max(0, totalCents - depositCents)

  const tags = booking.party_tags ?? {}
  const venueAddress = typeof tags.location_address === 'string' ? tags.location_address : null

  // The menu appendix reads as "more you could add", so anything already billed
  // on this booking is removed from it — otherwise it duplicates what they
  // have just been charged for.
  const billedNames = new Set(lineItems.map(i => i.name.trim().toLowerCase()))
  const mobileStations =
    partyType === 'mobile_party'
      ? catalog.mobileStations
          .filter(s => !billedNames.has(s.name.trim().toLowerCase()))
          .map(s => ({ name: s.name, emoji: s.emoji }))
      : []

  return {
    ok: true,
    invoice: {
      booking,
      partyType,
      docTitle: docTitleFor(partyType, booking.status),
      invoiceNumber: booking.invoice_number,
      dateIssued: new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric',
      }).format(new Date()),
      lineItems,
      totalCents,
      depositCents,
      balanceDueCents,
      depositIsSeparate,
      securityHoldCents: depositIsSeparate ? catalog.studioRates.securityDepositCents : null,
      content,
      catalog,
      mobileStations,
      eventDateTime: formatEventDateTime(booking.party_date, booking.party_time),
      venueAddress,
      guestCount: booking.guest_count_approx ?? null,
    },
  }
}
