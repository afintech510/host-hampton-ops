import { buildPortalCookieValue } from '@/lib/portalAuth'
import { makeRsvpDb, rsvpRow, EVITE_ID, OTHER_EVITE_ID } from './rsvpFixtures'

/**
 * Fixtures for the host-page tests (P07). Built on the RSVP fakes (P06) without editing them.
 *
 * Booking `HH-TEST-1` / evite `EVITE_ID` is Mia's party (Sat 14 Nov 2026, 2 PM, deposit paid, so
 * `live` on 1 Nov). `HH-TEST-2` / `OTHER_EVITE_ID` is a second family's, used to prove one host's
 * cookie reaches only its own row.
 */

export const PORTAL_SECRET = 'test-portal-secret'
export const REF = 'HH-TEST-1'
export const OTHER_REF = 'HH-TEST-2'
export { EVITE_ID, OTHER_EVITE_ID }

/** A `Cookie:` header carrying a valid portal session for `ref`. */
export function portalCookie(ref: string = REF, secret: string = PORTAL_SECRET): string {
  return `hh_portal=${buildPortalCookieValue(ref, secret)}`
}

/**
 * Every value that must NEVER reach the host: the guests' reminder contacts, club fields and
 * consent IP, plus the ids. Seeded into the rows so a leak shows up as a string in the JSON.
 */
export const PRIVATE_VALUES = [
  'leak-email@example.com',
  '+16315550199',
  'club-leak@example.com',
  '203.0.113.77',
  'NONCEnonce123456',
  'club-v1',
] as const

export const PRIVATE_KEYS = [
  'reminder_email',
  'reminder_phone_e164',
  'reminder_opt_out_at',
  'club_email',
  'club_opt_in_at',
  'club_opted_out_at',
  'opt_in_text_version',
  'birthday_month',
  'consent_ip',
  'edit_nonce',
  'contact_id',
  'cal_version_seen',
  'evite_id',
  'allergy_purged_at',
  'contacts_purged_at',
  'revision',
  'child_count',
  'render_claim',
  'render_error',
] as const

/** A guest's answer with every private column filled in. */
export const guest = (over: Record<string, unknown> = {}) =>
  rsvpRow({
    reminder_email: 'leak-email@example.com',
    club_email: 'club-leak@example.com',
    club_opt_in_at: '2026-10-21T12:00:00Z',
    opt_in_text_version: 'club-v1',
    consent_ip: '203.0.113.77',
    edit_nonce: 'NONCEnonce123456',
    birthday_month: 6,
    ...over,
  })

export interface HostDbOptions {
  rsvps?: Array<Record<string, unknown>>
  booking?: Record<string, unknown>
  evite?: Record<string, unknown>
  payments?: Array<Record<string, unknown>>
}

export function makeHostDb(o: HostDbOptions = {}) {
  return makeRsvpDb({ rsvps: o.rsvps, booking: o.booking, evite: o.evite, payments: o.payments })
}
