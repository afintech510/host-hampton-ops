/**
 * Two statuses for every party, derived in ONE place.
 *
 * `bookings.status` grew eleven values written by fourteen writers, and they
 * stopped meaning one thing: on 2026-10-07 `approved` was six parties with a
 * deposit in hand AND four quotes nobody had paid (the customer portal showed
 * those four "Confirmed"); `awaiting_deposit` included a party whose $250 had
 * landed; and 28 parties that had already happened still read `paid_in_full`.
 * Three surfaces each had their own idea of "booked" (the Booked tab, the
 * invoice title, the email-sequence suppressor).
 *
 * So the admin and customer surfaces no longer show the raw column. They show:
 *
 *   * a BOOKING STAGE — Inquiry → Quote sent → Booked → Completed, or one of
 *     the two exits Cancelled / Lost — where "Booked" means money has landed
 *     (or a legacy status that only a booked party ever carried), and
 *     "Completed" is a booked party whose date has passed; and
 *   * a PAYMENT STATUS — Unpaid / Deposit paid / Partly paid / Paid in full —
 *     computed from the payments actually recorded, never stored, so it cannot
 *     drift from the money.
 *
 * The raw column is untouched and still written by the payment paths exactly as
 * before; this module only READS it. That is deliberate: the writers sit on the
 * money path (webhook, confirm-session, record_payment), and re-plumbing them to
 * fix a label would be the wrong trade.
 *
 * No Supabase import, so the admin client components can use it.
 */

import { BOOKING_DEPOSIT_CENTS } from '@/lib/partyPricing'

export const BOOKING_STAGES = ['inquiry', 'quoted', 'booked', 'completed'] as const
export const EXIT_STAGES = ['cancelled', 'lost'] as const
export const ALL_STAGES = [...BOOKING_STAGES, ...EXIT_STAGES] as const
export type BookingStage = (typeof ALL_STAGES)[number]

export const STAGE_LABELS: Record<BookingStage, string> = {
  inquiry: 'Inquiry',
  quoted: 'Quote sent',
  booked: 'Booked',
  completed: 'Completed',
  cancelled: 'Cancelled',
  lost: 'Lost',
}

/** What the CUSTOMER reads. "Quote sent" is our word; theirs is "awaiting deposit". */
export const CUSTOMER_STAGE_LABELS: Record<BookingStage, string> = {
  inquiry: 'Request received',
  quoted: 'Awaiting deposit',
  booked: 'Booked',
  completed: 'Completed',
  cancelled: 'Cancelled',
  lost: 'Closed',
}

/** Tailwind classes for the admin badge. */
export const STAGE_STYLE: Record<BookingStage, string> = {
  inquiry: 'bg-slate-100 text-slate-700',
  quoted: 'bg-indigo-100 text-indigo-700',
  booked: 'bg-green-100 text-green-800',
  completed: 'bg-purple-100 text-purple-700',
  cancelled: 'bg-red-100 text-red-700',
  lost: 'bg-gray-200 text-gray-600',
}

/**
 * Today in Eastern time as `YYYY-MM-DD`, usable in the browser and on the UTC
 * box alike (the box's own clock is UTC — see lib/partyTime.ts).
 */
export function etToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

export function isBookingStage(v: string | null | undefined): v is BookingStage {
  return !!v && (ALL_STAGES as readonly string[]).includes(v)
}

/**
 * Stored statuses that only a booked party ever carries, so they count as
 * booked even when no `booking_payments` row exists — the hand-entered phone
 * bookings (`confirmed`) and parties whose money predates the payments table.
 * `approved` is deliberately NOT here: it is written by the admin Approve
 * button, which has been pressed on quotes nobody paid.
 */
const BOOKED_WITHOUT_MONEY = ['deposit_paid', 'confirmed', 'modifications_locked', 'paid_in_full', 'completed']

/** Stored statuses at which we have priced the party and are waiting on the customer. */
const QUOTED_STATUSES = ['quoted', 'awaiting_deposit', 'approved']

export interface StageInput {
  status: string | null | undefined
  /** Net money credited (refunds subtracted). */
  paidCents: number
  /** `YYYY-MM-DD` or null. */
  partyDate: string | null | undefined
  /** Today in Eastern time, `YYYY-MM-DD`. */
  today: string
}

export function bookingStage({ status, paidCents, partyDate, today }: StageInput): BookingStage {
  if (status === 'cancelled') return 'cancelled'
  if (status === 'lost') return 'lost'
  const booked = paidCents > 0 || (!!status && BOOKED_WITHOUT_MONEY.includes(status))
  if (booked) return partyDate && partyDate < today ? 'completed' : 'booked'
  if (status && QUOTED_STATUSES.includes(status)) return 'quoted'
  return 'inquiry'
}

export const PAYMENT_STATUSES = ['unpaid', 'deposit_paid', 'partly_paid', 'paid_in_full'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: 'Unpaid',
  deposit_paid: 'Deposit paid',
  partly_paid: 'Partly paid',
  paid_in_full: 'Paid in full',
}

export const PAYMENT_STYLE: Record<PaymentStatus, string> = {
  unpaid: 'bg-amber-50 text-amber-700 border border-amber-200',
  deposit_paid: 'bg-blue-50 text-blue-700 border border-blue-200',
  partly_paid: 'bg-cyan-50 text-cyan-700 border border-cyan-200',
  paid_in_full: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
}

export interface PaymentInput {
  /** Billed total; null/0 means the party has not been priced. */
  totalCents: number | null | undefined
  paidCents: number
  /** `bookings.deposit_amount`. */
  depositCents: number | null | undefined
}

/**
 * From the money, never from the status column.
 *
 * "Deposit paid" covers anything up to and including the deposit, so a $100
 * hold on a $250-deposit party reads Deposit paid rather than inventing a
 * fourth word. An unpriced plan with money on it is Deposit paid: there is no
 * total to be paid in full of — `computeBalance` refuses that call for the same
 * reason.
 */
export function paymentStatus({ totalCents, paidCents, depositCents }: PaymentInput): PaymentStatus {
  if (paidCents <= 0) return 'unpaid'
  const total = Number(totalCents) || 0
  if (total <= 0) return 'deposit_paid'
  if (paidCents >= total) return 'paid_in_full'
  // `deposit_amount` is not a reliable floor: 15 rows still carry the old $99
  // default and 9 carry 0, while every deposit taken today is $250 — so a $250
  // payment on one of those rows would read "Partly paid". The deposit is at
  // least the standard one; larger stored deposits (50% on a big mobile party)
  // still win.
  const deposit = Math.max(Number(depositCents) || 0, BOOKING_DEPOSIT_CENTS)
  return paidCents <= deposit ? 'deposit_paid' : 'partly_paid'
}

/**
 * Both statuses for one party. `paidCents` must come from `sumPayments`
 * (lib/bookingBalance.ts) over its `booking_payments` rows — refunds subtract.
 */
export function partyStatuses(input: StageInput & Omit<PaymentInput, 'paidCents'>) {
  return {
    stage: bookingStage(input),
    payment_status: paymentStatus({ totalCents: input.totalCents, paidCents: input.paidCents, depositCents: input.depositCents }),
  }
}
