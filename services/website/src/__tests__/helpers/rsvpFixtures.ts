import { makeFakeEviteDb } from './fakeEviteDb'
import { bookingRow, evitesRow, LINE_ITEM_ROWS, THEME_ROWS } from './eviteFixtures'
import { editTokenExpiry, signEditToken } from '@/lib/evites/rsvpToken'
import { cookieName } from '@/lib/evites/rsvpToken'

/** Fixtures for the RSVP route tests: a live party (Sat 14 Nov 2026, 2 PM ET), a table with the real CHECKs, and tokens. */

export const SLUG = 'mia-glow-7kq2'
export const EVITE_ID = 'ev100000-0000-0000-0000-000000000001'
export const OTHER_EVITE_ID = 'ev200000-0000-0000-0000-000000000002'
export const OTHER_SLUG = 'zed-glow-9zzz'

type Row = Record<string, unknown>

let seq = 0
export const uuid = (): string => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

export const rsvpRow = (over: Row = {}): Row => {
  const row = baseRsvpRow(over)
  // The migration's CHECK: a stored reminder address always has a set-time. A seed that names the address but not
  // the time gets its creation time, as a POST would have stamped; a seed can still pass `reminder_set_at` explicitly.
  if (row.reminder_email && row.reminder_set_at === null) row.reminder_set_at = row.created_at
  return row
}

const baseRsvpRow = (over: Row = {}): Row => ({
  id: uuid(),
  evite_id: EVITE_ID,
  status: 'yes',
  revision: 1,
  parent_name: 'Pat Parent',
  children: [{ first_name: 'Ava' }],
  child_count: 1,
  adult_count: 1,
  has_allergy: false,
  allergy_note: null,
  note_to_honoree: null,
  reminder_email: null,
  reminder_set_at: null,
  reminder_phone_e164: null,
  reminder_opt_out_at: null,
  cal_version_seen: 0,
  club_email: null,
  club_opt_in_at: null,
  opt_in_text_version: null,
  club_opted_out_at: null,
  birthday_month: null,
  contact_id: null,
  consent_ip: null,
  edit_nonce: 'AAAAAAAAAAAAAAAA',
  allergy_purged_at: null,
  contacts_purged_at: null,
  created_at: '2026-10-20T12:00:00Z',
  updated_at: '2026-10-20T12:00:00Z',
  ...over,
})

/** The table's CHECK constraints (migration 068), as far as the routes can reach them. */
export function rsvpChecks(r: Row): string | null {
  const children = Array.isArray(r.children) ? r.children : null
  if (!children || children.length > 6) return 'children must be an array of at most 6'
  const n = typeof r.parent_name === 'string' ? r.parent_name.length : 0
  if (n < 1 || n > 120) return 'parent_name length'
  if (r.status !== 'yes' && r.status !== 'no') return 'status'
  if (r.status === 'no' && (children.length !== 0 || Number(r.adult_count) !== 0)) return 'rsvp_no_has_no_party'
  if (r.status === 'yes' && children.length < 1) return 'rsvp_yes_has_a_child'
  if (![0, 1, 2].includes(Number(r.adult_count))) return 'adult_count'
  if (typeof r.allergy_note === 'string' && r.allergy_note.length > 300) return 'allergy_note length'
  if (typeof r.note_to_honoree === 'string' && r.note_to_honoree.length > 500) return 'note_to_honoree length'
  if (r.reminder_email && r.reminder_phone_e164) return 'rsvp_one_reminder_channel'
  if (r.reminder_email && !r.reminder_set_at) return 'rsvp_reminder_email_has_set_at'
  if (typeof r.reminder_phone_e164 === 'string' && !/^\+1[2-9][0-9]{9}$/.test(r.reminder_phone_e164)) return 'reminder_phone_e164'
  if (r.club_opt_in_at && !(r.club_email && r.opt_in_text_version)) return 'rsvp_club_is_complete'
  if (typeof r.edit_nonce !== 'string' || r.edit_nonce.length !== 16) return 'edit_nonce length'
  if (r.birthday_month != null && (Number(r.birthday_month) < 1 || Number(r.birthday_month) > 12)) return 'birthday_month'
  if (r.consent_ip != null && !/^[0-9a-f:.]+$/i.test(String(r.consent_ip))) return 'consent_ip is not an inet'
  return null
}

