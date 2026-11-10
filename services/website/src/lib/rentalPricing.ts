import type { StudioRates } from '@/lib/pricingCatalog'
import {
  studioRentalRateWith, hoursBetween, isWeekendDate, customHourlyRateCents, customHourlyRentalPrice,
} from '@/lib/studioRental'

export interface RentalPrice {
  hours: number
  isWeekend: boolean
  rentalCents: number
  /** The rental line's unit price and quantity: custom rate = hourly x hours, rate card = one flat line. */
  unitCents: number
  quantity: number
  lineItemLabel: string
  description?: string
}

/**
 * The ONE answer to "what does this rental cost for this date and window".
 * Admin `edit_rental`, the admin date/time PATCH and the customer's self-serve
 * edit all call it, so the three cannot disagree. An owner-approved hourly rate
 * (`party_tags.custom_hourly_rate_cents`) wins over the rate card, with no
 * 3-hour minimum; the customer edit used to ignore it and re-price a $75/hr
 * photoshoot at the $475-$600 card.
 */
export function priceRentalWindow(
  tags: Record<string, unknown> | null | undefined,
  partyDate: string,
  startTime: string,
  endTime: string,
  studioRates: StudioRates,
): { ok: true; rate: RentalPrice } | { ok: false; error: string } {
  const hours = hoursBetween(startTime, endTime)
  const customRate = customHourlyRateCents(tags)
  if (customRate) {
    if (hours < 1) return { ok: false, error: 'End time must be at least an hour after the start time' }
    const p = customHourlyRentalPrice(tags, customRate, startTime, endTime, hours)
    return {
      ok: true,
      rate: {
        hours: p.hours, isWeekend: isWeekendDate(partyDate), rentalCents: p.rentalCents,
        unitCents: p.unitCents, quantity: p.hours, lineItemLabel: p.lineItemLabel, description: p.description,
      },
    }
  }
  if (hours < studioRates.minHours) return { ok: false, error: `Minimum rental is ${studioRates.minHours} hours` }
  const card = studioRentalRateWith(studioRates, partyDate, hours)
  return { ok: true, rate: { ...card, unitCents: card.rentalCents, quantity: 1 } }
}

/** 'HH:mm' + whole hours -> 'HH:mm', or null if it runs past midnight. */
export function addHoursToTime(start: string, hours: number): string | null {
  const [h, m] = start.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  const end = h * 60 + m + hours * 60
  if (end >= 24 * 60) return null
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
}
