/**
 * The server's screen for a /join-the-team application.
 *
 * The browser validates too; the browser is not the one that decides. Every
 * answer here is re-checked against the same lists the form renders from
 * (lib/careers.ts), and migration 071 checks them a third time.
 *
 * Two refusals carry the business rules, and both are deliberate:
 *   - `is_18_plus` false is refused with a friendly sentence, not a field list.
 *     The form never submits it; a caller that does gets the same answer.
 *   - a Helper or Either applicant must tick "I'm willing to learn hair tinsel,
 *     braiding and nail painting". Every party has them (Adam, 2026-10-11).
 *
 * `portfolio_url` goes through `parseScreenedUrl` — the parser every outbound
 * mail link in this codebase is screened with (lib/emailSafety.ts composes it) —
 * BEFORE it is stored, so the row and the email hold the same, screened value.
 * A bare `instagram.com/x` is given an `https://`; anything the screen refuses is
 * a 400 that says which field, rather than a link quietly dropped.
 */

import { clean, looksLikeEmail, looksLikePhone } from './intakeFields'
import { boundedIntakeText, MAX_INTAKE_NAME_CHARS } from './publicIntake'
import { parseScreenedUrl } from './content/contentSafety'
import {
  ROLE_INTERESTS,
  WEEKEND_OPTIONS,
  WEEKDAY_OPTIONS,
  YES_SOME_NO,
  JOB_HEARD_ABOUT,
  HELPER_SKILLS,
  asksLead,
  asksHelper,
  type Choice,
  type RoleInterest,
} from './careers'

/** A long answer is a paragraph or two, not an essay. */
export const MAX_APPLICATION_TEXT = 2000

/** The columns the apply route inserts — exactly migration 071's applicant half. */
export interface JobApplicationRow {
  role_interest: RoleInterest
  name: string
  email: string
  phone: string
  is_18_plus: true
  weekend_availability: string
  weekday_availability: string
  has_car: boolean
  heard_about: string
  heard_about_detail: string | null
  why_us: string
  hospitality_experience: string | null
  lead_comfort_rating: number | null
  decorating_experience: string | null
  balloon_experience: string | null
  portfolio_url: string | null
  kids_experience: string | null
  activity_comfort_rating: number | null
  crafts_experience: string | null
  braiding_experience: string | null
  tinsel_experience: string | null
  nails_experience: string | null
  will_learn_beauty: boolean | null
}

export type ScreenedApplication =
  | { ok: true; row: JobApplicationRow }
  | { ok: false; error: string; code: 'missing' | 'invalid' | 'under_18' | 'must_learn' }

export const UNDER_18_MESSAGE =
  "Thanks so much for your interest! We're only hiring people 18 and older right now — please check back with us in the future."

export const MUST_LEARN_MESSAGE =
  'Every party has hair tinsel, braiding and nail painting, so Party Helpers need to be willing to learn them. We teach you!'

function oneOf(options: readonly Choice[], v: unknown): string | null {
  const s = clean(v, 40)
  return options.some(o => o.value === s) ? s : null
}

/** A 1–5 rating, as a number or a numeric string. */
function rating(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d$/.test(v.trim()) ? Number(v.trim()) : NaN
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null
}

/** Strictly a boolean — `"false"` is a truthy string and must not read as yes. */
function bool(v: unknown): boolean | null {
  return v === true ? true : v === false ? false : null
}

function text(v: unknown): string | null {
  return boundedIntakeText(v, MAX_APPLICATION_TEXT)
}

/**
 * Screen a portfolio link. `null` url = none given. `ok: false` = given and
 * refused. Exported for the tests, which are the only proof the screen holds.
 */
export function screenPortfolioUrl(raw: unknown): { ok: true; url: string | null } | { ok: false } {
  const s = clean(raw, 500)
  if (!s) return { ok: true, url: null }
  // A typed link usually has no scheme. Give it one; never accept a relative
  // path (that would resolve to OUR origin) or a non-https scheme.
  const withScheme = /^https?:\/\//i.test(s) ? s.replace(/^http:\/\//i, 'https://') : `https://${s}`
  if (withScheme.startsWith('https:///')) return { ok: false }
  const url = parseScreenedUrl(withScheme)
  if (!url || !url.hostname.includes('.')) return { ok: false }
  return { ok: true, url: url.href }
}

