/**
 * Which bookings get an invitation (spec §2 `eligibility.ts`).
 *
 * Eligible when `party_type` is `in_studio_theme` or `mobile_party`; or when
 * `party_type` is NULL / `unknown` and `party_tags.location_type` is
 * `host_hampton` or `mobile` (the values the planner and `admin/parties/create`
 * write). NEVER `studio_rental`, and never a `cancelled` or `lost` booking.
 *
 * `party_type` spellings are the `bookings_party_type_check` values from
 * migration 035. Anything else (including a future value nobody has decided
 * about) is not eligible: a new product does not get a public page by accident.
 *
 * Pure. `party_tags` is jsonb written by many routes, so it is narrowed here.
 */

export interface EviteEligibilityInput {
  status?: string | null
  party_type?: string | null
  party_tags?: unknown
}

const ELIGIBLE_PARTY_TYPES: readonly string[] = ['in_studio_theme', 'mobile_party']
const ELIGIBLE_LOCATION_TYPES: readonly string[] = ['host_hampton', 'mobile']
const EXCLUDED_STATUSES: readonly string[] = ['cancelled', 'lost']

function locationTypeOf(tags: unknown): string | null {
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return null
  const v = (tags as Record<string, unknown>).location_type
  return typeof v === 'string' ? v : null
}

export function isEviteEligible(booking: EviteEligibilityInput | null | undefined): boolean {
  if (!booking) return false
  if (typeof booking.status === 'string' && EXCLUDED_STATUSES.includes(booking.status)) return false

  const pt = booking.party_type
  if (typeof pt === 'string' && pt !== 'unknown') {
    // A real, decided party_type: studio_rental is out, anything unlisted is out.
    return ELIGIBLE_PARTY_TYPES.includes(pt)
  }

  // party_type NULL / 'unknown' (or not a string): fall back to where the
  // planner says the party is.
  const loc = locationTypeOf(booking.party_tags)
  return loc !== null && ELIGIBLE_LOCATION_TYPES.includes(loc)
}
