import type { BookingLineItem, BookingPayment } from '@/types/booking-flow'
import { billedTotalCents, depositIsSeparateFor } from '@/lib/planBalance'

const DEFAULT_CARD_FEE_RATE = 0.03

/**
 * Flat booking deposit that holds a date — owner ruling 2026-09-05, replacing
 * the previous 25%-of-total rate. Applies to ALL bookings: themed parties,
 * party room rentals and studio rentals.
 *
 * Was 25%, so this raises the up-front amount on smaller bookings (a $475
 * weekday rental went from $118.75 to $250) and lowers it on large ones
 * (a $1,950 party went from $487.50 to $250).
 */
export const BOOKING_DEPOSIT_CENTS = 25000

/**
 * Above this total, the deposit is a SHARE of the job rather than the flat $250
 * — owner ruling 2026-09-16, prompted by HH-PTY-NVLCP (Gusto's $4,425 NYC
 * activation, where $250 was asked to hold a five-figure-adjacent corporate
 * date).
 */
export const MAJOR_BOOKING_THRESHOLD_CENTS = 300000
export const MAJOR_BOOKING_DEPOSIT_RATE = 0.5

/* ── Gratuity ──────────────────────────────────────────────────────────────
 *
 * A tip is for the humans who run the party, so it is never part of the plan's
 * total, never credited against the balance, and never anything but the
 * customer's own choice. Our marketing says so out loud (`lib/locations.ts`,
 * `MobilePriceBlock`, the FAQ): no mandatory gratuity.
 *
 * These constants live here, once, because there are now two surfaces that
 * charge a tip — the party-builder portal's Payment Element and the invoice's
 * Payment Link — and a constant declared in two files is a constant nothing is
 * checking. That failure mode has already cost real money on this codebase
 * twice (the card-fee rate, the studio deposit flag).
 */

/** A gratuity, not a second invoice. $1,000 is generous and still a ceiling. */
export const MAX_TIP_CENTS = 100_000

/** What we suggest, and the only figure quoted to a customer as "recommended". */
export const RECOMMENDED_TIP_RATE = 0.1

/** The buttons offered. `0` is first, and is a real choice, not a dark pattern. */
export const TIP_PRESET_PERCENTS = [0, 10, 15, 20] as const

/** A percentage of the party total, rounded to a whole dollar. */
export function tipCentsForPercent(totalCents: number, percent: number): number {
  if (!Number.isFinite(totalCents) || totalCents <= 0) return 0
  return Math.round((totalCents * percent) / 100 / 100) * 100
}

/** The recommended (10%) tip on a total, in cents, rounded to a whole dollar. */
export function recommendedTipCents(totalCents: number): number {
  return tipCentsForPercent(totalCents, RECOMMENDED_TIP_RATE * 100)
}

/**
 * Screen a browser-supplied tip into something safe to charge.
 *
 * The tip is the one figure on the pay paths that is genuinely the customer's
 * to name — it cannot be derived from the plan the way every other amount is.
 * That makes it the only body-supplied number the pay-link route accepts, and
 * it is safe for exactly one reason: **a tip can only ever raise the charge.**
 * The discount-coupon attack that `planPayLinks` is built to refuse does not
 * exist in this direction. It is still clamped, because an unbounded tip is an
 * unbounded charge and a fat-fingered one is a refund conversation.
 */
export function screenTipCents(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.min(Math.max(0, Math.round(n)), MAX_TIP_CENTS)
}

export function calculateCardFee(amountCents: number, rate = DEFAULT_CARD_FEE_RATE): number {
  return Math.round(amountCents * rate)
}

/**
 * The billed total of a set of line items.
 *
 * Delegates to `billedTotalCents`, which is the same function `loadPlanInvoice`
 * totals the customer's document with. It is one line rather than two
 * implementations on purpose: this loop used to be its own copy and it did not
 * know `is_optional` existed, so every caller of it — the studio checkout, the
 * studio edit route, `buildPlanSnapshot` and the kids-menu summary — wrote or
 * displayed a total that INCLUDED add-ons the invoice deliberately excludes.
 */
export function calculateLineItemTotal(items: BookingLineItem[], guestCount: number): number {
  return billedTotalCents(items, guestCount)
}

export function calculateBalanceDue(totalCents: number, payments: Pick<BookingPayment, 'amount_cents' | 'payment_type'>[]): number {
  let paid = 0
  for (const p of payments) {
    if (p.payment_type === 'refund') {
      paid -= p.amount_cents
    } else {
      paid += p.amount_cents
    }
  }
  return Math.max(0, totalCents - paid)
}

export function computeCutoffDates(partyDateStr: string): { modificationCutoff: string; guestCountCutoff: string } {
  const [y, m, d] = partyDateStr.split('-').map(Number)
  const partyDate = new Date(y, m - 1, d)

  const mod = new Date(partyDate)
  mod.setDate(mod.getDate() - 14)

  const guest = new Date(partyDate)
  guest.setDate(guest.getDate() - 7)

  return {
    modificationCutoff: toDateStr(mod),
    guestCountCutoff: toDateStr(guest),
  }
}

