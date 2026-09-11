/**
 * Tests for the UTM-tagged Google review link builder used by the review-ask
 * SMS + email sends (Phase 3 review-engine tagging).
 */

import { buildReviewUrl } from '@/lib/marketing/reviewLink'

describe('buildReviewUrl', () => {
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
