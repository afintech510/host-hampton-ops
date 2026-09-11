/**
 * Studio Rental rate engine — full-studio block rental for family events.
 *
 * Pricing (confirmed by owner):
 *   Weekend (Sat–Sun):  $600 / 3 hrs, +$150 per additional hour
 *   Weekday (Mon–Fri):  $475 / 3 hrs, +$100 per additional hour
 *
 * The customer's chosen window includes their own setup + cleanup time.
 * 3 hours is the minimum billable block.
 *
 * As of migration 036 those figures live in `pricing_items`
 * (category `studio-rental-rate`) and are loaded by `lib/pricingCatalog.ts`.
 * The arithmetic stayed here and stayed SYNCHRONOUS: the studio-rental page
 * re-prices as the customer drags the end time, so it cannot await a query per
 * keystroke. Callers that have a catalog pass its rates to
 * `studioRentalRateWith()`; `studioRentalRate()` is the same function bound to
 * the compiled fallback rates, which is why every pre-036 call site still
 * computes the right number.
 */

import { FALLBACK_STUDIO_RATES, type StudioRates } from '@/lib/pricingCatalog'

export type { StudioRates }

export const STUDIO_MIN_HOURS = FALLBACK_STUDIO_RATES.minHours
// Physical facts about the room, not prices — these stay in code.
export const STUDIO_SEATED_CAPACITY = 65
export const STUDIO_STANDING_CAPACITY = 85
/** $500 refundable CC auth hold, placed day-of. Catalog key `studio_security_hold`. */
export const SECURITY_DEPOSIT_CENTS = FALLBACK_STUDIO_RATES.securityDepositCents
// Booking deposit is a flat $250 for every booking type — see
// BOOKING_DEPOSIT_CENTS / getDepositCents() in lib/partyPricing.ts. The old
// 25% DEPOSIT_RATE that lived here is gone; do not reintroduce a rate.

export interface StudioRate {
  isWeekend: boolean
  hours: number          // chargeable hours (>= STUDIO_MIN_HOURS)
  baseCents: number      // first 3 hours
  addlHours: number      // hours beyond the 3-hour base
  addlHourCents: number  // total for the additional hours (after the cap)
  rentalCents: number    // min(baseCents + addl, full-day cap)
  isFullDay: boolean     // true when the fee is capped at the full-day rate
  lineItemLabel: string
}

/** True for Saturday (6) or Sunday (0), parsed in local time to avoid TZ drift. */
export function isWeekendDate(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number)
  const day = new Date(y, m - 1, d).getDay()
  return day === 0 || day === 6
}

/**
 * Compute the rental fee from an explicit rate card.
 *
 * This is the real implementation; `studioRentalRate()` below is it bound to
 * the fallback rates. Server code that has already loaded the catalog should
 * call this so a price Adam changes in `pricing_items` actually takes effect.
 *
 * @param rates       from `loadPricingCatalog().studioRates`
 * @param dateStr     'YYYY-MM-DD'
 * @param totalHours  full reserved window in hours (clamped to the minimum)
 */
export function studioRentalRateWith(rates: StudioRates, dateStr: string, totalHours: number): StudioRate {
  const isWeekend = isWeekendDate(dateStr)
  const minHours = rates.minHours > 0 ? rates.minHours : FALLBACK_STUDIO_RATES.minHours
  const hours = Math.max(minHours, Math.round(totalHours))
  const baseCents = isWeekend ? rates.weekendBaseCents : rates.weekdayBaseCents
  const addlHours = hours - minHours
  const addlHourRate = isWeekend ? rates.weekendAddlHourCents : rates.weekdayAddlHourCents
  const fullDayCents = isWeekend ? rates.weekendFullDayCents : rates.weekdayFullDayCents

  const uncappedCents = baseCents + addlHours * addlHourRate
  const rentalCents = Math.min(uncappedCents, fullDayCents)
  const isFullDay = rentalCents >= fullDayCents

  return {
    isWeekend,
    hours,
    baseCents,
    addlHours,
    addlHourCents: rentalCents - baseCents,
    rentalCents,
    isFullDay,
    lineItemLabel: isFullDay
      ? `Studio Rental — ${isWeekend ? 'Weekend' : 'Weekday'} Full Day`
      : `Studio Rental — ${isWeekend ? 'Weekend' : 'Weekday'} ${hours} hr${hours === 1 ? '' : 's'}`,
  }
}

/**
 * The pre-036 signature, unchanged, bound to the compiled fallback rates.
 *
 * Kept because a client component prices interactively and a marketing page
 * prices without a DB round trip; both need a synchronous call with no catalog
 * in hand. It returns today's published prices, so a caller that has not been
 * migrated is stale-at-worst, never wrong-by-default.
 */
export function studioRentalRate(dateStr: string, totalHours: number): StudioRate {
  return studioRentalRateWith(FALLBACK_STUDIO_RATES, dateStr, totalHours)
}

/**
 * Whole-hour difference between two 'HH:mm' (24hr) times on the same day.
 * Returns a positive number of hours, rounded to the nearest hour.
 */
export function hoursBetween(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  const mins = (eh * 60 + em) - (sh * 60 + sm)
  return Math.max(0, Math.round(mins / 60))
}
