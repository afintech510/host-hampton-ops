/**
 * Review data for schema.org markup (rich-result stars).
 *
 * IMPORTANT — honesty / Google policy: aggregateRating must reflect REAL reviews.
 * The values below mirror the testimonials shown on the homepage, so the markup
 * is defensible today. Now that the Google Business Profile is live, update
 * RATING with the TRUE GBP average + total review count (and ideally surface a
 * few more real reviews on-site) to strengthen this. Do not inflate the count.
 */

export interface DisplayReview {
  name: string
  text: string
  stars: number
}

/** The testimonials also rendered visibly on the homepage. */
export const HOMEPAGE_REVIEWS: DisplayReview[] = [
  { name: 'Jessica M.', stars: 5, text: 'Absolutely incredible! My daughter and all her friends had the best time. The studio was perfectly decorated and the staff was so attentive. Worth every penny!' },
  { name: 'Sarah K.', stars: 5, text: 'Best birthday party decision I ever made. Host Hampton handled EVERYTHING. My daughter was crying tears of joy when she walked in. 10/10 would recommend!' },
  { name: 'Amanda R.', stars: 5, text: 'The girls were in heaven! Mini manicures, face masks, robes — pure magic. The owners clearly put so much love into making it special. We’ll be back!' },
]

/**
 * Aggregate rating for LocalBusiness schema — the live Google Business Profile
 * figures (confirmed by owner 2026-09-04: 25 ratings, 5.0 average). Update these
 * as the GBP rating/count changes. A few of these reviews are shown on the
 * homepage as Review nodes (HOMEPAGE_REVIEWS above).
 */
export const RATING = {
  ratingValue: '5.0',
  reviewCount: 25,
  bestRating: '5',
  worstRating: '1',
}
