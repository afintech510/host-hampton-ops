/**
 * Where the party is, as far as the evite code needs to know (spec §2, §3).
 *
 * Three questions, all answered from `bookings` and nothing else:
 *
 *   eviteLocationType(booking)   'studio' | 'mobile'
 *   mobileAddressOf(booking)     the customer's address line, or null
 *   mobileTown(address)          the locality for the OG card, or 'Long Island'
 *
 * `party_tags.location_type` (`host_hampton` | `mobile`) is read BEFORE
 * `party_type`: the party planner hard-codes `party_type: 'in_studio_theme'`
 * even for a mobile plan (review 01 s1.1, party-builder/save), while
 * `location_type` is what the planner's own toggle wrote. Only when the tags
 * say nothing does `party_type = 'mobile_party'` decide. Anything undecided is
 * the studio: an in-studio party is the product, and a mobile party mislabelled
 * as studio shows the studio address, which is loud and fixable; the reverse
 * would hide the studio from someone driving to it.
 *
 * The mobile address is `party_tags.location_address` (lib/partyAddress.ts), a
 * free-text line the customer typed on the invoice or the host typed in admin.
 * Pure.
 */

import { isProvisionalAddress } from '@/lib/partyAddress'

export type EviteLocationType = 'studio' | 'mobile'

export interface LocationInput {
  party_type?: string | null
  party_tags?: unknown
}

function tagsOf(tags: unknown): Record<string, unknown> {
  return tags && typeof tags === 'object' && !Array.isArray(tags) ? (tags as Record<string, unknown>) : {}
}

export function eviteLocationType(booking: LocationInput): EviteLocationType {
  const loc = tagsOf(booking.party_tags).location_type
  if (loc === 'mobile') return 'mobile'
  if (loc === 'host_hampton') return 'studio'
  return booking.party_type === 'mobile_party' ? 'mobile' : 'studio'
}

/**
 * The customer's party address, flattened to one line, or null when it is
 * missing or provisional (`isProvisionalAddress`: blank, TBC/TBD, or no digit at
 * all - a town name alone is not somewhere a host can drive to, and the public
 * page must not print "Westhampton, NY" as if it were the venue).
 */
export function mobileAddressOf(booking: LocationInput): string | null {
  const raw = tagsOf(booking.party_tags).location_address
  if (typeof raw !== 'string') return null
  const line = raw.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (line === '' || isProvisionalAddress(line)) return null
  return line.length > 200 ? line.slice(0, 200).trim() : line
}

export const FALLBACK_TOWN = 'Long Island'

const STATE_ONLY = /^(?:ny|n\.y\.|new york|usa|us|united states)$/i
const ZIP_ONLY = /^(?:(?:ny|n\.y\.|new york)\s*)?\d{5}(?:-\d{4})?$/i
const TRAILING_STATE_ZIP = /\s+(?:ny|n\.y\.|new york)(?:\s+\d{5}(?:-\d{4})?)?$/i
const UNIT_PART = /^(?:apt|apartment|unit|suite|ste|fl|floor|bldg|building|rm|room|#)(?![a-z])/i

function titleCaseIfShouty(s: string): string {
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) return s
  return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase())
}

/**
 * The locality of a one-line address, for the OG card (which must not carry a
 * street): the part before the state / ZIP. Three shapes are read:
 *
 *   "12 Main St, Westhampton Beach, NY 11978"   -> Westhampton Beach
 *   "45 Dune Rd, Quogue NY 11959"               -> Quogue
 *   "8 Bay Ave, Eastport"                       -> Eastport
 *
 * Anything else ("1 Ocean Blvd" with no town, a unit in the last slot, a town
 * with digits in it, more than 30 characters) is `Long Island`. A guess that
 * prints the wrong town on a public card is worse than a vague true one.
 */
export function mobileTown(address: string | null | undefined): string {
  if (typeof address !== 'string') return FALLBACK_TOWN
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '')
  // Trailing "NY", "11978", "NY 11978", "USA" parts carry no locality.
  while (parts.length > 0 && (STATE_ONLY.test(parts[parts.length - 1]) || ZIP_ONLY.test(parts[parts.length - 1]))) {
    parts.pop()
  }
  if (parts.length === 0) return FALLBACK_TOWN

  const last = parts[parts.length - 1].replace(TRAILING_STATE_ZIP, '').trim()
  const hasDigit = /\d/.test(last)

  if (parts.length === 1) {
    // "Quogue" alone is a town; "12 Main St Quogue" cannot be split reliably.
    return !hasDigit && last !== '' && last.length <= 30 ? titleCaseIfShouty(last) : FALLBACK_TOWN
  }
  if (last === '' || hasDigit || UNIT_PART.test(last) || last.length > 30) return FALLBACK_TOWN
  return titleCaseIfShouty(last)
}
