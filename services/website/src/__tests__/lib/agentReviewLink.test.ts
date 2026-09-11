/**
 * Tests for the /review/<token> preview-link tokens.
 * The security property under test: only the raw token opens the page, and the
 * stored hash alone can never be turned back into a working link.
 */

import {
  generateReviewToken,
  validateReviewToken,
  reviewCodeFromToken,
  buildReviewUrl,
  generateReviewCode,
} from '@/lib/agent/reviewLink'

const SECRET = 'review-signing-secret'

describe('agent review links', () => {
  it('mints a token that validates against its own hash', () => {
    const { token, hash } = generateReviewToken('HH-2026-0042', SECRET)
    expect(validateReviewToken(token, SECRET, hash)).toBe(true)
  })

  it('stores only the hash — the raw token never appears in it', () => {
    const { token, hash } = generateReviewToken('HH-2026-0042', SECRET)
    expect(hash).not.toContain(token.split('.')[1])
    expect(hash).toHaveLength(64)
  })

  it('rejects a tampered token, a wrong secret, and a missing hash', () => {
    const { token, hash } = generateReviewToken('HH-2026-0042', SECRET)
    expect(validateReviewToken(token + 'x', SECRET, hash)).toBe(false)
    expect(validateReviewToken(token, 'other-secret', hash)).toBe(false)
    expect(validateReviewToken(token, SECRET, null)).toBe(false)
    expect(validateReviewToken('', SECRET, hash)).toBe(false)
  })

  it('does not throw on a malformed stored hash (length mismatch)', () => {
    const { token } = generateReviewToken('HH-2026-0042', SECRET)
    expect(validateReviewToken(token, SECRET, 'short')).toBe(false)
  })

  it('carries the review code so the page can find the row', () => {
    const { token } = generateReviewToken('HH-2026-0042', SECRET)
    expect(reviewCodeFromToken(token)).toBe('HH-2026-0042')
    expect(reviewCodeFromToken('nodelimiter')).toBeNull()
    expect(reviewCodeFromToken('.leading')).toBeNull()
    expect(reviewCodeFromToken('trailing.')).toBeNull()
  })

  it('builds an absolute preview URL without a double slash', () => {
    expect(buildReviewUrl('HH-2026-0042.abc', 'https://www.hosthampton.com/')).toBe(
      'https://www.hosthampton.com/review/HH-2026-0042.abc',
    )
  })

  it('generates review codes in the HH-<year>-<4 digits> shape', () => {
    const code = generateReviewCode(new Date('2026-09-10T00:00:00Z'))
    expect(code).toMatch(/^HH-2026-\d{4}$/)
  })
})
