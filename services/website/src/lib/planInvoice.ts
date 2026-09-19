/**
 * The invoice view model — one plan, read from the DB, shaped for the summary
 * page (Phase 5 item 1).
 *
 * Kept apart from the page component on purpose: the arithmetic and the studio
 * deposit rule are the parts worth testing, and a React server component is an
 * awkward place to test them. The page renders this and makes no decisions.
 *
 * ── The deposit rule, which no longer differs by product ────────────────────
 *
 * One rule for everything, since Adam settled needs-Adam 41 on 2026-09-16:
 * **the deposit is a reservation payment and comes off the balance.** A studio
 * rental is no exception. See `STUDIO_DEPOSIT_IS_SEPARATE` in lib/planBalance.ts
 * for the ruling and what it moved.
 *
 * This file used to say the opposite — that a studio rental's $250 was a damage
 * deposit, so Balance Due was the FULL total — while `bookings.balance_due_cents`
 * was written as `total - deposit` on every one of those same rows. The document
 * and the column disagreed by exactly $250 per studio rental.
 *
 * The deposit is still rendered in the `.deposit-callout`, deliberately OUTSIDE
 * `.totals-section`: an earlier version put it inside and clients read it as
 * already deducted. It now IS already deducted, so the callout says so.
 *
 * The studio security hold is a separate thing and always was: a refundable card
 * authorisation placed before the event, NOT this deposit, its value the catalog
 * key `studio_security_hold` ($250 since 2026-09-16). Shown as a note, never as
 * a charge, and never a line in the total.
 */

import { getSupabase } from '@/lib/supabase'
import { getDepositCents, BOOKING_DEPOSIT_CENTS } from '@/lib/partyPricing'
import { isPayableStatus } from '@/lib/portalWrite'
import { loadPricingCatalog, type PricingCatalog } from '@/lib/pricingCatalog'
import { loadPlanContent, type PlanContent } from '@/lib/planContent'
import { depositIsSeparateFor, hasSecurityHold, guestMultiplier, planMoney, type PaymentRow } from '@/lib/planBalance'
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
  /** The FULL deposit for this plan, paid or not. What the callout prints. */
  depositCents: number
  /**
   * What the document prints beside "Balance Due" — and, since link 23, a figure
   * that accounts for what has actually been paid.
   *
   * It used to be `total - the notional deposit`, fixed at quote time and never
   * moved by a payment, which is why `/plan/[ref]/summary` told two customers who
   * had paid in full that they still owed $1,475.00 and $1,560.00. See
   * lib/planBalance.ts for the measurement.
   */
  balanceDueCents: number
  /** Still owed on the deposit. Capped by `outstandingCents` unless separate. */
  depositOwedCents: number
  /** Everything still owed against the total. `deposit + balance` for most plans. */
  outstandingCents: number
  /** Credited against the total so far. */
  paidCents: number
  /** Credited MORE than the total — a refund may be due. */
  overpaidCents: number
  /** The authoritative payment rows every figure above was derived from. */
  payments: PaymentRow[]
  /**
   * Is the deposit held apart from the total rather than deducted from it?
   * `false` for every product since needs-Adam 41 was ruled — see
   * `STUDIO_DEPOSIT_IS_SEPARATE`. Kept on the view model because the page still
   * words the deposit callout from it.
   */
  depositIsSeparate: boolean
  /**
   * The refundable card hold, studio rentals only. Never a charge, never in the
   * total. Gated on `hasSecurityHold(partyType)` and deliberately NOT on
   * `depositIsSeparate` — see that function for the note this would have
   * dropped off every studio quote.
   */
  securityHoldCents: number | null
  content: PlanContent
  catalog: PricingCatalog
  /** Mobile only, and never showing a price. */
  mobileStations: { name: string; emoji: string | null }[]
  eventDateTime: string | null
  venueAddress: string | null
  guestCount: number | null
}

/**
 * May this plan offer an "Edit plan" link to `/party-planner`?
 *
 * Only for an in-studio theme party. `/party-planner` is the in-studio builder;
 * opening it against a mobile party threw a client-side exception, so the link
 * was a dead end on every other party type — and a dead end an admin hands to a
 * customer is worse than no link at all.
 *
 * An ALLOWLIST, not `!== 'mobile_party'`. Studio rentals and the legacy
 * unclassified rows (`party_type` NULL reads as 'unknown' — see
 * party-type-vs-event-type) have never been editable in that builder either, and
 * a deny-list would have to be remembered again for each new type. The safe
 * answer is the default.
 */
