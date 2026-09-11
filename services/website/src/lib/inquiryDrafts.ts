/**
 * Inquiry → Draft Response — party-type classifier and required-info gate.
 *
 * Phase 0: PURE LOGIC ONLY. No DB, no LLM, no send. These functions decide, for
 * a new `bookings` row (status='pending_review'):
 *   1. which party type it is (or 'unknown'), and
 *   2. whether enough is known to draft a QUOTE, or only an INFO-GATHER first
 *      contact with no pricing.
 *
 * Ground rules (from docs/inquiry-response-workflow.md + the 2026-08-31 plan):
 *   - Deposit is a flat $250 for every type — never inferred here.
 *   - `event_type` is inconsistent across the site's forms (sometimes a slug
 *     like 'studio-rental', sometimes a label like 'Kids Birthday Party'), so
 *     classification is keyword-tolerant and also looks at package_type, notes,
 *     and party_tags.
 *   - An 'unknown' classification must be routed to a human — never auto-quoted.
 *   - When any required field is missing, the first contact is info-gather with
 *     NO pricing (a hard rule for Mobile, applied uniformly here).
 */

export type PartyType = 'studio_rental' | 'mobile_party' | 'in_studio_theme' | 'unknown'
export type ContactPath = 'info_gather' | 'quote'

/** The subset of a `bookings` row the classifier/gate reads. */
export interface InquiryBooking {
  event_type?: string | null
  package_type?: string | null
  notes?: string | null
  party_tags?: Record<string, unknown> | null
  contact_name?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  party_date?: string | null
  party_time?: string | null
  guest_count_approx?: number | null
  child_name?: string | null
  child_age?: number | null
}

export interface Classification {
  partyType: PartyType
  confidence: 'high' | 'low'
  reason: string
}

export interface RequiredInfoResult {
  path: ContactPath
  missing: string[]
  /** True when the type is unknown/ambiguous — needs a human, don't auto-quote. */
  needsHuman: boolean
}

export interface InquiryEvaluation extends Classification, RequiredInfoResult {}

/** Lowercase a nullable string and collapse separators so 'studio-rental',
 *  'studio_rental', and 'Studio Rental' all compare equal-ish. */
function norm(v: unknown): string {
  return typeof v === 'string' ? v.toLowerCase().replace(/[_-]+/g, ' ').trim() : ''
}

/** All free-text signals we're willing to keyword-match against, joined. */
function haystack(b: InquiryBooking): string {
  const tagBits = b.party_tags
    ? Object.entries(b.party_tags)
        .map(([k, val]) => `${k} ${typeof val === 'string' ? val : ''}`)
        .join(' ')
    : ''
  return [norm(b.event_type), norm(b.package_type), norm(b.notes), norm(tagBits)].join(' ')
}

const MOBILE_HINTS = ['mobile', 'at home', 'at your home', 'come to', 'off site', 'off-site', 'craft party']
const STUDIO_RENTAL_HINTS = ['studio rental', 'room rental', 'rent the', 'private rental', 'venue rental']
const IN_STUDIO_THEME_HINTS = [
  'kids party', 'kids birthday', 'birthday party', 'theme party', 'themed party',
  'team party', 'communion', 'first birthday', 'toddler party', 'glow party',
  'slime party', 'party package',
]

function anyHint(hay: string, hints: string[]): boolean {
  return hints.some(h => hay.includes(h))
}

/**
 * Classify a booking into one of the three party types, or 'unknown'.
 * Order matters: Mobile is checked first because its keyword is the most
 * specific; a "mobile kids birthday party" is Mobile, not In-Studio.
 */
export function classifyPartyType(b: InquiryBooking): Classification {
  const hay = haystack(b)
  const et = norm(b.event_type)

  // Explicit event_type slugs are the strongest signal.
  if (et === 'studio rental' || et === 'room rental') {
    return { partyType: 'studio_rental', confidence: 'high', reason: `event_type='${b.event_type}'` }
  }

  if (anyHint(hay, MOBILE_HINTS)) {
    return { partyType: 'mobile_party', confidence: 'high', reason: 'matched mobile/craft-party hints' }
  }
  if (anyHint(hay, STUDIO_RENTAL_HINTS)) {
    return { partyType: 'studio_rental', confidence: 'high', reason: 'matched studio/room-rental hints' }
  }
  if (anyHint(hay, IN_STUDIO_THEME_HINTS)) {
    return { partyType: 'in_studio_theme', confidence: 'high', reason: 'matched in-studio themed-party hints' }
  }

  // A themed package name we don't recognize, but with a child age/name, is
  // very likely an in-studio themed party — low confidence, still human-checkable.
  if ((b.child_age != null || b.child_name) && b.package_type) {
    return {
      partyType: 'in_studio_theme',
      confidence: 'low',
      reason: `package_type='${b.package_type}' with child details, but no keyword match`,
    }
  }

  return { partyType: 'unknown', confidence: 'low', reason: 'no confident type signal' }
}

