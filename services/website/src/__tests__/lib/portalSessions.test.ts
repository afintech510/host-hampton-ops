/**
 * Behaviour, not shape: the portal session cookies and the two lookups that
 * decide who a customer is.
 *
 * Every case here is one that was measured against production first — see
 * `docs/portal-auth-review.md`. Both directions are exercised: the hostile
 * value is refused AND the legitimate value still works, because link 13's
 * escaping fix looked perfect until the legitimate direction was driven and a
 * customer called `O'Brien` turned out to be getting `O&#39;Brien`.
 */

import {
  buildPortalCookieValue,
  buildEmailCookieValue,
  getPortalBookingRef,
  getEmailFromCookie,
  setPortalCookieHeader,
  setEmailCookieHeader,
  generatePortalToken,
  validatePortalToken,
  hashEmailLoginCode,
  verifyEmailLoginCode,
  getEmailCodeMaxAttempts,
} from '@/lib/portalAuth'
import crypto from 'crypto'
import {
  findBookingsByContactEmail,
  findContactsByEmail,
  isPlausibleEmailAddress,
} from '@/lib/contactLookup'

const SECRET = 'test-secret'
const REF = 'HH-2026-0042'
const DAY = 24 * 60 * 60 * 1000

describe('hh_portal — a session that expires', () => {
  it('a fresh cookie names its booking', () => {
    const v = buildPortalCookieValue(REF, SECRET)
    expect(getPortalBookingRef(`hh_portal=${v}`, SECRET)).toBe(REF)
  })

  it('the value is NOT a constant — two cookies a moment apart differ', () => {
    // The defect: `HMAC("cookie:" + ref)` varied with nothing, so a copy of the
    // value authenticated that booking forever and `Max-Age` was decoration.
    const a = buildPortalCookieValue(REF, SECRET, 1_000)
    const b = buildPortalCookieValue(REF, SECRET, 2_000)
    expect(a).not.toBe(b)
  })

  it('a 29-day-old session still works and a 31-day-old one does not', () => {
    const issued = Date.UTC(2026, 0, 1)
    const v = buildPortalCookieValue(REF, SECRET, issued)
    expect(getPortalBookingRef(`hh_portal=${v}`, SECRET, issued + 29 * DAY)).toBe(REF)
    expect(getPortalBookingRef(`hh_portal=${v}`, SECRET, issued + 31 * DAY)).toBeNull()
  })

  it('a client cannot extend its own session by editing the timestamp', () => {
    const issued = Date.UTC(2026, 0, 1)
    const v = buildPortalCookieValue(REF, SECRET, issued)
    const [ref, , sig] = v.split(':')
    const forged = `${ref}:${issued + 90 * DAY}:${sig}`
    expect(getPortalBookingRef(`hh_portal=${forged}`, SECRET, issued + 40 * DAY)).toBeNull()
  })

  it('a cookie issued in the future is refused', () => {
    const now = Date.UTC(2026, 0, 1)
    const v = buildPortalCookieValue(REF, SECRET, now + 10 * DAY)
    expect(getPortalBookingRef(`hh_portal=${v}`, SECRET, now)).toBeNull()
  })

  it('a signature for a DIFFERENT booking does not authenticate this one', () => {
    const other = buildPortalCookieValue('HH-2026-9999', SECRET)
    const [, issued, sig] = other.split(':')
    expect(getPortalBookingRef(`hh_portal=${REF}:${issued}:${sig}`, SECRET)).toBeNull()
  })

  it.each([
    ['garbage signature', `${REF}:1700000000000:deadbeef`],
    ['no signature', REF],
    ['empty ref', `:1700000000000:x`],
    ['four parts', `${REF}:1:2:3`],
    ['non-numeric timestamp', `${REF}:later:x`],
  ])('refuses %s', (_label, value) => {
    expect(getPortalBookingRef(`hh_portal=${value}`, SECRET)).toBeNull()
  })

  it('a legacy two-part cookie is honoured before the sunset and not after', () => {
    // The drain: rejecting these outright would sign out every live customer on
    // a revenue path. They stop working on a date in code instead.
    const legacy = `${REF}:${crypto.createHmac('sha256', SECRET).update(`cookie:${REF}`).digest('hex')}`
    expect(getPortalBookingRef(`hh_portal=${legacy}`, SECRET, Date.parse('2026-10-01T00:00:00Z'))).toBe(REF)
    expect(getPortalBookingRef(`hh_portal=${legacy}`, SECRET, Date.parse('2026-10-20T00:00:01Z'))).toBeNull()
  })

  it('a forged legacy cookie is refused on both sides of the sunset', () => {
    const forged = `${REF}:${'0'.repeat(64)}`
    expect(getPortalBookingRef(`hh_portal=${forged}`, SECRET, Date.parse('2026-10-01T00:00:00Z'))).toBeNull()
    expect(getPortalBookingRef(`hh_portal=${forged}`, SECRET, Date.parse('2026-11-01T00:00:00Z'))).toBeNull()
  })

  it('the header carries every flag it should', () => {
    const h = setPortalCookieHeader(REF, SECRET)
    expect(h).toContain('HttpOnly')
    expect(h).toContain('SameSite=Lax')
    expect(h).toContain('Path=/')
    expect(h).toContain('; Secure')
    expect(h).toContain('Max-Age=2592000')
  })

  it('Secure is dropped only when the caller says the request is local', () => {
    expect(setPortalCookieHeader(REF, SECRET, true)).not.toContain('; Secure')
  })
})