export function canEditPlanInBuilder(partyType: string | null | undefined): boolean {
  return partyType === 'in_studio_theme'
}

/**
 * Cents → "$1,234.00". The only money formatter this page uses.
 *
 * The sign goes OUTSIDE the currency symbol: a discount is "-$250.00", never
 * "$-250.00". The old spelling interpolated the whole signed number after the
 * `$`, so every discount line on every quote printed with the minus wedged
 * between the symbol and the digits — including Jessica's "Friends & Fam" on
 * HH-PTY-F47YW. Six live bookings carry a negative line item.
 *
 * Worth more than it looks: `money` is also what `lib/planShare.ts` puts in the
 * emailed and texted summary, so this is a string a customer keeps.
 */
export function money(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
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

export function isBookedStatus(status: string | null | undefined): boolean {
  return !!status && BOOKED_STATUSES.has(status)
}

export function docTitleFor(partyType: string, status: string | null): string {
  const base = DOC_TITLES[partyType] ?? DOC_TITLES.unknown
  return isBookedStatus(status) ? base.replace('Quotation', 'Invoice') : base
}

/**
 * Is this document still a QUOTE — a price nobody has acted on yet?
 *
 * A quote shows Total and the deposit that books the date, and nothing else
 * (owner ruling 2026-09-17): "Balance Due" on a page where no money has moved
 * is arithmetic the customer did not ask for, and it competes with the one
 * number we actually want them to act on.
 *
 * The moment money lands the document stops being a quote and the balance MUST
 * come back — a customer who has paid $250 of $1,100 needs the $850 stated
 * somewhere. So this is deliberately BOTH tests, not just the status: a payment
 * recorded against a booking whose status nobody advanced would otherwise hide
 * a real outstanding balance behind a stale column.
 */
export function isQuoteStage(booking: { status?: string | null }, paidCents: number): boolean {
  return !isBookedStatus(booking.status) && paidCents <= 0
}

/**
 * Sections one specific plan suppresses, read from `party_tags.hidden_sections`.
 *
 * Per-BOOKING, not per-product. The copy in `plan_content` is keyed by party
 * type and is right for the great majority — but a corporate activation is
 * still a `mobile_party`, and the kids' station menu (Glitter Freckles, Adopt a
 * Puppy, Pirate Sword Decorating) does not belong on a quote going to a
 * client's head office. HH-PTY-NVLCP, Gusto's NYC leadership all-hands, is the
 * booking that asked for it.
 *
 * Unknown values are DROPPED, not honoured. `party_tags` is free-form jsonb that
 * several writers merge into, so a stray entry must never be able to blank a
 * section of a customer's invoice that nobody meant to hide.
 */
export const HIDEABLE_SECTIONS = ['mobile_menu', 'good_to_know'] as const
export type HideableSection = (typeof HIDEABLE_SECTIONS)[number]

export function hiddenSectionsFrom(
  tags: Record<string, unknown> | null | undefined,
): Set<HideableSection> {
  const raw = (tags ?? {}).hidden_sections
  if (!Array.isArray(raw)) return new Set()
  return new Set(
    raw.filter((v): v is HideableSection =>
      typeof v === 'string' && (HIDEABLE_SECTIONS as readonly string[]).includes(v),
    ),
  )
}

/**
 * `bookings.party_time` as a customer reads it: "5:00 PM", not "17:00".
 *
 * The column is free text and holds both a 24-hour clock (25 of the 30 live
 * rows) and prose — 'TBD' is a real stored value. So anything that is not
 * exactly HH:MM is passed through verbatim rather than mangled into a guess;
 * only a clock is reformatted.
 *
 * This is deliberately NOT `Intl`/`Date`: there is no date to attach the time
 * to here, and building one would drag the box's timezone (UTC) into a figure
 * that is already local wall-clock time — the same mistake `outbound-send-path`
 * made with `setHours()`.
 */
export function formatClockTime(time: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!m) return time
  const h = Number(m[1])
  const min = m[2]
  if (!Number.isInteger(h) || h > 23 || Number(min) > 59) return time
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${min} ${ampm}`
}

/** "Saturday, March 14, 2026 · 11:00 AM" — or null when we have no date yet. */
export function formatEventDateTime(date: string | null, time: string | null): string | null {
  if (!date) return null
  // The time half is formatted even when the date half cannot be — a row with a
  // free-text date still shows the customer a readable clock.
  const clock = time ? formatClockTime(time) : null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return clock ? `${date} · ${clock}` : date
  // Constructed in UTC and formatted in UTC: a party_date is a calendar day, and
  // building it in local time shifts it a day west of the date line.
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).format(dt)
  return clock ? `${day} · ${clock}` : day
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

  const [{ data: itemRows, error: itemErr }, { data: payRows, error: payErr }, catalog, content] = await Promise.all([
    db.from('booking_line_items').select('*').eq('booking_id', booking.id).order('sort_order', { ascending: true }),
    db.from('booking_payments').select('amount_cents, payment_type').eq('booking_id', booking.id),
    loadPricingCatalog(db),
    loadPlanContent(partyType, db),
  ])

  // A FAILED line-items read is not an empty plan (hard-won rule 12, and the
  // Phase 5 review found this one by exercising it). Every figure below is
  // derived from these rows, so discarding the error yields `totalCents: 0` —
  // and `recordPlanPayment` then computes `max(0, 0 - paid) = 0`, writes
  // `balance_due_cents = 0` and advances the plan to `paid_in_full`. Proven in
  // production on a throwaway plan: a $600 payment against a plan whose items
  // could not be read marked it PAID IN FULL with nothing outstanding.
  //
  // `loadPricingCatalog` and `loadPlanContent` are deliberately NOT treated this
  // way: both have documented per-field fallbacks to today's real values, so a
  // failure there renders the right prose and prices. Nothing falls back for the
  // line items, because they are the plan.
  if (itemErr) return { ok: false, notFound: false, error: `line items: ${itemErr.message}` }

  // The payments read is treated exactly like the line items, and for the same
  // reason: since link 23 every figure below depends on it, so discarding the
  // error would say "nothing has been paid" about a plan that has been. That is
  // the rule-12 shape that told a paid-in-full customer they owed $1,475.00 —
  // except it would now do it on a DB blip rather than by design. A caller that
  // cannot read the payments gets no invoice at all; `/plan/[ref]/summary`
  // renders "we couldn't load this plan", which states no balance and offers no
  // pay button, and the pay route answers 503.
  if (payErr) return { ok: false, notFound: false, error: `payments: ${payErr.message}` }
  const payments = (payRows ?? []) as PaymentRow[]

  const lineItems = orderLineItems((itemRows ?? []) as BookingLineItem[], guestMultiplier(booking.guest_count_approx))

  // Optional items are quoted, not charged — they must not move the total.
  const billed = lineItems.filter(i => !i.isOptional)
  const totalCents = billed.reduce((sum, i) => sum + i.amountCents, 0)

  const depositCents = getDepositCents(totalCents, partyType)
  const depositIsSeparate = depositIsSeparateFor(partyType)
  // An unpriced plan can still take the flat deposit that reserves its date —
  // see `isUnpricedPlan`. Withheld on a booking that may not take money at all,
  // so a cancelled party cannot offer a customer a "reserve your date" button.
  const reservationDepositCents = isPayableStatus(booking.status) ? BOOKING_DEPOSIT_CENTS : 0
  const m = planMoney({ totalCents, depositCents, depositIsSeparate, payments, reservationDepositCents })

  const tags = booking.party_tags ?? {}
  const venueAddress = typeof tags.location_address === 'string' ? tags.location_address : null
  const hidden = hiddenSectionsFrom(tags)

  // The menu appendix reads as "more you could add", so anything already billed
  // on this booking is removed from it — otherwise it duplicates what they
  // have just been charged for.
  const billedNames = new Set(lineItems.map(i => i.name.trim().toLowerCase()))
  const mobileStations =
    partyType === 'mobile_party' && !hidden.has('mobile_menu')
      ? catalog.mobileStations
          .filter(s => !billedNames.has(s.name.trim().toLowerCase()))
          .map(s => ({ name: s.name, emoji: s.emoji }))
      : []

  // Suppressed HERE rather than in the page, so every reader of the invoice —
  // the document, and anything that renders from it later — agrees about what
  // this quote contains. The page already hides the block when both are empty.
  const shownContent = hidden.has('good_to_know')
    ? { ...content, goodToKnow: [], policies: [] }
    : content

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
      balanceDueCents: m.balanceDueCents,
      depositOwedCents: m.depositOwedCents,
      outstandingCents: m.outstandingCents,
      paidCents: m.paidCents,
      overpaidCents: m.overpaidCents,
      payments,
      depositIsSeparate,
      securityHoldCents: hasSecurityHold(partyType) ? catalog.studioRates.securityDepositCents : null,
      content: shownContent,
      catalog,
      mobileStations,
      eventDateTime: formatEventDateTime(booking.party_date, booking.party_time),
      venueAddress,
      guestCount: booking.guest_count_approx ?? null,
    },
  }
}
