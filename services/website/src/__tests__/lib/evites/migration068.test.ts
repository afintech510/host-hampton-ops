/**
 * Source-reading test for migration 068. Every anchor tolerates CRLF: the
 * checkout is `core.autocrlf=true`, so a bare `\n` silently matches nothing.
 *
 * Comments are stripped first, so a rule cannot be satisfied by the header text
 * (or by the commented-out rollback block) that explains it.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { SLUG_REGEX, SLUG_MIN_LENGTH, SLUG_MAX_LENGTH, SLUG_ALPHABET } from '@/lib/evites/slug'

const FILE = join(process.cwd(), '..', '..', 'starting_plan', 'migration_068_evites.sql')
const RAW = readFileSync(FILE, 'utf8')
const SQL = RAW.replace(/--[^\r\n]*/g, '')

const TABLES = ['evites', 'evite_consent_texts', 'evite_rsvps', 'evite_sends', 'evite_events'] as const

describe('migration 068 text', () => {
  it('was read, was not empty, and stripping comments left the statements', () => {
    expect(RAW.length).toBeGreaterThan(2000)
    expect(SQL).toMatch(/CREATE TABLE evites\s*\(/)
    // the commented rollback must not survive the strip
    expect(SQL).not.toMatch(/DROP TABLE/)
  })

  it.each(TABLES)('creates table %s', (t) => {
    expect(SQL).toMatch(new RegExp(`CREATE TABLE ${t}\\s*\\(`))
  })

  it.each(TABLES)('enables row level security on %s', (t) => {
    expect(SQL).toMatch(new RegExp(`ALTER TABLE ${t}\\s+ENABLE ROW LEVEL SECURITY`))
  })

  it('has no policies: service role only', () => {
    expect(SQL).not.toMatch(/CREATE POLICY/i)
  })

  it('evites.booking_id is NOT NULL UNIQUE and references bookings (one evite per booking, ever)', () => {
    expect(SQL).toMatch(/booking_id\s+uuid NOT NULL UNIQUE REFERENCES bookings\(id\) ON DELETE CASCADE/)
  })

  it('evites.slug is NOT NULL UNIQUE', () => {
    expect(SQL).toMatch(/\bslug\s+text NOT NULL UNIQUE/)
  })

  it('the send-once index is unique and uses NULLS NOT DISTINCT over the five-column key', () => {
    const m = SQL.match(/CREATE UNIQUE INDEX uniq_evite_send_once[\s\S]*?;/)
    expect(m).not.toBeNull()
    expect(m![0]).toMatch(/\(evite_id, rsvp_id, send_type, ref_version, channel\)\s+NULLS NOT DISTINCT/)
  })

  it('the slug CHECK regex is identical to slug.ts, and so are the length bounds', () => {
    const m = SQL.match(/CHECK \(slug ~ '([^']+)' AND char_length\(slug\) BETWEEN (\d+) AND (\d+)\)/)
    expect(m).not.toBeNull()
    expect(m![1]).toBe(SLUG_REGEX.source)
    expect(Number(m![2])).toBe(SLUG_MIN_LENGTH)
    expect(Number(m![3])).toBe(SLUG_MAX_LENGTH)
  })

  it('the SQL regex really accepts what makeSlug can produce and refuses the excluded letters', () => {
    // the class in the SQL must be the alphabet in slug.ts, expanded
    const cls = SLUG_REGEX.source.match(/\[([^\]]+)\]\{4\}\$$/)![1]
    expect(cls).toBe('0-9a-hjkmnp-tv-z')
    const expanded: string[] = []
    for (const ch of 'abcdefghijklmnopqrstuvwxyz0123456789') if (new RegExp(`^[${cls}]$`).test(ch)) expanded.push(ch)
    expect(expanded.sort().join('')).toBe(SLUG_ALPHABET.split('').sort().join(''))
  })

  it('inserts the public jpeg-only evites bucket INSIDE the transaction, ignoring conflicts', () => {
    const begin = SQL.search(/\bBEGIN;/)
    const commit = SQL.search(/\bCOMMIT;/)
    const bucket = SQL.search(/INSERT INTO storage\.buckets/)
    expect(begin).toBeGreaterThanOrEqual(0)
    expect(bucket).toBeGreaterThan(begin)
    expect(bucket).toBeLessThan(commit)
    const stmt = SQL.match(/INSERT INTO storage\.buckets[\s\S]*?;/)![0]
    expect(stmt).toMatch(/'evites'/)
    expect(stmt).toMatch(/true/)
    expect(stmt).toMatch(/2097152/)
    expect(stmt).toMatch(/\{image\/jpeg\}/)
    expect(stmt).toMatch(/ON CONFLICT DO NOTHING/)
  })

  it('ALTER TYPE lead_source ADD VALUE sits after COMMIT, not inside the transaction', () => {
    const commit = SQL.search(/\bCOMMIT;/)
    const alter = SQL.search(/ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'evite'/)
    expect(alter).toBeGreaterThan(commit)
  })

  it('creates both functions and revokes the cap function from anon/authenticated', () => {
    expect(SQL).toMatch(/CREATE FUNCTION evite_reminder_email_recent\(p_email text\)/)
    expect(SQL).toMatch(/CREATE FUNCTION touch_evites_updated_at\(\)/)
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION evite_reminder_email_recent\(text\) FROM anon, authenticated/)
  })

  it('seeds the club-v1 consent wording the RSVP FK points at', () => {
    expect(SQL).toMatch(/INSERT INTO evite_consent_texts VALUES \('club-v1','email','Send me party & craft ideas from Host Hampton'/)
  })

  it('documents the rollback, the PG15+ requirement and the migration 046 precedent', () => {
    expect(RAW).toMatch(/ROLLBACK/)
    expect(RAW).toMatch(/DROP TABLE IF EXISTS evite_events, evite_sends, evite_rsvps, evite_consent_texts, evites/)
    expect(RAW).toMatch(/PG15\+/)
    expect(RAW).toMatch(/migration 046/)
  })

  it('does not pre-name the two constraints ensure.ts depends on (it relies on the default names)', () => {
    expect(SQL).not.toMatch(/CONSTRAINT evites_slug_key/)
    expect(SQL).not.toMatch(/CONSTRAINT evites_booking_id_key/)
  })

  // ---- v1.2 (adversarial review): the reminder address caps count when the address was SET
  it('evite_rsvps.reminder_set_at exists, and a stored reminder_email must have one (a CHECK, not a convention)', () => {
    const table = SQL.match(/CREATE TABLE evite_rsvps\s*\([\s\S]*?\n\);/)![0]
    expect(table).toMatch(/\breminder_set_at\s+timestamptz\b/)
    expect(table).toMatch(/CONSTRAINT rsvp_reminder_email_has_set_at CHECK \(reminder_email IS NULL OR reminder_set_at IS NOT NULL\)/)
  })

  it('the 24-hour cap function counts reminder_set_at, never created_at (a PATCH on an old row is a new ask)', () => {
    const fn = SQL.match(/CREATE FUNCTION evite_reminder_email_recent\(p_email text\)[\s\S]*?\$\$;/)![0]
    expect(fn).toMatch(/reminder_set_at > now\(\) - interval '24 hours'/)
    expect(fn).not.toMatch(/created_at/)
    expect(fn).toMatch(/SECURITY INVOKER/)
    expect(fn).toMatch(/lower\(reminder_email\) = lower\(btrim\(p_email\)\)/)
  })

  it('the per-evite cap function counts the held address on ONE invitation, and both are revoked from anon/authenticated', () => {
    const fn = SQL.match(/CREATE FUNCTION evite_reminder_email_on_evite\(p_evite_id uuid, p_email text\)[\s\S]*?\$\$;/)![0]
    expect(fn).toMatch(/evite_id = p_evite_id/)
    expect(fn).toMatch(/lower\(reminder_email\) = lower\(btrim\(p_email\)\)/)
    expect(fn).toMatch(/SECURITY INVOKER/)
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION evite_reminder_email_on_evite\(uuid, text\) FROM anon, authenticated/)
    expect(RAW).toMatch(/DROP FUNCTION IF EXISTS evite_reminder_email_on_evite\(uuid, text\)/)
  })

  it('the reminder index is on (lower(reminder_email), reminder_set_at)', () => {
    expect(SQL).toMatch(/CREATE INDEX idx_evite_rsvps_reminder_email ON evite_rsvps \(lower\(reminder_email\), reminder_set_at\) WHERE reminder_email IS NOT NULL/)
  })
})
