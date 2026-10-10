import { makeRsvpDb, rsvpRow, EVITE_ID, OTHER_EVITE_ID } from '../../helpers/rsvpFixtures'
import { readSrc } from '../../helpers/sourceScan'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import {
  EDIT_NONCE_LENGTH,
  cookieName,
  editLink,
  editTokenExpiry,
  newEditNonce,
  parseEditToken,
  signEditToken,
  verifyEditToken,
} from '@/lib/evites/rsvpToken'

/** The RSVP edit token (spec §7.5). */

const NOW = new Date('2026-11-01T15:00:00Z')
const EXP = Math.floor(Date.parse('2026-12-20T00:00:00Z') / 1000)
const ENV = 'PORTAL_LINK_SIGNING_SECRET'
let saved: string | undefined

beforeEach(() => {
  saved = process.env[ENV]
  process.env[ENV] = 'test-signing-secret-0123456789abcdef'
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  if (saved === undefined) delete process.env[ENV]
  else process.env[ENV] = saved
  jest.restoreAllMocks()
})

describe('signing and verifying', () => {
  it('a token for a stored RSVP verifies and names that RSVP', async () => {
    const row = rsvpRow({ edit_nonce: 'Zm9vYmFyYmF6cXV4' })
    const db = makeRsvpDb({ rsvps: [row] })
    const token = signEditToken({ id: String(row.id), edit_nonce: String(row.edit_nonce) }, EXP)
    expect(token.split('.')).toHaveLength(3)
    expect(token.startsWith(`${row.id}.${EXP}.`)).toBe(true)
    expect(await verifyEditToken(db.supabase, token, EVITE_ID, NOW)).toEqual({ ok: true, rsvpId: row.id, exp: EXP })
  })

  it('the signature is base64url HMAC-SHA256 over "evite-rsvp:<id>:<nonce>:<exp>"', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require('crypto') as typeof import('crypto')
    const id = '00000000-0000-4000-8000-000000000042'
    const token = signEditToken({ id, edit_nonce: 'Zm9vYmFyYmF6cXV4' }, EXP)
    const expected = crypto.createHmac('sha256', 'test-signing-secret-0123456789abcdef').update(`evite-rsvp:${id}:Zm9vYmFyYmF6cXV4:${EXP}`).digest('base64url')
    expect(token).toBe(`${id}.${EXP}.${expected}`)
  })

  it("another party's evite id cannot verify it", async () => {
    const row = rsvpRow()
    const db = makeRsvpDb({ rsvps: [row] })
    const token = signEditToken({ id: String(row.id), edit_nonce: String(row.edit_nonce) }, EXP)
    expect(await verifyEditToken(db.supabase, token, OTHER_EVITE_ID, NOW)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('an expired token is refused without a database read', async () => {
    const row = rsvpRow()
    const db = makeRsvpDb({ rsvps: [row] })
    const token = signEditToken({ id: String(row.id), edit_nonce: String(row.edit_nonce) }, Math.floor(NOW.getTime() / 1000) - 1)
    expect(await verifyEditToken(db.supabase, token, EVITE_ID, NOW)).toEqual({ ok: false, reason: 'expired' })
    expect(db.selects).toHaveLength(0)
  })

  it('rotating edit_nonce revokes the token', async () => {
    const row = rsvpRow({ edit_nonce: 'AAAAAAAAAAAAAAAA' })
    const db = makeRsvpDb({ rsvps: [row] })
    const token = signEditToken({ id: String(row.id), edit_nonce: 'AAAAAAAAAAAAAAAA' }, EXP)
    expect((await verifyEditToken(db.supabase, token, EVITE_ID, NOW)).ok).toBe(true)
    db.tables.evite_rsvps[0].edit_nonce = 'BBBBBBBBBBBBBBBB'
    expect(await verifyEditToken(db.supabase, token, EVITE_ID, NOW)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('a tampered signature, expiry or id is refused', async () => {
    const a = rsvpRow()
    const b = rsvpRow({ edit_nonce: 'CCCCCCCCCCCCCCCC' })
    const db = makeRsvpDb({ rsvps: [a, b] })
    const token = signEditToken({ id: String(a.id), edit_nonce: String(a.edit_nonce) }, EXP)
    const [id, exp, sig] = token.split('.')
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A')
    const cases = [
      `${id}.${exp}.${flipped}`, // signature
      `${id}.${Number(exp) + 86400}.${sig}`, // expiry extended
      `${b.id}.${exp}.${sig}`, // somebody else's id, this signature
      `${id}.${exp}.${sig}x`, // longer
      `${id}.${exp}.${sig.slice(0, -1)}`, // shorter
    ]
    for (const t of cases) expect(await verifyEditToken(db.supabase, t, EVITE_ID, NOW)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('an unknown RSVP id and a forged token are the SAME answer', async () => {
    const db = makeRsvpDb({ rsvps: [rsvpRow()] })
    const ghost = signEditToken({ id: '00000000-0000-4000-8000-0000000000ff', edit_nonce: 'AAAAAAAAAAAAAAAA' }, EXP)
    const forged = `${db.tables.evite_rsvps[0].id}.${EXP}.${'A'.repeat(43)}`
    expect(await verifyEditToken(db.supabase, ghost, EVITE_ID, NOW)).toEqual(await verifyEditToken(db.supabase, forged, EVITE_ID, NOW))
  })

  it('a read error is UNAVAILABLE, not "invalid"', async () => {
    const row = rsvpRow()
    const db = makeRsvpDb({ rsvps: [row] })
    db.errors.push({ table: 'evite_rsvps', op: 'select' })
    const token = signEditToken({ id: String(row.id), edit_nonce: String(row.edit_nonce) }, EXP)
    expect(await verifyEditToken(db.supabase, token, EVITE_ID, NOW)).toEqual({ ok: false, reason: 'unavailable' })
  })

  it.each([undefined, null, '', 'abc', 'a.b', 'a.b.c.d', 12345, {}, '..', `not-a-uuid.${EXP}.${'A'.repeat(43)}`, `00000000-0000-4000-8000-000000000001.-5.${'A'.repeat(43)}`])(
    'malformed input %j is invalid and reads nothing',
    async (t) => {
      const db = makeRsvpDb({ rsvps: [rsvpRow()] })
      expect(await verifyEditToken(db.supabase, t, EVITE_ID, NOW)).toEqual({ ok: false, reason: 'invalid' })
      expect(parseEditToken(t)).toBeNull()
      expect(db.selects).toHaveLength(0)
    },
  )

  it('refuses to sign with a bad nonce, id or expiry', () => {
    const id = '00000000-0000-4000-8000-000000000001'
    expect(() => signEditToken({ id, edit_nonce: 'short' }, EXP)).toThrow()
    expect(() => signEditToken({ id: 'nope', edit_nonce: 'AAAAAAAAAAAAAAAA' }, EXP)).toThrow()
    expect(() => signEditToken({ id, edit_nonce: 'AAAAAAAAAAAAAAAA' }, 0)).toThrow()
    expect(() => signEditToken({ id, edit_nonce: 'AAAAAAAAAAAAAAAA' }, 1.5)).toThrow()
  })

  it('compares in constant time with a length guard, and never falls back to a literal secret', () => {
    const src = readSrc('lib', 'evites', 'rsvpToken.ts')
    expect(src).toMatch(/timingSafeEqual\s*\(/)
    expect(src).toMatch(/expected\.length\s*!==\s*given\.length/)
    expect(src).toMatch(/portalSigningSecret\s*\(/)
    expect(src).not.toMatch(/PORTAL_LINK_SIGNING_SECRET\s*\|\|/)
    expect(src).not.toContain("'dev-secret'")
  })
})

describe('the pieces around the token', () => {
  it('newEditNonce is 16 characters of base64url, and different each time', () => {
    const a = newEditNonce()
    expect(a).toHaveLength(EDIT_NONCE_LENGTH)
    expect(a).toMatch(/^[A-Za-z0-9_-]{16}$/)
    expect(newEditNonce()).not.toBe(a)
  })

  it('cookieName is hh_rsvp_ plus the first 8 hex of the evite id', () => {
    expect(cookieName('ev100000-0000-0000-0000-000000000001')).toBe('hh_rsvp_ev100000')
    expect(cookieName('0a1b2c3d-4e5f-4000-8000-000000000000')).toBe('hh_rsvp_0a1b2c3d')
  })

  it('editLink is absolute against the canonical origin', () => {
    expect(editLink('mia-glow-7kq2', 'tok.en.sig')).toBe(`${CANONICAL_ORIGIN}/i/mia-glow-7kq2/rsvp/tok.en.sig`)
  })

  it('the expiry is the party end plus 30 days; with no window, the end of the party date plus 30 days; else null', () => {
    const end = new Date('2026-11-14T21:00:00Z')
    expect(editTokenExpiry({ endUtc: end })).toBe(Math.floor(end.getTime() / 1000) + 30 * 86400)
    // 2026-11-14 23:59 ET = 2026-11-15T04:59Z
    expect(editTokenExpiry(null, '2026-11-14')).toBe(Math.floor(Date.parse('2026-11-15T04:59:00Z') / 1000) + 30 * 86400)
    expect(editTokenExpiry(null, null)).toBeNull()
    expect(editTokenExpiry(null, 'soon')).toBeNull()
    expect(editTokenExpiry({ endUtc: new Date(NaN) }, null)).toBeNull()
  })
})
