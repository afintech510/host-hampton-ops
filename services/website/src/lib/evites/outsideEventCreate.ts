/**
 * Screen the admin form that makes an invitation for a client's event at a venue that is not ours
 * (`party_type = 'outside_event'`, migration 096). Pure: it reads nothing and writes nothing.
 *
 *   screenOutsideEvent(body) -> { ok: true, value } | { ok: false, error }
 *
 * `value` is exactly what `POST /api/admin/parties/create` writes for this kind of booking: the
 * columns, and the `party_tags` the invitation reads back (`lib/evites/outsideEvent.ts`). Every field
 * is checked here and nowhere else, because the invitation prints them on a public page:
 *
 *   honoree      the first name on the invitation (required; the page is about them)
 *   occasion     what the event IS ("Baby Shower"; required, 40 characters)
 *   date, time   a real calendar date, and a start the invitation can place (08:00-21:00 Eastern,
 *                the same screen `partyWindow` applies, so a time that passes here is a time the
 *                invitation can show)
 *   end time     optional; after the start and within 12 hours, else refused rather than ignored
 *   venue name   optional; address optional; but one of the two is required, because an invitation
 *                that says "Location to be confirmed" is not one to hand a client
 *   audience     'guests' (adults, the default) or 'kids'
 *
 * Stored times are 24-hour `HH:MM` strings, the form `calendarSync.clockTime` already reads.
 */

import { parseTime } from '@/lib/partyTime'
import { OUTSIDE_EVENT_TYPE } from '@/lib/outsideEventGate'
import { isProvisionalAddress } from '@/lib/partyAddress'
import { cleanLine, OCCASION_MAX, VENUE_NAME_MAX, type EviteAudience } from '@/lib/evites/outsideEvent'
import { OUTSIDE_EVENT_MAX_MIN, PARTY_START_EARLIEST_MIN, PARTY_START_LATEST_MIN, validPartyDate } from '@/lib/evites/partyWindow'

export { OUTSIDE_EVENT_TYPE }
export const OUTSIDE_EVENT_EVENT_TYPE = 'outside-event'
export const HONOREE_MAX = 40
export const ADDRESS_MAX = 200
export const GUEST_COUNT_MAX = 500

export interface OutsideEventScreened {
  honoree: string
  occasion: string
  partyDate: string
  /** 24-hour `HH:MM`. */
  partyTime: string
  guestCount: number | null
  /** The `party_tags` this booking is created with. */
  partyTags: Record<string, string>
  venueName: string | null
  address: string | null
  audience: EviteAudience
}

export type OutsideEventScreen = { ok: true; value: OutsideEventScreened } | { ok: false; error: string }

const bad = (error: string): OutsideEventScreen => ({ ok: false, error })

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** '12:00 PM', '12:00', '3:30pm' -> minutes after midnight, or null when it is not a clock time. */
function minutesOf(raw: unknown): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const t = parseTime(raw.trim())
  if (!t || !Number.isInteger(t.hours) || !Number.isInteger(t.minutes) || t.hours > 23 || t.minutes > 59) return null
  return t.hours * 60 + t.minutes
}

export function screenOutsideEvent(body: Record<string, unknown>): OutsideEventScreen {
  const honoree = cleanLine(body.childName, HONOREE_MAX)
  if (!honoree) return bad("The invitation needs the honoree's name (for a baby shower, the mom-to-be).")

  const occasion = cleanLine(body.occasion, OCCASION_MAX)
  if (!occasion) return bad('Say what the event is (for example, Baby Shower).')

  const partyDate = validPartyDate(body.partyDate)
  if (!partyDate) return bad('The event needs a real date (YYYY-MM-DD).')

  const start = minutesOf(body.partyTime)
  if (start === null || start < PARTY_START_EARLIEST_MIN || start > PARTY_START_LATEST_MIN) {
    return bad('The start time must be a clock time between 8:00 AM and 9:00 PM.')
  }

  let endTag: string | undefined
  if (body.eventEndTime !== undefined && body.eventEndTime !== null && String(body.eventEndTime).trim() !== '') {
    const end = minutesOf(body.eventEndTime)
    if (end === null || end <= start || end - start > OUTSIDE_EVENT_MAX_MIN) {
      return bad('The end time must be after the start time, and within 12 hours of it.')
    }
    endTag = hhmm(end)
  }

  const venueName = cleanLine(body.venueName, VENUE_NAME_MAX)
  const rawAddress = cleanLine(body.locationAddress, ADDRESS_MAX)
  if (rawAddress && isProvisionalAddress(rawAddress)) {
    return bad('That address has no street number, so guests could not find it. Put the venue name in the venue field, and a full street address here.')
  }
  if (!venueName && !rawAddress) return bad("Give the venue's name or its street address.")

  const audience: EviteAudience = body.audience === 'kids' ? 'kids' : 'guests'

  let guestCount: number | null = null
  if (body.guestCount !== undefined && body.guestCount !== null && body.guestCount !== '') {
    const n = Number(body.guestCount)
    if (!Number.isInteger(n) || n < 1 || n > GUEST_COUNT_MAX) return bad(`The guest count must be a whole number from 1 to ${GUEST_COUNT_MAX}.`)
    guestCount = n
  }

  const partyTags: Record<string, string> = {
    // The invitation code reads an outside event as an address we do not host at.
    location_type: 'mobile',
    occasion,
    audience,
    ...(venueName ? { venue_name: venueName } : {}),
    ...(rawAddress ? { location_address: rawAddress } : {}),
    ...(endTag ? { event_end_time: endTag } : {}),
  }

  return {
    ok: true,
    value: { honoree, occasion, partyDate, partyTime: hhmm(start), guestCount, partyTags, venueName, address: rawAddress, audience },
  }
}
