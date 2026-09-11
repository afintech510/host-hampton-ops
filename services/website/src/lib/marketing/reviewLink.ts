/**
 * The Google review-ask link, UTM-tagged per channel so review traffic is
 * distinguishable from other sources in Search Console / GA. Pure + no I/O so
 * it's trivially unit-testable.
 */

const REVIEW_BASE_URL = 'https://g.page/r/CXw9DJM9kFo-EBM/review'

export type ReviewLinkSource = 'sms' | 'email'

export function buildReviewUrl(source: ReviewLinkSource): string {
  const params = new URLSearchParams({
    utm_source: source,
    utm_medium: source === 'sms' ? 'sms' : 'email',
    utm_campaign: 'review_request',
  })
  // Join with '?' or '&' depending on whether the base already has a query
  // string. The g.page short link has none, so a hardcoded '&' would produce a
  // malformed URL. (Note: Google's g.page redirect drops these UTM params on
  // the hop to the review form, so tagging is best-effort only.)
  const sep = REVIEW_BASE_URL.includes('?') ? '&' : '?'
  return `${REVIEW_BASE_URL}${sep}${params.toString()}`
}