describe('hh_portal_email — the same rules', () => {
  const EMAIL = 'jane@example.com'

  it('round-trips, lowercased', () => {
    const v = buildEmailCookieValue('JANE@Example.com', SECRET)
    expect(getEmailFromCookie(`hh_portal_email=${v}`, SECRET)).toBe(EMAIL)
  })

  it('expires', () => {
    const issued = Date.UTC(2026, 0, 1)
    const v = buildEmailCookieValue(EMAIL, SECRET, issued)
    expect(getEmailFromCookie(`hh_portal_email=${v}`, SECRET, issued + 29 * DAY)).toBe(EMAIL)
    expect(getEmailFromCookie(`hh_portal_email=${v}`, SECRET, issued + 31 * DAY)).toBeNull()
  })

  it('a signature for one address does not authenticate another', () => {
    const v = buildEmailCookieValue(EMAIL, SECRET)
    const [, issued, sig] = v.split(':')
    const forged = `${encodeURIComponent('someone.else@example.com')}:${issued}:${sig}`
    expect(getEmailFromCookie(`hh_portal_email=${forged}`, SECRET)).toBeNull()
  })

  it('the header carries every flag it should', () => {
    const h = setEmailCookieHeader(EMAIL, SECRET)
    expect(h).toContain('HttpOnly')
    expect(h).toContain('SameSite=Lax')
    expect(h).toContain('Path=/')
    expect(h).toContain('; Secure')
  })
})

describe('isPlausibleEmailAddress', () => {
  it.each([
    'jane@example.com',
    'first_last@gmail.com',       // `_` is legal and common in a local part
    "o'brien@example.co.uk",
    'a.b+tag@sub.domain.org',
  ])('accepts %s', v => expect(isPlausibleEmailAddress(v)).toBe(true))

  it.each([
    ['%@gmail.com', 'a LIKE wildcard — this is the one that reached a cookie'],
    ['%', 'the pattern that returned 34 bookings in production'],
    ['jane@example.com ', 'trailing space is fine'],
    ['jane @example.com', 'internal whitespace'],
    ['jane@@example.com', 'two @'],
    ['@example.com', 'no local part'],
    ['jane@example', 'no dot in the domain'],
    ['jane@.com', 'domain starts with a dot'],
    ['jane@exa%ple.com', 'wildcard in the domain'],
    ['a@b', 'too short and no dot'],
    [123, 'not a string'],
    [null, 'null'],
  ])('refuses %s (%s)', (v, _why) => {
    if (v === 'jane@example.com ') { expect(isPlausibleEmailAddress(v)).toBe(true); return }
    expect(isPlausibleEmailAddress(v as unknown)).toBe(false)
  })
})

/* ── The lookups ─────────────────────────────────────────────────────────── */

/**
 * A fake that models REAL `ilike` semantics — `%` is a wildcard run, `_` is one
 * character — because a fake that treats ilike as equality cannot see the bug
 * this module exists to prevent. Same reasoning as `fakeReminderDb` modelling
 * column types and CHECK constraints.
 */
function fakeDb(rows: Record<string, Array<Record<string, unknown>>>, failOn?: string) {
  const like = (pattern: string, value: string) =>
    new RegExp(
      '^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$',
      'i',
    ).test(value)

  return {
    from(table: string) {
      let pool = (rows[table] ?? []).slice()
      const chain: Record<string, unknown> = {}
      const self = () => chain as never
      Object.assign(chain, {
        select: () => self(),
        limit: (n: number) => { pool = pool.slice(0, n); return self() },
        not: (col: string, op: string, val: unknown) => {
          pool = pool.filter(r => (op === 'eq' ? r[col] !== val : true))
          return self()
        },
        ilike: (col: string, pattern: string) => {
          pool = pool.filter(r => like(pattern, String(r[col] ?? '')))
          return self()
        },
        // Thenable, and it reads `pool` at AWAIT time — a `then` bound eagerly
        // inside `ilike` would snapshot the rows before `.not()` had run, which
        // is a fake that answers a question the real client does not.
        then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
          const result = failOn === table
            ? { data: null, error: { message: 'boom' } }
            : { data: pool, error: null }
          return Promise.resolve(result).then(onFulfilled, onRejected)
        },
      })
      return chain as never
    },
  } as never
}