export function screenJobApplication(body: Record<string, unknown>): ScreenedApplication {
  const role = clean(body.role_interest, 20) as RoleInterest
  const roleOk = (ROLE_INTERESTS as readonly string[]).includes(role)

  // Age first: the answer to a "no" is a kind sentence, not a list of blanks.
  if (body.is_18_plus === false) return { ok: false, error: UNDER_18_MESSAGE, code: 'under_18' }

  const name = clean(body.name, MAX_INTAKE_NAME_CHARS)
  const email = clean(body.email, 160)
  const phone = clean(body.phone, 40)
  const weekend = oneOf(WEEKEND_OPTIONS, body.weekend_availability)
  const weekday = oneOf(WEEKDAY_OPTIONS, body.weekday_availability)
  const hasCar = bool(body.has_car)
  const heard = oneOf(JOB_HEARD_ABOUT, body.heard_about)
  const whyUs = text(body.why_us)

  const missing: string[] = []
  if (!roleOk) missing.push('which role')
  if (!name) missing.push('your name')
  if (!email) missing.push('email')
  if (!phone) missing.push('phone')
  if (body.is_18_plus !== true) missing.push('confirm you are 18 or older')
  if (!weekend) missing.push('weekend availability')
  if (!weekday) missing.push('weekday availability')
  if (hasCar === null) missing.push('car and license')
  if (!heard) missing.push('how you heard about us')
  if (!whyUs) missing.push('why you want to work with us')

  const lead = roleOk && asksLead(role)
  const helper = roleOk && asksHelper(role)

  const hospitality = lead ? text(body.hospitality_experience) : null
  const leadRating = lead ? rating(body.lead_comfort_rating) : null
  const decorating = lead ? text(body.decorating_experience) : null
  const balloon = lead ? oneOf(YES_SOME_NO, body.balloon_experience) : null
  if (lead) {
    if (!hospitality) missing.push('hospitality / events / team-lead experience')
    if (!leadRating) missing.push('comfort managing parents and a team (1–5)')
    if (!decorating) missing.push('decorating and design experience')
    if (!balloon) missing.push('balloon arch / garland experience')
  }

  const kids = helper ? text(body.kids_experience) : null
  const activityRating = helper ? rating(body.activity_comfort_rating) : null
  const skills: Record<string, string | null> = {}
  for (const s of HELPER_SKILLS) {
    skills[s.field] = helper ? oneOf(YES_SOME_NO, body[s.field]) : null
    if (helper && !skills[s.field]) missing.push(s.label.toLowerCase())
  }
  if (helper) {
    if (!kids) missing.push('experience with kids')
    if (!activityRating) missing.push('comfort leading group activities (1–5)')
  }

  if (missing.length) {
    return { ok: false, error: `Please fill in: ${missing.join(', ')}.`, code: 'missing' }
  }

  if (!looksLikeEmail(email)) return { ok: false, error: 'That email address does not look right.', code: 'invalid' }
  if (!looksLikePhone(phone)) return { ok: false, error: 'Please enter a phone number we can reach you on.', code: 'invalid' }

  // The must. Checked after the blanks so an empty form hears about the blanks.
  if (helper && body.will_learn_beauty !== true) {
    return { ok: false, error: MUST_LEARN_MESSAGE, code: 'must_learn' }
  }

  let portfolio: string | null = null
  if (lead) {
    const p = screenPortfolioUrl(body.portfolio_url)
    if (!p.ok) {
      return { ok: false, error: 'That portfolio link does not look right — paste the full https:// address, or leave it blank.', code: 'invalid' }
    }
    portfolio = p.url
  }

  return {
    ok: true,
    row: {
      role_interest: role,
      name,
      email,
      phone,
      is_18_plus: true,
      weekend_availability: weekend as string,
      weekday_availability: weekday as string,
      has_car: hasCar as boolean,
      heard_about: heard as string,
      heard_about_detail: heard === 'other' ? clean(body.heard_about_detail, 200) || null : null,
      why_us: whyUs as string,
      hospitality_experience: hospitality,
      lead_comfort_rating: leadRating,
      decorating_experience: decorating,
      balloon_experience: balloon,
      portfolio_url: portfolio,
      kids_experience: kids,
      activity_comfort_rating: activityRating,
      crafts_experience: skills.crafts_experience,
      braiding_experience: skills.braiding_experience,
      tinsel_experience: skills.tinsel_experience,
      nails_experience: skills.nails_experience,
      will_learn_beauty: helper ? true : null,
    },
  }
}
