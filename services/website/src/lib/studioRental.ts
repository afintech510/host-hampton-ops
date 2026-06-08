/**
 * Studio Rental rate engine — full-studio block rental for family events.
 *
 * Pricing (confirmed by owner):
 *   Weekend (Sat–Sun):  $575 / 3 hrs, +$100 per additional hour
 *   Weekday (Mon–Fri):  $450 / 3 hrs, +$75  per additional hour
 *
 * The customer's chosen window includes their own setup + cleanup time.
 * 3 hours is the minimum billable block.
 */

export const STUDIO_MIN_HOURS = 3
export const STUDIO_SEATED_CAPACITY = 65
export const STUDIO_STANDING_CAPACITY = 85
export const SECURITY_DEPOSIT_CENTS = 50000 // $500 refundable CC auth hold, placed day-of
export const DEPOSIT_RATE = 0.25 // 25% reservation deposit

const WEEKEND_BASE_CENTS = 57500
const WEEKDAY_BASE_CENTS = 45000
const WEEKEND_ADDL_HOUR_CENTS = 10000
const WEEKDAY_ADDL_HOUR_CENTS = 7500

export interface StudioRate {
  isWeekend: boolean
  hours: number          // chargeable hours (>= STUDIO_MIN_HOURS)
  baseCents: number      // first 3 hours
  addlHours: number      // hours beyond the 3-hour base
  addlHourCents: number  // total for the additional hours
  rentalCents: number    // baseCents + addlHourCents
  lineItemLabel: string
}

/** True for Saturday (6) or Sunday (0), parsed in local time to avoid TZ drift. */
export function isWeekendDate(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number)
  const day = new Date(y, m - 1, d).getDay()
  return day === 0 || day === 6
}

/**
 * Compute the rental fee for a studio booking.
 * @param dateStr     'YYYY-MM-DD'
 * @param totalHours  full reserved window in hours (clamped to the 3-hr minimum)
 */
export function studioRentalRate(dateStr: string, totalHours: number): StudioRate {
  const isWeekend = isWeekendDate(dateStr)
  const hours = Math.max(STUDIO_MIN_HOURS, Math.round(totalHours))
  const baseCents = isWeekend ? WEEKEND_BASE_CENTS : WEEKDAY_BASE_CENTS
  const addlHours = hours - STUDIO_MIN_HOURS
  const addlHourRate = isWeekend ? WEEKEND_ADDL_HOUR_CENTS : WEEKDAY_ADDL_HOUR_CENTS
  const addlHourCents = addlHours * addlHourRate
  const rentalCents = baseCents + addlHourCents

  return {
    isWeekend,
    hours,
    baseCents,
    addlHours,
    addlHourCents,
    rentalCents,
    lineItemLabel: `Studio Rental — ${isWeekend ? 'Weekend' : 'Weekday'} ${hours} hr${hours === 1 ? '' : 's'}`,
  }
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