function isBlank(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '')
}

/** Best-effort check for a stated studio rental duration. It's not a dedicated
 *  bookings column, so look in party_tags for a duration-ish key or a party_time
 *  string that encodes a range / hours. Absent => treat as missing (info-gather). */
export function hasStudioDuration(b: InquiryBooking): boolean {
  const tags = b.party_tags || {}
  for (const [k, v] of Object.entries(tags)) {
    const key = norm(k)
    if ((key.includes('duration') || key.includes('hours') || key === 'hrs') && !isBlank(v)) return true
  }
  // Use a light normalization here (lowercase only) — unlike norm(), keep the
  // dash so a time range like "10-1" is still detectable as an implied duration.
  const t = typeof b.party_time === 'string' ? b.party_time.toLowerCase() : ''
  if (/\b\d+\s*(hr|hrs|hour|hours)\b/.test(t)) return true // e.g. "3 hrs", "2 hours"
  if (/\d\s*[-–]\s*\d/.test(t)) return true // a time range implies a duration
  return false
}

/** Best-effort check for a mobile-party venue address (party_tags first). */
export function hasVenueAddress(b: InquiryBooking): boolean {
  const tags = b.party_tags || {}
  for (const [k, v] of Object.entries(tags)) {
    const key = norm(k)
    if ((key.includes('address') || key.includes('venue') || key.includes('location')) && !isBlank(v)) {
      return true
    }
  }
  return false
}

const FIELD_LABELS: Record<string, string> = {
  contact_name: 'contact name',
  contact_phone: 'contact phone',
  contact_email: 'contact email',
  party_date: 'date',
  party_time: 'start time',
  guest_count: 'guest count',
  rental_duration: 'rental duration',
  venue_address: 'venue address',
}

/**
 * Determine whether we have enough to quote, or must gather info first.
 * Required fields (from docs/inquiry-response-flow.md §3):
 *   ALL:            contact name/phone/email, date, start time, guest count
 *   studio_rental:  + rental duration
 *   mobile_party:   + venue address
 *   in_studio_theme: (turning age / child name are nice-to-have, not required)
 *   unknown:        forced info_gather + needsHuman
 */
export function evaluateRequiredInfo(partyType: PartyType, b: InquiryBooking): RequiredInfoResult {
  const missing: string[] = []

  if (isBlank(b.contact_name)) missing.push('contact_name')
  if (isBlank(b.contact_phone)) missing.push('contact_phone')
  if (isBlank(b.contact_email)) missing.push('contact_email')
  if (isBlank(b.party_date)) missing.push('party_date')
  if (isBlank(b.party_time)) missing.push('party_time')
  if (b.guest_count_approx == null || b.guest_count_approx <= 0) missing.push('guest_count')

  if (partyType === 'studio_rental' && !hasStudioDuration(b)) missing.push('rental_duration')
  if (partyType === 'mobile_party' && !hasVenueAddress(b)) missing.push('venue_address')

  const needsHuman = partyType === 'unknown'
  // Unknown type never auto-quotes even if fields look complete.
  const path: ContactPath = needsHuman || missing.length > 0 ? 'info_gather' : 'quote'

  return { path, missing, needsHuman }
}

/** Convenience: classify + gate in one call. */
export function evaluateInquiry(b: InquiryBooking): InquiryEvaluation {
  const cls = classifyPartyType(b)
  const gate = evaluateRequiredInfo(cls.partyType, b)
  return { ...cls, ...gate }
}

/** Human-readable labels for a set of missing field keys (for the info-gather draft). */
export function describeMissing(missing: string[]): string[] {
  return missing.map(m => FIELD_LABELS[m] ?? m.replace(/_/g, ' '))
}
