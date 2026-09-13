/**
 * Plan §25.3 / §25.9 — the short-link layer.
 *
 * The properties worth asserting are the ones that make a 128-bit bearer code
 * safe: it expires, it is screened on both sides, and failing to mint one costs
 * a segment rather than a lead.
 */

import {
  buildShortUrl,
  createShortLink,
  generateShortCode,
  hashShortCode,
  isAllowedTarget,
  isShortLinkExpired,
  isWellFormedCode,
  validateShortCode,
  shortLinkExpiresAt,
  SHORT_LINK_TTL_MS,
} from '@/lib/shortLink'
import { smsSegmentInfo } from '@/lib/smsSegments'

const SECRET = 'test-signing-secret'

describe('code shape and length', () => {
  it('is 22 base64url characters — the whole point of the module', () => {
    const { code, url } = generateShortCode(SECRET)
    expect(code).toHaveLength(22)
    expect(isWellFormedCode(code)).toBe(true)
    // 112 characters was the old preview URL. This must be dramatically less.
    expect(url.length).toBeLessThanOrEqual(50)
  })

  it('drops www. but keeps the scheme', () => {
    expect(buildShortUrl('a'.repeat(22))).toMatch(/^https:\/\/hosthampton\.com\/s\//)
  })

  it('rejects anything that is not a code we could have minted', () => {
    for (const bad of ['', 'short', 'a'.repeat(23), 'a'.repeat(21), "'; drop table--", 'a'.repeat(22) + '!']) {
      expect(isWellFormedCode(bad)).toBe(false)
    }
  })

  it('codes are unique across many mints', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 500; i++) seen.add(generateShortCode(SECRET).code)
    expect(seen.size).toBe(500)
  })
})

describe('hashing', () => {
  it('stores only the HMAC — the raw code is not recoverable from it', () => {
    const { code, hash } = generateShortCode(SECRET)
    expect(hash).toHaveLength(64)
    expect(hash).not.toContain(code)
  })

  it('validates the right code and rejects a tampered one', () => {
    const { code, hash } = generateShortCode(SECRET)
    expect(validateShortCode(code, SECRET, hash)).toBe(true)
    expect(validateShortCode('b'.repeat(22), SECRET, hash)).toBe(false)
    expect(validateShortCode(code, 'other-secret', hash)).toBe(false)
    expect(validateShortCode(code, SECRET, null)).toBe(false)
    expect(validateShortCode(code, '', hash)).toBe(false)
  })

  it('hashShortCode agrees with minting, or nothing would ever resolve', () => {
    const { code, hash } = generateShortCode(SECRET)
    expect(hashShortCode(code, SECRET)).toBe(hash)
  })
})

describe('target screening', () => {
  it('allows our own pages and Slack permalinks', () => {
    expect(isAllowedTarget('https://www.hosthampton.com/review/abc')).toBe(true)
    expect(isAllowedTarget('https://hosthampton.com/admin')).toBe(true)
    expect(isAllowedTarget('https://hosthampton.slack.com/archives/C08/p1789266286113')).toBe(true)
  })

  it('PARSES rather than prefix-matching — the lookalike host is the whole test', () => {
    expect(isAllowedTarget('https://www.hosthampton.com.evil.test/')).toBe(false)
    expect(isAllowedTarget('https://evil.test/?x=https://www.hosthampton.com')).toBe(false)
    // A suffix match that is not anchored on a dot lets this through.
    expect(isAllowedTarget('https://notslack.com/archives/C08')).toBe(false)
    expect(isAllowedTarget('https://evilslack.com/x')).toBe(false)
  })

  it('rejects a credential in the authority', () => {
    // Reads as our host to a human, resolves to evil.test in a browser.
    expect(isAllowedTarget('https://www.hosthampton.com@evil.test/')).toBe(false)
  })

  it('rejects non-https schemes outright', () => {
    expect(isAllowedTarget('http://www.hosthampton.com/review/abc')).toBe(false)
    expect(isAllowedTarget('javascript:alert(1)')).toBe(false)
    expect(isAllowedTarget('data:text/html,<script>')).toBe(false)
    expect(isAllowedTarget('//www.hosthampton.com/review/abc')).toBe(false)
    expect(isAllowedTarget('not a url')).toBe(false)
  })
})

