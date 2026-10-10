/**
 * When a party starts and ends, as UTC instants (spec §2 `partyWindow.ts`).
 *
 *   partyWindow(booking) -> { startUtc, endUtc } | null
 *
 * START is `parseTime(party_time)` on `party_date` through `etToUtc` (the box is
 * UTC; local-time Date setters and date-string concatenation are banned here), and is
 * ACCEPTED ONLY BETWEEN 08:00 AND 21:00 EASTERN, inclusive. That is what stops
 * `party_time = "2:00"` (no AM/PM; `parseTime` reads it as 02:00) from becoming
 * a 2 AM calendar entry: a party time outside the window is "we do not know",
 * and `null` is the honest answer. `Evening`, `TBD`, blank and `23:00` are null
 * for the same reason.
 *
 * `party_date` must be a real `YYYY-MM-DD` calendar date. A bare year or
 * year-month parses to January 1st in some paths and `etToUtc` would roll
 * `2026-02-31` into March, so the SHAPE is screened and the date round-tripped.
 *
 * DURATION in minutes (review 01 s1.2, Q8):
 *
 *   mobile party     90 (Signature, and the default) or 60 (Entry)
 *   mini party       90   `quote_snapshot.isMiniParty === true`
 *                         (the kids-party-menu flag; party-builder/save stores
 *                         the planner's quoteData in `quote_snapshot`)
 *   theme party     120   everything else (webhook calendar block)
 *
 * NOTE on mobile Entry (60) vs Signature (90): nothing on a booking records the
 * mobile TIER. The planner prices mobile by guest-count band (up to 18 / 19-27 /
 * 28+, line item "Mobile Party Package (up to N guests)", category
 * `mobile-package`) while Entry/Signature (`FALLBACK_MOBILE_TIERS`,
 * lib/pricingCatalog.ts) exist only on the marketing page. So Entry is read
 * from an EXPLICIT word - `entry` in `package_type`, or in
 * `quote_snapshot.mobileTier` / `quote_snapshot.tier` / `party_tags.mobile_tier`
 * / `party_tags.tier` - and its absence means Signature's 90. Today no writer
 * sets any of those, so every mobile party is 90 minutes until one does. That is
 * the safe direction: a calendar entry that runs 30 minutes long is harmless,
 * one that ends early is not.
 */

import { parseTime, etToUtc } from '@/lib/partyTime'
import { eviteLocationType } from '@/lib/evites/location'

export const PARTY_START_EARLIEST_MIN = 8 * 60
export const PARTY_START_LATEST_MIN = 21 * 60

export const DURATION_THEME_MIN = 120
export const DURATION_MINI_MIN = 90
export const DURATION_MOBILE_ENTRY_MIN = 60
export const DURATION_MOBILE_SIGNATURE_MIN = 90

export interface PartyWindow {
  startUtc: Date
  endUtc: Date
}

export interface PartyWindowInput {
  party_date?: string | null
  party_time?: string | null
  party_type?: string | null
  package_type?: string | null
  party_tags?: unknown
  quote_snapshot?: unknown
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** `YYYY-MM-DD` (a trailing time part from a timestamp column is ignored) that is a real calendar date, else null. */
export function validPartyDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(raw.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const probe = new Date(Date.UTC(y, mo - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

function isEntryTier(b: PartyWindowInput): boolean {
  const word = (v: unknown) => typeof v === 'string' && /\bentry\b/i.test(v)
  const snap = obj(b.quote_snapshot)
  const tags = obj(b.party_tags)
  return (
    word(b.package_type) ||
    word(snap.mobileTier) ||
    word(snap.tier) ||
    word(tags.mobile_tier) ||
    word(tags.tier)
  )
}

/** Minutes the party runs. */
export function partyDurationMinutes(b: PartyWindowInput): number {
  if (eviteLocationType(b) === 'mobile') {
    return isEntryTier(b) ? DURATION_MOBILE_ENTRY_MIN : DURATION_MOBILE_SIGNATURE_MIN
  }
  if (obj(b.quote_snapshot).isMiniParty === true) return DURATION_MINI_MIN
  return DURATION_THEME_MIN
}

export function partyWindow(booking: PartyWindowInput | null | undefined): PartyWindow | null {
  if (!booking) return null
  const date = validPartyDate(booking.party_date)
  if (!date) return null
  if (typeof booking.party_time !== 'string' || booking.party_time.trim() === '') return null

  const t = parseTime(booking.party_time)
  if (!t || !Number.isInteger(t.hours) || !Number.isInteger(t.minutes) || t.minutes > 59) return null
  const minutes = t.hours * 60 + t.minutes
  if (minutes < PARTY_START_EARLIEST_MIN || minutes > PARTY_START_LATEST_MIN) return null

  const startUtc = etToUtc(date, t.hours, t.minutes)
  if (!Number.isFinite(startUtc.getTime())) return null
  const endUtc = new Date(startUtc.getTime() + partyDurationMinutes(booking) * 60_000)
  return { startUtc, endUtc }
}
