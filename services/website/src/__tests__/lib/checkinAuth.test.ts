import {
  generateCheckinToken,
  validateCheckinToken,
  hashCheckinToken,
  buildCheckinUrl,
  isExpiredForParty,
} from '@/lib/checkinAuth'

const SECRET = 'test-secret-key-for-unit-tests-only'

describe('generateCheckinToken', () => {
  it('returns token, hash, and expiry', () => {
    const result = generateCheckinToken(SECRET)
    expect(result.token).toBeTruthy()
    expect(result.hash).toBeTruthy()
    expect(result.expiresAt).toBeInstanceOf(Date)
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('generates a different token every call', () => {
    const a = generateCheckinToken(SECRET)
    const b = generateCheckinToken(SECRET)
    expect(a.token).not.toBe(b.token)
    expect(a.hash).not.toBe(b.hash)
  })

  it('never stores the raw token — the hash must differ from it', () => {
    const { token, hash } = generateCheckinToken(SECRET)
    expect(hash).not.toBe(token)
    expect(hash).not.toContain(token)
  })

  it('produces a high-entropy token (32 random bytes as hex)', () => {
    const { token } = generateCheckinToken(SECRET)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('respects a custom expiry', () => {
    const result = generateCheckinToken(SECRET, 1) // 1 hour
    const diff = result.expiresAt.getTime() - Date.now()
    expect(diff).toBeLessThanOrEqual(3600 * 1000 + 100)
    expect(diff).toBeGreaterThan(3500 * 1000)
  })
})

describe('validateCheckinToken', () => {
  it('validates a correctly generated token', () => {
    const { token, hash } = generateCheckinToken(SECRET)
    expect(validateCheckinToken(token, SECRET, hash)).toBe(true)
  })

  it('rejects a different token against the same hash', () => {
    const { hash } = generateCheckinToken(SECRET)
    const other = generateCheckinToken(SECRET)
    expect(validateCheckinToken(other.token, SECRET, hash)).toBe(false)
  })

  it('rejects a valid token under the wrong secret', () => {
    const { token, hash } = generateCheckinToken(SECRET)
    expect(validateCheckinToken(token, 'a-different-secret', hash)).toBe(false)
  })

  it('rejects a malformed / wrong-length stored hash without throwing', () => {
    const { token } = generateCheckinToken(SECRET)
    expect(validateCheckinToken(token, SECRET, 'short')).toBe(false)
    expect(validateCheckinToken(token, SECRET, '')).toBe(false)
  })

  it('rejects an empty token', () => {
    const { hash } = generateCheckinToken(SECRET)
    expect(validateCheckinToken('', SECRET, hash)).toBe(false)
  })
})

describe('hashCheckinToken', () => {
  it('is deterministic for the same token and secret', () => {
    expect(hashCheckinToken('abc', SECRET)).toBe(hashCheckinToken('abc', SECRET))
  })

  it('is namespaced so a portal token hash cannot collide with a check-in one', () => {
    // Both libs HMAC with the same secret; the 'checkin:' prefix keeps them distinct.
    const crypto = require('crypto')
    const unprefixed = crypto.createHmac('sha256', SECRET).update('abc').digest('hex')
    expect(hashCheckinToken('abc', SECRET)).not.toBe(unprefixed)
  })
})

describe('buildCheckinUrl', () => {
  it('builds a /checkin/<token> url and does not leak the booking ref', () => {
    const url = buildCheckinUrl('deadbeef')
    expect(url).toContain('/checkin/deadbeef')
    expect(url).not.toContain('HH-')
  })
})

describe('isExpiredForParty', () => {
  // 2026-07-04 is EDT (UTC-4): local midnight-end == 2026-07-05T03:59:59Z
  it('is not expired the morning of the party', () => {
    expect(isExpiredForParty('2026-07-04', new Date('2026-07-04T13:00:00Z'))).toBe(false)
  })

  it('is not expired late in the evening, local time', () => {
    // 11pm Eastern on the party date = 03:00Z the next day
    expect(isExpiredForParty('2026-07-04', new Date('2026-07-05T03:00:00Z'))).toBe(false)
  })

  it('is expired the day after the party', () => {
    expect(isExpiredForParty('2026-07-04', new Date('2026-07-06T12:00:00Z'))).toBe(true)
  })

  it('handles a winter (EST) date without expiring an hour early', () => {
    // 2026-12-05, 11:30pm EST = 2026-12-06T04:30:00Z — still the party day.
    expect(isExpiredForParty('2026-12-05', new Date('2026-12-06T04:30:00Z'))).toBe(false)
    expect(isExpiredForParty('2026-12-05', new Date('2026-12-06T05:30:00Z'))).toBe(true)
  })

  it('does not expire when there is no party date on file', () => {
    expect(isExpiredForParty(null)).toBe(false)
    expect(isExpiredForParty(undefined)).toBe(false)
  })

  it('does not expire on an unparseable date', () => {
    expect(isExpiredForParty('not-a-date')).toBe(false)
  })
})
