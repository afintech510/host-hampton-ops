import type { Metadata } from 'next'

/**
 * Shared SEO constants.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS: Next.js metadata is merged SHALLOWLY between a layout
 * and the page beneath it. A page that exports its own `openGraph` REPLACES the
 * root layout's whole `openGraph` object — it does not merge field by field. So
 * every page that set `openGraph: { title, description, url, siteName, locale,
 * type }` silently dropped the root layout's `images: [og-default.png]`, and
 * shipped with NO og:image at all.
 *
 * Measured on the live site 2026-09-12: 40 of 69 sitemap URLs had no og:image,
 * including /book, /faq, /studio-rental, /mobile-party and all 26 town pages.
 * Every share of those pages on Facebook, iMessage, WhatsApp or Slack rendered
 * a blank card.
 *
 * The fix is rule 11 — a constant declared in two files is a constant nothing is
 * checking. Spread `OG_DEFAULTS` into every page-level `openGraph` block instead
 * of restating the fields, and `src/__tests__/lib/seo.test.ts` walks `src/app`
 * and fails if a new page reintroduces the gap.
 */

export const SITE_URL = 'https://www.hosthampton.com'

/**
 * Stable `@id`s for the two JSON-LD nodes that describe Host Hampton itself.
 *
 * Before these existed, a single page could emit FOUR unlinked descriptions of
 * the same business: the root layout's `EventVenue`, the root layout's
 * `Organization`, a page-level `Service.provider` LocalBusiness, and (on the
 * homepage) one `Review.itemReviewed` LocalBusiness per review. With no `@id`,
 * a consumer has no way to know those are one entity — they read as four
 * businesses at the same address, which is the opposite of the knowledge-panel
 * consolidation the Organization node was added for.
 *
 * Every other node now REFERENCES these rather than restating them (rule 11).
 */
export const BUSINESS_ID = `${SITE_URL}/#business`
export const ORGANIZATION_ID = `${SITE_URL}/#organization`

/**
 * The canonical reference to the business, for use as `provider`,
 * `itemReviewed`, `publisher` and so on. Carries `name` as well as `@id` so a
 * consumer that does not resolve references still has something to show.
 */
export const businessRef = () => ({ '@id': BUSINESS_ID, name: 'Host Hampton' }) as const

/** The default share card. 1200x630 is the size Facebook and X both want. */
export const OG_DEFAULT_IMAGE = {
  url: '/images/og-default.png',
  width: 1200,
  height: 630,
  alt: 'Host Hampton — Boutique Celebration Studio in Speonk, NY',
}

/**
 * Spread this into any page-level `openGraph`, then override `title`,
 * `description`, `url` and (if the page has a better one) `images`.
 *
 * Deliberately NOT `as const`: Next's `OpenGraph` type wants mutable arrays, so
 * a readonly tuple here fails to typecheck at all 20 call sites.
 */
export const OG_DEFAULTS: NonNullable<Metadata['openGraph']> = {
  siteName: 'Host Hampton',
  locale: 'en_US',
  type: 'website',
  images: [OG_DEFAULT_IMAGE],
}

/**
 * Pages that must never be indexed: the customer portal, a signed invoice, a
 * reviewer draft preview, a checkout confirmation, an internal tool.
 *
 * This is a `<meta name="robots">` tag rather than a robots.txt `Disallow`, and
 * the distinction is load-bearing: a disallowed URL is never FETCHED, so Google
 * never sees the noindex and can still list the bare URL from an inbound link.
 * To actually keep a page out of the index it has to be crawlable and say no.
 */
export const NOINDEX = {
  index: false,
  follow: false,
  googleBot: { index: false, follow: false },
} as const

/**
 * Google truncates a title at roughly 580px — about 60 characters — and a
 * description at about 160. Past those the tail is replaced with an ellipsis,
 * so the value proposition at the end of a 96-character title is never read.
 * These are the limits `seo.test.ts` enforces against the generated titles.
 */
export const MAX_TITLE_CHARS = 60
export const MAX_DESCRIPTION_CHARS = 160

/** The root layout's title template appends this to every non-absolute title. */
export const TITLE_SUFFIX = ' | Host Hampton'

/**
 * Keys that make a JSON-LD node a PUBLISHED PRICE rather than a description.
 *
 * Anything carrying one of these puts a figure into Google's index, where it is
 * quoted back to a customer as our price.
 */
const PRICE_KEYS = new Set([
  'price',
  'lowprice',
  'highprice',
  'pricecurrency',
  'pricespecification',
  'offers',
  'minprice',
  'maxprice',
])

/**
 * Does this structured-data node publish a price anywhere inside it?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY. `website_content.structured.jsonLd` is rendered VERBATIM into a
 * `<script type="application/ld+json">` by app/[...slug]/page.tsx, and
 * `website_content` is written by the COPY agent and the weekly town-drafts
 * cron. No writer sets `jsonLd` today and no live row has one — but the READER
 * accepts it, and hard-won rule 5 is that a field is hostile because of who can
 * write it, not which block it prints in.
 *
 * A model-authored `offers.price` would publish an invented figure to Google
 * under our name, with no human in the path — and on a town page it would be a
 * MOBILE price, which is the one number in this codebase that belongs to Adam
 * alone (plan §15). So a DB-authored block carrying a price is dropped, and the
 * page falls back to the derived graph, which prices nothing.
 *
 * Rule 10: the caller must SAY that it dropped it. Silence is what success
 * looks like.
 */
export function carriesPublishedPrice(node: unknown): boolean {
  // A `seen` set rather than a depth cap. A depth cap terminates on a cycle but
  // it is also a BYPASS: nest the price one level past the limit and the screen
  // waves it through. Rule 8 — do not trust a stated guarantee, exercise it;
  // the guarantee here is "we look everywhere", so it has to be everywhere.
  const seen = new WeakSet<object>()
  const stack: unknown[] = [node]
  while (stack.length) {
    const cur = stack.pop()
    if (cur === null || typeof cur !== 'object') continue
    if (seen.has(cur as object)) continue
    seen.add(cur as object)
    if (Array.isArray(cur)) {
      stack.push(...cur)
      continue
    }
    for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
      if (PRICE_KEYS.has(k.toLowerCase())) return true
      stack.push(v)
    }
  }
  return false
}
