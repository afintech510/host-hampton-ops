/**
 * schema.org `Event` JSON-LD for /events/<slug>.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A MODULE AND NOT AN INLINE OBJECT. The page used to build the node
 * inline, and it published `"startDate": "2026-10-09T7:00 PM"` — not ISO 8601,
 * so every Event rich result on the site was invalid and none had ever been
 * eligible for Google's event listings. `events.event_time` is free text typed
 * by a human and the live table holds SEVEN different shapes for it:
 *
 *     '7:00 PM'   '10:00 AM'   '10:00 am'   '9:00 AM'   '6:00'   '10'   '1'
 *
 * The last three carry no meridiem. `'6:00'` is 6am or 6pm and nothing in the
 * row says which — so it is DROPPED, and the event publishes a date-only
 * `startDate` ("2026-10-09"), which is valid ISO 8601 and valid for Event.
 * Rule 15: an input the pipeline cannot interpret must be dropped, never
 * guessed at. A time that is silently four hours wrong in Google's event
 * listing sends people to a closed door; an absent time sends them to the page.
 *
 * The other two things the inline version got wrong:
 *  - `availability` was hardcoded `InStock` even though `available_tickets` is
 *    maintained, so a sold-out event advertised tickets.
 *  - a single `Offer` published the BASE price while the page and the /events
 *    listing both show the cheapest variant ("from $35" against a schema that
 *    said $45). Multi-price events now emit `AggregateOffer` with the real
 *    low/high, which is what the visible page says.
 */

import { isSaleActive, saleAdjustedCents, effectiveBasePriceCents, type EventSaleFields } from './sale'
import { SITE_URL } from './seo'

/** The venue is in Speonk, NY. Times in the `events` table are local to it. */
export const VENUE_TIME_ZONE = 'America/New_York'

export interface EventVariant {
  label: string
  priceCents: number
  seats?: number
}

export interface EventSchemaInput extends EventSaleFields {
  slug: string
  title: string
  description?: string | null
  short_description?: string | null
  event_date?: string | null
  event_time?: string | null
  event_end_time?: string | null
  location?: string | null
  image_url?: string | null
  images?: { url: string; is_primary?: boolean }[] | null
  has_variants?: boolean | null
  variants?: EventVariant[] | null
  available_tickets?: number | null
}

/**
 * Parse a free-text clock time into 24-hour parts, or `null` when the string
 * cannot be read UNAMBIGUOUSLY.
 *
 * Accepted:  '7:00 PM' · '7pm' · '10:00 am' · '09:30AM' · '19:00' · '00:30'
 * Rejected:  '6:00' · '10' · '1' · 'noon' · '10am-1pm' · ''
 *
 * The rejection rule is the whole point: with no meridiem, an hour of 1-12 is
 * genuinely two different times of day. An hour of 0 or 13-23 can only be a
 * 24-hour clock, so those are accepted.
 */
export function parseEventTime(raw: string | null | undefined): { hour: number; minute: number } | null {
  if (!raw) return null
  const s = String(raw).trim()
  // Anchored: a range like '10am-1pm' has two times and no single start we can
  // trust, so it must not match.
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s)
  if (!m) return null

  const rawHour = Number(m[1])
  const minute = m[2] === undefined ? 0 : Number(m[2])
  const meridiem = m[3] ? m[3].toLowerCase() : null

  if (!Number.isInteger(rawHour) || !Number.isInteger(minute)) return null
  if (minute > 59) return null

  if (meridiem) {
    if (rawHour < 1 || rawHour > 12) return null
    const hour = meridiem === 'pm' ? (rawHour === 12 ? 12 : rawHour + 12) : rawHour === 12 ? 0 : rawHour
    return { hour, minute }
  }

  // No meridiem. Only a 24-hour reading is unambiguous.
  if (rawHour >= 1 && rawHour <= 12) return null
  if (rawHour > 23) return null
  return { hour: rawHour, minute }
}

/**
 * The UTC offset at the venue on a given calendar date, as '-04:00' / '-05:00'.
 *
 * Returns `null` rather than a guess if the runtime's ICU data cannot resolve
 * the zone — a small-ICU Node would silently answer UTC, which would shift
 * every event by four or five hours. An absent offset is read as local time by
 * Google, which is the correct reading here anyway; a wrong one is not.
 */
