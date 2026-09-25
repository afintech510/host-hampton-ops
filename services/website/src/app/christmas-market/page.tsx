import type { Metadata } from 'next'
import Link from 'next/link'
import { CHRISTMAS_MARKET_2026 as MARKET } from '@/lib/christmasMarket'

/**
 * The PUBLIC market page — the one the emails, texts and banner point at.
 *
 * The vendor form lives at /christmas-market/vendors and is deliberately NOT
 * linked from here. It is noindex, absent from the sitemap, and sent to vendors
 * directly; a "become a vendor" button on the page every shopper lands on is
 * exactly the promotion Adam asked not to have.
 *
 * RSVPs are NOT collected here. They are collected by /events/christmas-market-2026,
 * which is an `events` row at price_cents = 0 — the free-event path in
 * app/api/events/checkout skips Stripe entirely, writes an event_tickets row,
 * upserts the contact and emails a confirmation. Building a second RSVP form
 * here would have meant a second table and a second admin screen saying the
 * same thing worse.
 */

const RSVP_HREF = `/events/${MARKET.eventSlug}`

/**
 * The flyer Adam is supplying.
 *
 * Kept as a constant that is NULL until the file actually exists in
 * public/images/. An <img> pointing at a 404 renders as a broken-image icon on
 * the page every marketing email will drive traffic to, which is worse than no
 * flyer at all. Drop the file in, set this string, done.
 */
const FLYER_SRC: string | null = null
// const FLYER_SRC: string | null = '/images/christmas-market-2026.jpg'

export const metadata: Metadata = {
  title: '3rd Annual Holiday Market — Free Pictures with Santa | Host Hampton',
  description:
    'Saturday, December 5th, 10am–1pm in Speonk. Free admission, free pictures with Santa, and local vendors at Host Hampton. RSVP free.',
  alternates: { canonical: 'https://www.hosthampton.com/christmas-market' },
  // NOTE: Next merges metadata SHALLOWLY — this openGraph object REPLACES the
  // root layout's, images and all. That is why `images` is restated here rather
  // than inherited; omitting it is how a page ends up sharing with no card.
  openGraph: {
    title: '3rd Annual Host Hampton Holiday Market',
    description:
      'Free admission · Free pictures with Santa · Local vendors. Saturday, December 5th, 10am–1pm in Speonk.',
    url: 'https://www.hosthampton.com/christmas-market',
    siteName: 'Host Hampton',
    type: 'website',
    images: [{ url: 'https://www.hosthampton.com/images/og-default.png', width: 1200, height: 630 }],
  },
}

const DETAILS: Array<[string, string]> = [
  ['When', `${MARKET.dateLabel}\n${MARKET.timeLabel}`],
  ['Where', 'Host Hampton\n295 Montauk Hwy, Suite 7\nSpeonk, NY 11972'],
  ['Admission', 'Free — everyone welcome'],
  ['Santa', 'Free pictures, bring your phone'],
]

export default function ChristmasMarketPage() {
  return (
    <main className="min-h-screen bg-[#F6F1EB]">
      {/* ── Hero ── */}
      <section className="bg-gradient-to-b from-[#BCCDEB] via-[#dae6f0] to-[#F7F2E8] px-5 pt-28 pb-16 text-center">
        <p className="text-hampton-navy/60 text-xs tracking-[2px] uppercase mb-3">
          Host Hampton &middot; Speonk, NY
        </p>
        <h1 className="text-hampton-navy font-serif text-4xl sm:text-5xl leading-tight mb-4">
          3rd Annual<br />Holiday Market
        </h1>
        <p className="text-hampton-navy/75 text-lg mb-2">
          {MARKET.dateLabel} &middot; {MARKET.timeLabel}
        </p>
        <p className="text-hampton-navy/60 text-base mb-8">
          Free admission &middot; Free pictures with Santa &middot; Local vendors
        </p>

        <Link
          href={RSVP_HREF}
          className="inline-block bg-hampton-navy text-[#F6F1EB] font-bold text-base px-10 py-4 rounded-full hover:opacity-90 transition-opacity"
        >
          RSVP — it&rsquo;s free
        </Link>
        <p className="text-hampton-navy/50 text-xs mt-3">
          Takes ten seconds. It just helps us plan for Santa&rsquo;s line.
        </p>
      </section>

      <div className="max-w-3xl mx-auto px-5 pb-20">
        {FLYER_SRC && (
          <img
            src={FLYER_SRC}
            alt="3rd Annual Host Hampton Holiday Market — December 5th, 10am to 1pm, free pictures with Santa"
            className="w-full rounded-2xl shadow-lg -mt-8 mb-12"
          />
        )}

        {/* ── Details ── */}
        <div className={`grid sm:grid-cols-2 gap-4 mb-12 ${FLYER_SRC ? '' : '-mt-4'}`}>
          {DETAILS.map(([label, value]) => (
            <div key={label} className="bg-white rounded-2xl p-6 shadow-sm">
              <p className="text-hampton-navy/50 text-xs tracking-wider uppercase mb-2">{label}</p>
              <p className="text-hampton-navy text-base leading-relaxed whitespace-pre-line">{value}</p>
            </div>
          ))}
        </div>

        {/* ── Santa ── */}
        <section className="bg-white rounded-2xl p-8 shadow-sm mb-8">
          <h2 className="text-hampton-navy font-serif text-2xl mb-4">Pictures with Santa — free</h2>
          <p className="text-hampton-navy/70 leading-relaxed mb-4">
            Santa will be here the whole three hours, and photos are completely free. There&rsquo;s no
            package to buy and no photographer to book — bring your phone, we&rsquo;ll take the picture
            for you, and you walk away with it.
          </p>
          <p className="text-hampton-navy/70 leading-relaxed">
            Come early if you have little ones. The line is shortest in the first hour, and we&rsquo;d
            rather your toddler met Santa happy than after forty-five minutes of waiting.
          </p>
        </section>

        {/* ── Vendors ── */}
        <section className="bg-white rounded-2xl p-8 shadow-sm mb-8">
          <h2 className="text-hampton-navy font-serif text-2xl mb-4">Shop local makers</h2>
          <p className="text-hampton-navy/70 leading-relaxed">
            We keep the market small on purpose — a handful of Long Island makers, one per category,
            so every table is worth stopping at. Candles, jewelry, baked goods, ceramics, prints,
            holiday decor. It&rsquo;s a genuinely good place to knock out your gift list in an hour
            without setting foot in a mall.
          </p>
        </section>

        {/* ── Closing CTA ── */}
        <section className="bg-gradient-to-br from-[#E8C7CB] to-[#A1B5C8] rounded-2xl p-8 text-center">
          <h2 className="text-hampton-navy font-serif text-2xl mb-3">Let us know you&rsquo;re coming</h2>
          <p className="text-hampton-navy/75 mb-6 max-w-md mx-auto leading-relaxed">
            RSVP is free and takes ten seconds. We&rsquo;ll send you a reminder the week of, and tell
            you first if anything changes.
          </p>
          <Link
            href={RSVP_HREF}
            className="inline-block bg-hampton-navy text-[#F6F1EB] font-bold px-10 py-4 rounded-full hover:opacity-90 transition-opacity"
          >
            RSVP for the Holiday Market
          </Link>
        </section>
      </div>
    </main>
  )
}
