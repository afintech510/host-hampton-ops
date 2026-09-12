/**
 * Tests for the UTM-tagged Google review link builder used by the review-ask
 * SMS + email sends (Phase 3 review-engine tagging).
 */

import { buildReviewUrl } from '@/lib/marketing/reviewLink'

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
   * If you are here because this test failed: check the new URL actually
   * resolves to Host Hampton's Google place, then update this line on purpose.
   */
  it('points at the Host Hampton Google review page for sms', () => {
    const url = buildReviewUrl('sms')
    expect(url).toContain('https://g.page/r/CXw9DJM9kFo-EBM/review')
  })

  it('joins UTM params onto a query-less base with "?" not "&"', () => {
    const url = buildReviewUrl('sms')
    expect(url).toContain('/review?utm_source=')
    expect(url).not.toContain('/review&utm_source=')
  })

  it('tags sms links with utm_source=sms&utm_medium=sms', () => {
    const url = buildReviewUrl('sms')
    expect(url).toContain('utm_source=sms')
    expect(url).toContain('utm_medium=sms')
    expect(url).toContain('utm_campaign=review_request')
  })

  it('tags email links with utm_source=email&utm_medium=email', () => {
    const url = buildReviewUrl('email')
    expect(url).toContain('utm_source=email')
    expect(url).toContain('utm_medium=email')
    expect(url).toContain('utm_campaign=review_request')
  })

  it('is stable and deterministic for the same input', () => {
    expect(buildReviewUrl('sms')).toBe(buildReviewUrl('sms'))
  })
})
