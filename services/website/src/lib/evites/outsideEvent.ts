/**
 * An invitation for a client's event at a venue that is not ours (`party_type =
 * 'outside_event'`, migration 096). Pure; every answer comes from `bookings`.
 *
 *   isOutsideEvent(booking)     the party type says so
 *   occasionOf(booking)         "Baby Shower": what the event IS, as the admin typed it
 *   occasionWords(occasion)     the two slots Glow-family art draws ("BABY" / "SHOWER")
 *   venueNameOf(booking)        "James Joyce": the place's name, never its street
 *   audienceOf(booking)         'kids' | 'guests': who the RSVP form is talking to
 *   eventEndOf(booking)         the stated end ("15:00"), or null
 *
 * These live in `party_tags` (`occasion`, `venue_name`, `audience`,
 * `event_end_time`), the jsonb every admin route already writes, so no column is
 * needed. Every reader narrows the value here and nowhere else: `party_tags` is
 * `unknown` and many writers have touched it.
 *
 * AUDIENCE. An outside event defaults to `guests` (adults: a shower, a retirement
 * party), because the kids' RSVP asks for a child and a parent and a baby shower
 * has neither. An admin who is inviting children to an outside venue (a birthday
 * at a bowling alley) sets `audience: 'kids'` and gets the form exactly as it is.
 * Every other party type is `kids`, which is the product.
 */

import { isOutsideEventType } from '@/lib/outsideEventGate'

export const OCCASION_MAX = 40
export const VENUE_NAME_MAX = 60
export const THEME_WORD_MAX_CHARS = 12

export type EviteAudience = 'kids' | 'guests'

interface TaggedBooking {
  party_type?: string | null
  party_tags?: unknown
}

function tagsOf(tags: unknown): Record<string, unknown> {
  return tags && typeof tags === 'object' && !Array.isArray(tags) ? (tags as Record<string, unknown>) : {}
}

/** Control characters out, runs of whitespace folded, trimmed, cut at `max` characters; '' becomes null. */
export function cleanLine(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (s === '') return null
  return Array.from(s).slice(0, max).join('').trim()
}

export function isOutsideEvent(booking: TaggedBooking | null | undefined): boolean {
  return !!booking && isOutsideEventType(booking.party_type)
}

/** "baby shower" and "BABY SHOWER" become "Baby Shower"; a phrase typed with its own capitals is left alone. */
function titleCaseIfShouty(s: string): string {
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) return s
  return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase())
}

export function occasionOf(booking: TaggedBooking | null | undefined): string | null {
  if (!isOutsideEvent(booking)) return null
  const raw = cleanLine(tagsOf(booking?.party_tags).occasion, OCCASION_MAX)
  return raw === null ? null : titleCaseIfShouty(raw)
}

export function venueNameOf(booking: TaggedBooking | null | undefined): string | null {
  if (!isOutsideEvent(booking)) return null
  return cleanLine(tagsOf(booking?.party_tags).venue_name, VENUE_NAME_MAX)
}

export function audienceOf(booking: TaggedBooking | null | undefined): EviteAudience {
  if (!isOutsideEvent(booking)) return 'kids'
  return tagsOf(booking?.party_tags).audience === 'kids' ? 'kids' : 'guests'
}

/** `HH:MM` (24 hour) when the booking states when the event ends, else null. */
export function eventEndOf(booking: TaggedBooking | null | undefined): string | null {
  if (!isOutsideEvent(booking)) return null
  const raw = tagsOf(booking?.party_tags).event_end_time
  if (typeof raw !== 'string') return null
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw.trim())
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

/**
 * The occasion as the two words Glow-family art draws ("BABY" over "SHOWER"):
 * the last word is the sub line, the rest the main word. A single word ("Retirement")
 * gets the standard sub line, PARTY. Each is held to the 12 characters the evites
 * table allows a theme word, falling back to the first word, then to nothing (the
 * caller keeps the theme it already resolved).
 */
export function occasionWords(occasion: string | null): { word: string; sub: string } | null {
  if (!occasion) return null
  const words = occasion.toUpperCase().split(/\s+/).filter((w) => w !== '')
  if (words.length === 0) return null
  if (words.length === 1) {
    return words[0].length <= THEME_WORD_MAX_CHARS ? { word: words[0], sub: 'PARTY' } : null
  }
  const last = words[words.length - 1]
  const rest = words.slice(0, -1).join(' ')
  const word = rest.length <= THEME_WORD_MAX_CHARS ? rest : words[0]
  if (word.length > THEME_WORD_MAX_CHARS) return null
  return { word, sub: last.length <= THEME_WORD_MAX_CHARS ? last : 'PARTY' }
}