/* ── Per-category change cutoffs for paid bookings ──
 * Once the deposit is paid, different parts of the plan lock at different
 * lead times. The customer can always update locked sections by calling us.
 */
export type LockCategory =
  | 'activities'
  | 'desserts'
  | 'entertainment'
  | 'food'
  | 'beverages'
  | 'decor'
  | 'extras'

const CATEGORY_LEAD_DAYS: Record<LockCategory, number> = {
  activities: 21,
  desserts: 21,
  entertainment: 21,
  food: 7,
  beverages: 7,
  decor: 7,
  extras: 7,
}

export function getCategoryLockState(
  category: LockCategory,
  partyDateStr: string | null | undefined,
  nowStr?: string
): { locked: boolean; cutoffDate: string | null; daysBefore: number; reason?: string } {
  const days = CATEGORY_LEAD_DAYS[category]
  if (!partyDateStr) return { locked: false, cutoffDate: null, daysBefore: days }
  const [y, m, d] = partyDateStr.split('-').map(Number)
  const partyDate = new Date(y, m - 1, d)
  const cutoff = new Date(partyDate)
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = toDateStr(cutoff)
  const now = nowStr || todayStr()
  if (now >= cutoffStr) {
    return {
      locked: true,
      cutoffDate: cutoffStr,
      daysBefore: days,
      reason: `Locked since ${formatDateDisplayInternal(cutoffStr)}. Contact us at (631) 998-9325 to make changes.`,
    }
  }
  return { locked: false, cutoffDate: cutoffStr, daysBefore: days }
}

function formatDateDisplayInternal(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export function isModificationAllowed(
  partyDateStr: string,
  changeType: 'full' | 'guest_count',
  nowStr?: string
): { allowed: boolean; reason?: string } {
  const { modificationCutoff, guestCountCutoff } = computeCutoffDates(partyDateStr)
  const now = nowStr || todayStr()

  if (changeType === 'full') {
    if (now >= modificationCutoff) {
      return { allowed: false, reason: `Modifications locked since ${formatDateDisplay(modificationCutoff)}. Contact us at (631) 998-9325 for changes.` }
    }
    return { allowed: true }
  }

  if (now >= guestCountCutoff) {
    return { allowed: false, reason: `Guest count locked since ${formatDateDisplay(guestCountCutoff)}. Contact us at (631) 998-9325 for changes.` }
  }
  return { allowed: true }
}

export function formatMoney(cents: number): string {
  const d = cents / 100
  return d % 1 === 0 ? `$${d.toLocaleString('en-US')}` : `$${d.toFixed(2)}`
}

export function generatePartyRef(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return `HH-PTY-${code}`
}

/**
 * Deposit due to hold a date: a flat $250, never more than the booking total —
 * or **50% once the job reaches $3,000** (owner ruling 2026-09-16).
 *
 * The clamp matters — without it a small booking (e.g. a 1-hour $75 studio
 * slot, if that ever becomes bookable online) would ask for a deposit larger
 * than the whole job and leave a negative balance.
 *
 * Callers MUST pass the total. The old signature defaulted to 0, which was
 * harmless at 25% (0 → $0) but would silently return the full $250 here.
 *
 * ── Why `partyType` is still a parameter ────────────────────────────────────
 *
 * It used to carve a studio rental OUT of the 50% rate, and the reason was
 * sound while it lasted: `depositIsSeparateFor` was true there, so the deposit
 * was charged ON TOP of the full rental rather than coming off it, and applying
 * 50% would not have changed the terms — it would have invented a second charge
 * (a $3,200 rental quoted $3,200 plus a $1,600 "deposit").
 *
 * needs-Adam 41 was ruled on 2026-09-16: the deposit is a reservation payment on
 * every product, studio included, so that rationale is gone and the carve-out
 * with it. `depositIsSeparateFor` now answers false for everything, which makes
 * the guard below inert rather than wrong — it is kept so the ruling remains a
 * single boolean in `lib/planBalance.ts` and reversing it restores the exemption
 * automatically. No live booking's deposit moved: the largest studio rental in
 * production is HH-STU-2CTJ3 at $1,100, well under the $3,000 threshold.
 *
 * Omitting `partyType` applies the rate, which is now what every product does
 * anyway. The refundable damage authorisation (`SECURITY_DEPOSIT_CENTS`, $250
 * since the same ruling) is a different thing entirely and is untouched by any
 * of this — see `hasSecurityHold`.
 */
export function getDepositCents(totalCents: number, partyType?: string | null): number {
  if (!Number.isFinite(totalCents) || totalCents <= 0) return 0
  if (totalCents >= MAJOR_BOOKING_THRESHOLD_CENTS && !depositIsSeparateFor(partyType)) {
    // Rounded to the cent, and it can never exceed the total (the rate is < 1),
    // so the clamp below is not needed on this branch.
    return Math.round(totalCents * MAJOR_BOOKING_DEPOSIT_RATE)
  }
  return Math.min(BOOKING_DEPOSIT_CENTS, totalCents)
}

function toDateStr(d: Date): string {
  const yy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function todayStr(): string {
  const now = new Date()
  return toDateStr(now)
}

function formatDateDisplay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}