export interface RsvpDbOptions {
  rsvps?: Row[]
  booking?: Row
  evite?: Row
  consent?: Row[]
  payments?: Row[]
}

export function makeRsvpDb(o: RsvpDbOptions = {}) {
  return makeFakeEviteDb({
    tables: {
      evites: [evitesRow({ id: EVITE_ID, previous_slugs: [], cal_version: 0, ...o.evite }), evitesRow({ id: OTHER_EVITE_ID, slug: OTHER_SLUG, booking_id: 'bk-2', previous_slugs: [], cal_version: 0 })],
      bookings: [bookingRow(o.booking), bookingRow({ id: 'bk-2', booking_ref: 'HH-TEST-2', child_name: 'Zed' })],
      booking_payments: o.payments ?? [
        { booking_id: 'bk-1', amount_cents: 25000, payment_type: 'deposit' },
        { booking_id: 'bk-2', amount_cents: 25000, payment_type: 'deposit' },
      ],
      booking_line_items: LINE_ITEM_ROWS,
      party_themes: THEME_ROWS,
      evite_rsvps: o.rsvps ?? [],
      evite_events: [],
      evite_consent_texts: o.consent ?? [{ version: 'club-v1', channel: 'email', wording: 'Send me party & craft ideas from Host Hampton', created_at: '2026-10-10T00:00:00Z' }],
    },
    rowDefaults: {
      evite_rsvps: () => ({
        revision: 1,
        has_allergy: null,
        allergy_note: null,
        note_to_honoree: null,
        reminder_email: null,
        reminder_set_at: null,
        reminder_phone_e164: null,
        reminder_opt_out_at: null,
        cal_version_seen: 0,
        club_email: null,
        club_opt_in_at: null,
        opt_in_text_version: null,
        club_opted_out_at: null,
        birthday_month: null,
        contact_id: null,
        consent_ip: null,
        allergy_purged_at: null,
        contacts_purged_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    },
    generated: { evite_rsvps: (r) => ({ child_count: Array.isArray(r.children) ? r.children.length : 0 }) },
    checks: { evite_rsvps: rsvpChecks },
    rpcs: {
      evite_reminder_email_recent: (args, tables) => {
        const email = String(args.p_email ?? '').trim().toLowerCase()
        const since = Date.now() - 24 * 3600 * 1000
        // migration 068 (v1.2): counts when the address was SET, not when the row was created.
        const n = (tables.evite_rsvps ?? []).filter((r) => typeof r.reminder_email === 'string' && r.reminder_email.toLowerCase() === email && Date.parse(String(r.reminder_set_at)) > since).length
        return { data: n, error: null }
      },
      evite_reminder_email_on_evite: (args, tables) => {
        const email = String(args.p_email ?? '').trim().toLowerCase()
        const n = (tables.evite_rsvps ?? []).filter((r) => r.evite_id === args.p_evite_id && typeof r.reminder_email === 'string' && r.reminder_email.toLowerCase() === email).length
        return { data: n, error: null }
      },
    },
  })
}

/** A valid edit token for a seeded RSVP, expiring well after the party. */
export function tokenFor(row: Row, expSec?: number): string {
  const exp = expSec ?? Math.floor(Date.parse('2026-12-20T00:00:00Z') / 1000)
  return signEditToken({ id: String(row.id), edit_nonce: String(row.edit_nonce) }, exp)
}

export function cookieFor(eviteId: string, token: string): string {
  return `${cookieName(eviteId)}=${token}`
}

export { editTokenExpiry }
