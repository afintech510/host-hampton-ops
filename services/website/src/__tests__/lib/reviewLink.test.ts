/**
 * Tests for the Google review link used by every review ask (SMS + email).
 */

import { buildReviewUrl, REVIEW_BASE_URL } from '@/lib/marketing/reviewLink'

describe('buildReviewUrl', () => {
  /**
   * The ONE place the literal is deliberately written out in a test, and it is
   * a tripwire rather than an assertion about plumbing: changing where we send
   * customers to review the business should be a conscious act that breaks a
   * test, not a drive-by edit.
   *
   * That distinction is the lesson from the failure this replaced. The SMS
   * template test asserted this same URL — a value it did not own, copied from
   * another file — so when that file changed, the test went red and stayed red
   * for days because nobody could tell whether it was a real bug. A test that
   * pins a value it owns is a guard; one that pins a value it borrowed is rot.
   *
   * If you are here because this test failed: check the new URL actually opens
   * Host Hampton's review box ON A PHONE (that is how 2026-10-04's "the link
   * isn't working" was settled), then update this line on purpose.
   */
  it('points straight at the Host Hampton Google review form', () => {
    expect(buildReviewUrl('sms')).toBe(
      'https://search.google.com/local/writereview?placeid=ChIJv3k3iqn36IkRfD0Mkz2QWj4'
    )
  })

  it('is the SAME link on every channel — no per-channel tags', () => {
    expect(buildReviewUrl('email')).toBe(buildReviewUrl('sms'))
    expect(buildReviewUrl('email')).toBe(REVIEW_BASE_URL)
  })

  it('carries nothing but the place id: no redirect hop, no UTM tags', () => {
    const url = new URL(buildReviewUrl('email'))
    expect(url.hostname).toBe('search.google.com')
    expect([...url.searchParams.keys()]).toEqual(['placeid'])
    expect(buildReviewUrl('email')).not.toContain('g.page')
    expect(buildReviewUrl('email')).not.toContain('utm_')
  })
})