export function venueUtcOffset(dateISO: string): string | null {
  try {
    const at = new Date(`${dateISO}T12:00:00Z`)
    if (Number.isNaN(at.getTime())) return null
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: VENUE_TIME_ZONE,
      timeZoneName: 'shortOffset',
    }).formatToParts(at)
    const name = parts.find(p => p.type === 'timeZoneName')?.value || ''
    const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name)
    if (!m) return null
    return `${m[1]}${m[2].padStart(2, '0')}:${m[3] || '00'}`
  } catch {
    return null
  }
}

/** ISO 8601 datetime for a date + free-text time, degrading to date-only. */
export function toEventDateTime(
  date: string | null | undefined,
  time: string | null | undefined,
): string | undefined {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return undefined
  const d = date.trim()
  const parsed = parseEventTime(time)
  if (!parsed) return d
  const hh = String(parsed.hour).padStart(2, '0')
  const mm = String(parsed.minute).padStart(2, '0')
  const offset = venueUtcOffset(d)
  return `${d}T${hh}:${mm}:00${offset || ''}`
}

/** Every price point the page can show, after any live sale. */
export function eventPriceRangeCents(e: EventSchemaInput, now: Date = new Date()): { low: number; high: number } | null {
  if (typeof e.price_cents !== 'number' || !Number.isFinite(e.price_cents)) return null
  const variantPrices = (e.has_variants && Array.isArray(e.variants) ? e.variants : [])
    .map(v => v?.priceCents)
    .filter((c): c is number => typeof c === 'number' && Number.isFinite(c))
    .map(c => saleAdjustedCents(c, e, now))
  const prices = variantPrices.length > 0 ? variantPrices : [effectiveBasePriceCents(e, now)]
  return { low: Math.min(...prices), high: Math.max(...prices) }
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * The `offers` node, or `undefined` when the event has no price to publish.
 *
 * A price is only ever published if the page is showing one — an `Offer` whose
 * figure disagrees with the visible page is a Google structured-data violation
 * and a customer dispute, in that order of increasing cost.
 */
export function buildEventOffers(e: EventSchemaInput, now: Date = new Date()): Record<string, unknown> | undefined {
  const range = eventPriceRangeCents(e, now)
  if (!range) return undefined

  const soldOut = typeof e.available_tickets === 'number' && e.available_tickets <= 0
  const availability = soldOut ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock'
  const url = `${SITE_URL}/events/${e.slug}`
  const validUntil =
    isSaleActive(e, now) && e.sale_ends_at
      ? { priceValidUntil: new Date(e.sale_ends_at).toISOString().split('T')[0] }
      : {}

  if (range.low !== range.high) {
    return {
      '@type': 'AggregateOffer',
      lowPrice: dollars(range.low),
      highPrice: dollars(range.high),
      priceCurrency: 'USD',
      offerCount: (e.variants || []).length || 2,
      url,
      availability,
      ...validUntil,
    }
  }

  return {
    '@type': 'Offer',
    price: dollars(range.low),
    priceCurrency: 'USD',
    url,
    availability,
    ...validUntil,
  }
}

/** The complete Event node rendered into the page's ld+json script. */
export function buildEventSchema(e: EventSchemaInput, now: Date = new Date()): Record<string, unknown> {
  const imgs = Array.isArray(e.images) ? e.images : []
  const image = e.image_url || (imgs.find(i => i.is_primary) || imgs[0])?.url || null
  const startDate = toEventDateTime(e.event_date, e.event_time)
  const endDate = toEventDateTime(e.event_date, e.event_end_time)
  const offers = buildEventOffers(e, now)

  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: e.title,
    description:
      e.short_description || e.description || `Join us for ${e.title} at Host Hampton in Speonk, NY.`,
    url: `${SITE_URL}/events/${e.slug}`,
    ...(startDate ? { startDate } : {}),
    // Only publish an end time when it is a real instant AFTER the start —
    // '1' parses to nothing and '8:00' is ambiguous, so both degrade to the
    // date, and a date-only endDate equal to startDate says nothing useful.
    ...(endDate && startDate && endDate > startDate ? { endDate } : {}),
    ...(image ? { image: [image] } : {}),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: e.location || 'Host Hampton',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '295 Montauk Hwy, Suite 7',
        addressLocality: 'Speonk',
        addressRegion: 'NY',
        postalCode: '11972',
        addressCountry: 'US',
      },
    },
    organizer: {
      '@type': 'Organization',
      name: 'Host Hampton',
      url: SITE_URL,
    },
    ...(offers ? { offers } : {}),
  }
}