describe('expiry', () => {
  it('defaults to the 7 days §20 settled on', () => {
    const now = new Date('2026-09-12T00:00:00Z')
    expect(shortLinkExpiresAt(now).getTime() - now.getTime()).toBe(SHORT_LINK_TTL_MS)
  })

  it('an unknown or unparseable expiry reads as EXPIRED, not as fresh', () => {
    expect(isShortLinkExpired(null)).toBe(true)
    expect(isShortLinkExpired(undefined)).toBe(true)
    expect(isShortLinkExpired('not a date')).toBe(true)
  })

  it('compares against the real clock', () => {
    const now = new Date('2026-09-12T12:00:00Z')
    expect(isShortLinkExpired('2026-09-12T11:59:59Z', now)).toBe(true)
    expect(isShortLinkExpired('2026-09-12T12:00:01Z', now)).toBe(false)
  })
})

describe('createShortLink', () => {
  const okDb = (captured: Record<string, unknown>[] = []) => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        captured.push(row)
        return Promise.resolve({ error: null })
      },
    }),
  })

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  it('stores the hash and never the raw code', async () => {
    const rows: Record<string, unknown>[] = []
    const minted = await createShortLink(okDb(rows), {
      target: 'https://www.hosthampton.com/review/tok',
      secret: SECRET,
      entityType: 'inquiry_draft',
      entityId: '11111111-1111-1111-1111-111111111111',
    })
    expect(minted).not.toBeNull()
    expect(rows).toHaveLength(1)
    expect(rows[0].code_hash).toBe(minted!.hash)
    expect(JSON.stringify(rows[0])).not.toContain(minted!.code)
    expect(rows[0].expires_at).toEqual(expect.any(String))
  })

  it('refuses to mint for a target that /s/ would refuse to serve', async () => {
    const rows: Record<string, unknown>[] = []
    const minted = await createShortLink(okDb(rows), {
      target: 'https://evil.test/phish',
      secret: SECRET,
    })
    expect(minted).toBeNull()
    expect(rows).toHaveLength(0)
  })

  it('returns null rather than throwing when the insert fails', async () => {
    const db = { from: () => ({ insert: () => Promise.resolve({ error: { message: 'boom' } }) }) }
    await expect(
      createShortLink(db, { target: 'https://hosthampton.com/review/t', secret: SECRET }),
    ).resolves.toBeNull()
  })

  it('returns null rather than throwing when the client throws', async () => {
    const db = { from: () => ({ insert: () => { throw new Error('network') } }) } as never
    await expect(
      createShortLink(db, { target: 'https://hosthampton.com/review/t', secret: SECRET }),
    ).resolves.toBeNull()
  })

  it('will not mint without a secret', async () => {
    const rows: Record<string, unknown>[] = []
    await expect(
      createShortLink(okDb(rows), { target: 'https://hosthampton.com/review/t', secret: '' }),
    ).resolves.toBeNull()
    expect(rows).toHaveLength(0)
  })
})

describe('the segment this is all for', () => {
  it('a short link saves more than a segment against the full preview URL', () => {
    const longUrl = `https://www.hosthampton.com/review/HH-2026-0042.${'a'.repeat(64)}`
    const shortUrl = generateShortCode(SECRET).url
    expect(longUrl.length).toBeGreaterThan(110)
    expect(shortUrl.length).toBeLessThan(50)

    const head = '[HH-2026-0042 - mobile party] draft ready: Sarah, Oct 12, 24 guests\n'
    expect(smsSegmentInfo(head + shortUrl).segments).toBe(1)
    expect(smsSegmentInfo(head + longUrl).segments).toBeGreaterThan(1)
  })
})
