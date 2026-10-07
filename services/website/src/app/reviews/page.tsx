import type { Metadata } from 'next'
import Link from 'next/link'
import { Star } from 'lucide-react'
import { GOOGLE_REVIEWS, GOOGLE_REVIEWS_URL, RATING } from '@/lib/reviews'
import { REVIEW_BASE_URL } from '@/lib/marketing/reviewLink'
import { OG_DEFAULTS, SITE_URL, businessRef } from '@/lib/seo'

/**
 * /reviews — every Google review, verbatim, in one fetchable page.
 *
 * WHY. Asked "Host Hampton reviews", answer engines found no review page of
 * ours and built the answer from homepage testimonials that traced to nothing
 * (docs/aeo-deep-dive-2026-10.md §3.3). This page is plain server-rendered
 * text, so a crawler that runs no JavaScript reads every word.
 */

export const metadata: Metadata = {
  title: `Reviews — ${RATING.ratingValue} Stars on Google`,
  description: `Read all ${RATING.reviewCount} Google reviews of Host Hampton, the private party studio in Speonk, NY: themed kids birthday parties, at-home parties, craft nights and events on Long Island and in the Hamptons.`,
  alternates: { canonical: `${SITE_URL}/reviews` },
  openGraph: {
    ...OG_DEFAULTS,
    title: `Host Hampton Reviews — ${RATING.ratingValue} Stars from ${RATING.reviewCount} Families`,
    description: 'Verbatim Google reviews from families who have celebrated with Host Hampton.',
    url: `${SITE_URL}/reviews`,
  },
}

const reviewSchema = GOOGLE_REVIEWS.map(r => ({
  '@context': 'https://schema.org',
  '@type': 'Review',
  itemReviewed: businessRef(),
  author: { '@type': 'Person', name: r.name },
  reviewRating: { '@type': 'Rating', ratingValue: r.stars, bestRating: 5, worstRating: 1 },
  reviewBody: r.text,
  publisher: { '@type': 'Organization', name: 'Google' },
}))

export default function ReviewsPage() {
  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(reviewSchema).replace(/</g, '\\u003c') }} />

      <section className="pt-16 pb-10 text-center px-4">
        <p className="section-subheading">Google Reviews</p>
        <h1 className="font-serif text-4xl md:text-5xl text-hampton-navy mb-4">Host Hampton Reviews</h1>
        <div className="flex justify-center gap-1 mb-3" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => <Star key={i} size={20} className="text-yellow-400 fill-yellow-400" />)}
        </div>
        <p className="text-hampton-navy text-lg mb-4">
          Rated <strong>{RATING.ratingValue} out of 5</strong> from <strong>{RATING.reviewCount} reviews</strong> on Google.
        </p>
        <p className="text-hampton-navy/80 text-base max-w-2xl mx-auto leading-relaxed">
          Every review below is copied word for word from our Google Business Profile. Most are from
          kids&apos; birthday parties at our private studio in Speonk; others are from at-home parties,
          craft nights and our seasonal markets.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
          <a href={GOOGLE_REVIEWS_URL} target="_blank" rel="noopener noreferrer" className="btn-secondary">See them on Google</a>
          <a href={REVIEW_BASE_URL} target="_blank" rel="noopener noreferrer" className="btn-secondary">Leave a review</a>
          <Link href="/party-packages" className="btn-primary">Plan your party</Link>
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-20">
        <div className="grid md:grid-cols-2 gap-5">
          {GOOGLE_REVIEWS.map(r => (
            <article key={r.name} className="bg-white rounded-2xl p-6 shadow-sm border border-hampton-pink/20">
              <div className="flex mb-3" aria-label={`${r.stars} out of 5 stars`}>
                {Array.from({ length: r.stars }).map((_, i) => <Star key={i} size={14} className="text-yellow-400 fill-yellow-400" />)}
              </div>
              <p className="text-hampton-navy text-sm leading-relaxed mb-4">&ldquo;{r.text}&rdquo;</p>
              <p className="font-semibold text-hampton-navy text-sm">{r.name}</p>
              {r.occasion && <p className="text-hampton-navy/60 text-xs">{r.occasion}</p>}
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
