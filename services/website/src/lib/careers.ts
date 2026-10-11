/**
 * The hiring facts, in one place: the roles, what they pay, and every answer the
 * application form offers.
 *
 * Read by the page, the form, the JobPosting structured data, the apply route,
 * both emails and the admin screen. A pay rate typed twice is a pay rate that
 * will one day disagree with itself on a page Google indexes — and NY's
 * pay-transparency law makes the posted figure a statement, not copy.
 *
 * Deliberately IMPORT-FREE so the client form can use it without dragging server
 * code into the browser bundle. The server-side screen is `lib/jobApplication.ts`.
 *
 * Decisions (Adam, 2026-10-11 — docs/careers-page-plan.md):
 *   - Party Lead $25/hr + tips, Party Helper $17/hr + tips. $17 is exactly the
 *     2026 Long Island minimum wage, and the NY minimum is indexed to inflation
 *     from 2027 — so `JOB_VALID_THROUGH` is the end of January: the posting
 *     drops out of Google for Jobs unless somebody re-checks the rate and moves
 *     the date. That is the January reminder, made structural.
 *   - 18+ for both roles. A car is asked, not required.
 *   - Helpers must be willing to learn hair tinsel, braiding and nail painting.
 */

export type RoleKey = 'lead' | 'helper'
export type RoleInterest = 'lead' | 'helper' | 'either'

export interface Role {
  key: RoleKey
  title: string
  payPerHour: number
  /** One line for the role selector. */
  blurb: string
}

export const ROLES: Record<RoleKey, Role> = {
  lead: {
    key: 'lead',
    title: 'Party Lead',
    payPerHour: 25,
    blurb: 'Run the party start to finish and lead a small team.',
  },
  helper: {
    key: 'helper',
    title: 'Party Helper',
    payPerHour: 17,
    blurb: 'Hands-on with the kids: crafts, tinsel, braids and nails.',
  },
}

/** "$25/hr + tips" — the one spelling of a pay rate. */
export function payLabel(role: RoleKey): string {
  return `$${ROLES[role].payPerHour}/hr + tips`
}

export const ROLE_INTERESTS: readonly RoleInterest[] = ['lead', 'helper', 'either']

export function roleInterestLabel(r: RoleInterest | string): string {
  if (r === 'lead') return ROLES.lead.title
  if (r === 'helper') return ROLES.helper.title
  if (r === 'either') return 'Either role'
  return String(r)
}

/** Does this applicant get the Lead questions? */
export const asksLead = (r: RoleInterest | string) => r === 'lead' || r === 'either'
/** Does this applicant get the Helper questions (and the must-learn checkbox)? */
export const asksHelper = (r: RoleInterest | string) => r === 'helper' || r === 'either'

export interface Choice<V extends string = string> {
  value: V
  label: string
}

export const WEEKEND_OPTIONS: readonly Choice<'every' | 'most' | 'occasional'>[] = [
  { value: 'every', label: 'Every weekend' },
  { value: 'most', label: 'Most weekends' },
  { value: 'occasional', label: 'Occasional weekends' },
]

export const WEEKDAY_OPTIONS: readonly Choice<'yes' | 'sometimes' | 'no'>[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'sometimes', label: 'Sometimes' },
  { value: 'no', label: 'No' },
]

export const YES_SOME_NO: readonly Choice<'yes' | 'some' | 'no'>[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'some', label: 'Some' },
  { value: 'no', label: 'No' },
]

/**
 * How they heard about the job. Not `HEARD_ABOUT_OPTIONS` from
 * lib/attribution.ts: that list is how a CUSTOMER found a party, and "Indeed" is
 * not an answer a parent gives.
 */
export const JOB_HEARD_ABOUT: readonly Choice<'indeed' | 'instagram' | 'facebook' | 'friend' | 'been_to_party' | 'other'>[] = [
  { value: 'indeed', label: 'Indeed' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'friend', label: 'A friend' },
  { value: 'been_to_party', label: "I've been to a party here" },
  { value: 'other', label: 'Other' },
]

/** The four skills, in the order the ads and the form name them. */
export const HELPER_SKILLS = [
  { field: 'crafts_experience', label: 'Arts & crafts with kids' },
  { field: 'braiding_experience', label: 'Braiding' },
  { field: 'tinsel_experience', label: 'Hair tinsel' },
  { field: 'nails_experience', label: 'Nail painting' },
] as const

export const APPLICATION_STATUSES = ['new', 'contacted', 'interviewing', 'hired', 'declined'] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

export function labelOf(options: readonly Choice[], value: string | null | undefined): string {
  if (!value) return '—'
  return options.find(o => o.value === value)?.label ?? value
}

/** Google for Jobs. See the header for why validThrough is the end of January. */
export const JOB_DATE_POSTED = '2026-10-11'
export const JOB_VALID_THROUGH = '2027-01-31T23:59:59-05:00'
