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
 * ── Why `partyType` is a parameter and not ignored ──────────────────────────
 *
 * On every product except a studio rental the deposit COMES OFF the total, so a
 * 50% share is a part payment and the balance simply drops by the same amount.
 * On a studio rental it does not: `depositIsSeparateFor` is true there, which
 * means the deposit is charged ON TOP of the full rental (that is the whole of
 * needs-Adam 41, and `planInvoice` renders it in a callout outside the totals
 * block for exactly this reason). Applying 50% there would not change the terms,
 * it would invent a second charge — a $3,200 rental would be quoted $3,200 plus
 * a $1,600 "deposit". So the rate is deliberately scoped to the products where
 * the deposit is a reservation payment.
 *
 * Omitting `partyType` applies the rate. That is the safe default: every caller
 * that knows it is quoting a studio rental passes it, and a caller that does not
 * know what it is holding is not holding a studio rental — the studio has its
 * own dedicated routes. The separate $500 day-of damage authorisation
 * (`SECURITY_DEPOSIT_CENTS`) is untouched by any of this.
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
