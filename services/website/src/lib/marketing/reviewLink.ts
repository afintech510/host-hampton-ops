/**
 * The Google review-ask link, UTM-tagged per channel so review traffic is
 * distinguishable from other sources in Search Console / GA. Pure + no I/O so
 * it's trivially unit-testable.
 */

/**
 * The one place this URL is written down.
 *
 * It used to be written down twice — here and as `DEFAULT_REVIEW_URL` in
 * `lib/sms-templates.ts` — and the two drifted apart in `b422874`, which
 * changed this file's copy as a drive-by inside an unrelated triage fix and
 * left the other one and its test asserting the old value. Nothing compared
 * them, so the suite simply carried a failing test for days and everyone
 * (including three sessions of mine) learned to step around it.
 *
 * That is the same shape as the two pricing divergences: a constant declared in
 * two files is a constant nothing is checking. Exported so there is exactly one
 * answer to "where do we send people to leave a review".
 *
 * Both forms resolve to the same Google place — the short link 302s to
 * `search.google.com/local/writereview?placeid=ChIJv3k3iqn36IkRfD0Mkz2QWj4`,
 * verified 2026-09-11 — so this is the shorter spelling of one destination,
 * not a different one.
 */
export const REVIEW_BASE_URL = 'https://g.page/r/CXw9DJM9kFo-EBM/review'

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
