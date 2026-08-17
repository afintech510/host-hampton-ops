/**
 * The Google review-ask link, UTM-tagged per channel so review traffic is
 * distinguishable from other sources in Search Console / GA. Pure + no I/O so
 * it's trivially unit-testable.
 */

const REVIEW_BASE_URL = 'https://search.google.com/local/writereview?placeid=ChIJv3k3iqn36IkRfD0Mkz2QWj4'

export type ReviewLinkSource = 'sms' | 'email'

export function buildReviewUrl(source: ReviewLinkSource): string {
  const params = new URLSearchParams({
    utm_source: source,
    utm_medium: source === 'sms' ? 'sms' : 'email',
    utm_campaign: 'review_request',
  })
  return `${REVIEW_BASE_URL}&${params.toString()}`
}
