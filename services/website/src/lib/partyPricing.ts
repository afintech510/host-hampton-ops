import type { BookingLineItem, BookingPayment } from '@/types/booking-flow'

const DEFAULT_CARD_FEE_RATE = 0.03
const DEPOSIT_RATE = 0.25

export function calculateCardFee(amountCents: number, rate = DEFAULT_CARD_FEE_RATE): number {
  return Math.round(amountCents * rate)
}

export function calculateLineItemTotal(items: BookingLineItem[], guestCount: number): number {
  let total = 0
  for (const item of items) {
    const unitTotal = item.unit_price_cents * item.quantity
    total += item.guest_multiplied ? unitTotal * guestCount : unitTotal
  }
  return total
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

export function getDepositCents(totalCents = 0): number {
  // 25% of total, rounded to nearest dollar
  return Math.round((totalCents * DEPOSIT_RATE) / 100) * 100
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