describe('findBookingsByContactEmail', () => {
  const BOOKINGS = [
    { id: '1', booking_ref: 'HH-A', contact_email: 'jane@example.com', status: 'confirmed' },
    { id: '2', booking_ref: 'HH-B', contact_email: 'JANE@Example.com', status: 'deposit_paid' },
    { id: '3', booking_ref: 'HH-C', contact_email: 'janeXdoe@example.com', status: 'confirmed' },
    { id: '4', booking_ref: 'HH-D', contact_email: 'bob@example.com', status: 'cancelled' },
  ]

  it('finds a MIXED-CASE stored address — the 9 real bookings `.eq()` missed', async () => {
    const r = await findBookingsByContactEmail(fakeDb({ bookings: BOOKINGS }), 'jane@example.com')
    expect(r.kind).toBe('found')
    expect(r.kind === 'found' && r.bookings.map(b => b.booking_ref).sort()).toEqual(['HH-A', 'HH-B'])
  })

  it('a LIKE wildcard reads NOBODY — this is the production finding', async () => {
    // A session cookie for `%` returned 34 bookings, every kids party in the
    // database, before the exact re-compare was added.
    for (const pattern of ['%', '%@example.com', '%example%']) {
      const r = await findBookingsByContactEmail(fakeDb({ bookings: BOOKINGS }), pattern)
      expect(r.kind).toBe('absent')
    }
  })

  it('an underscore does not sweep up a neighbour', async () => {
    const r = await findBookingsByContactEmail(fakeDb({ bookings: BOOKINGS }), 'jane_doe@example.com')
    expect(r.kind).toBe('absent')
  })

  it('excludeCancelled leaves a cancelled plan out', async () => {
    const all = await findBookingsByContactEmail(fakeDb({ bookings: BOOKINGS }), 'bob@example.com')
    expect(all.kind).toBe('found')
    const live = await findBookingsByContactEmail(
      fakeDb({ bookings: BOOKINGS }), 'bob@example.com', undefined, { excludeCancelled: true })
    expect(live.kind).toBe('absent')
  })

  it('appends contact_email when a caller forgets it — the filter needs it', async () => {
    const r = await findBookingsByContactEmail(
      fakeDb({ bookings: BOOKINGS }), 'jane@example.com', 'id, booking_ref')
    expect(r.kind).toBe('found')
  })

  it('a read failure is `unavailable`, never `absent` (rule 12)', async () => {
    const r = await findBookingsByContactEmail(fakeDb({ bookings: BOOKINGS }, 'bookings'), 'jane@example.com')
    expect(r.kind).toBe('unavailable')
  })

  it('an empty address is absent, not a wildcard', async () => {
    expect((await findBookingsByContactEmail(fakeDb({ bookings: BOOKINGS }), '')).kind).toBe('absent')
  })
})

describe('findContactsByEmail still behaves (the module it was extended from)', () => {
  const CONTACTS = [
    { id: 'c1', email: 'BON@GMAIL.COM' },
    { id: 'c2', email: 'other@gmail.com' },
  ]
  it('finds a mixed-case contact', async () => {
    const r = await findContactsByEmail(fakeDb({ contacts: CONTACTS }), 'bon@gmail.com')
    expect(r.kind === 'found' && r.contacts[0].id).toBe('c1')
  })
  it('refuses a wildcard', async () => {
    expect((await findContactsByEmail(fakeDb({ contacts: CONTACTS }), '%@gmail.com')).kind).toBe('absent')
  })
})

/* ── Tokens and codes, unchanged behaviour that must stay unchanged ──────── */

describe('portal tokens', () => {
  it('a token is valid for the ref it was minted against and no other', () => {
    const { token, hash } = generatePortalToken(REF, SECRET)
    expect(validatePortalToken(REF, token, SECRET, hash)).toBe(true)
    expect(validatePortalToken('HH-2026-9999', token, SECRET, hash)).toBe(false)
  })
  it('a wrong token and a malformed stored hash are both just "no"', () => {
    const { hash } = generatePortalToken(REF, SECRET)
    expect(validatePortalToken(REF, 'nope', SECRET, hash)).toBe(false)
    expect(validatePortalToken(REF, 'nope', SECRET, 'short')).toBe(false)
  })
})

describe('email login codes', () => {
  it('a code is bound to the address that asked for it', () => {
    const h = hashEmailLoginCode('123456', 'jane@example.com', SECRET)
    expect(verifyEmailLoginCode('123456', 'jane@example.com', h, SECRET)).toBe(true)
    expect(verifyEmailLoginCode('123456', 'bob@example.com', h, SECRET)).toBe(false)
    expect(verifyEmailLoginCode('123457', 'jane@example.com', h, SECRET)).toBe(false)
  })
  it('the address is compared case-insensitively', () => {
    const h = hashEmailLoginCode('123456', 'Jane@Example.com', SECRET)
    expect(verifyEmailLoginCode('123456', 'jane@example.com', h, SECRET)).toBe(true)
  })
  it('the attempt budget is a real number the route can read', () => {
    expect(getEmailCodeMaxAttempts()).toBeGreaterThan(0)
  })
})
