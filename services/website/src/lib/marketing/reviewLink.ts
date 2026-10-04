/**
 * The Google review-ask link. Pure + no I/O so it's trivially unit-testable.
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
 * WHY THE DIRECT FORM, NOT `g.page/r/CXw9DJM9kFo-EBM/review` (2026-10-04).
 * The short link 302s here, but Adam reported the link in the first review-ask
 * batch "isn't working". Both forms were then texted to his own phone and both
 * opened the review box — so the failure was not the destination; it was the
 * hop and the UTM tags riding on it (the email button carried
 * `?utm_source=email&…`, which a phone hands to the Google Maps app). This is
 * the URL that short link resolves to, minus everything that can go wrong on
 * the way: no redirect, no tags. Place `ChIJv3k3iqn36IkRfD0Mkz2QWj4` is the
 * one the short link has always resolved to (verified 2026-09-11 and again
 * 2026-10-04).
 */
export const REVIEW_BASE_URL = 'https://search.google.com/local/writereview?placeid=ChIJv3k3iqn36IkRfD0Mkz2QWj4'

export type ReviewLinkSource = 'sms' | 'email'

/**
 * The link to put in a review ask. The SAME URL for every channel.
 *
 * It used to append `utm_source`/`utm_medium`/`utm_campaign`. Google drops
 * them on the way to the review form, so they never reached Search Console or
 * GA — they bought no measurement and were the one part of the link that
 * differed from the version proven to work. `source` is kept so callers still
 * say which channel they are, should a working attribution scheme ever exist.
 */
export function buildReviewUrl(_source: ReviewLinkSource): string {
  return REVIEW_BASE_URL
}
