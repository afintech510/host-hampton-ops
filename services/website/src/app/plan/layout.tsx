import type { Metadata } from 'next'
import { NOINDEX, OG_DEFAULTS } from '@/lib/seo'

/**
 * A customer party plan and its invoice, reachable only with a signed portal cookie. Never a search result.
 *
 * `robots: NOINDEX` rather than a robots.txt Disallow: a disallowed URL is
 * never fetched, so the directive is never read and the bare URL can still be
 * listed from an inbound link. To stay OUT of the index a page has to be
 * crawlable and say no.
 *
 * ── Why this carries an OG card at all ──────────────────────────────────────
 *
 * `noindex` governs SEARCH. It does not stop a link-preview fetcher, and these
 * URLs are pasted into iMessage and WhatsApp constantly — so the choice is
 * between a deliberate generic card and whatever those clients invent.
 *
 * The title and description here are FIXED STRINGS and there is no
 * `generateMetadata`, on purpose. A per-plan title would be the customer's own
 * name and party date, rendered into a picture by a third party's server and
 * left sitting in a message thread. The page behind this is cookie-gated; its
 * preview card must be too, and the cheapest way to guarantee that is to give
 * the metadata nothing to leak.
 */
export const metadata: Metadata = {
  title: 'Party Plan',
  description: 'Your Host Hampton party plan and invoice.',
  robots: NOINDEX,
  openGraph: {
    ...OG_DEFAULTS,
    title: 'Your Host Hampton party plan',
    description: 'Open your secure booking portal to view your plan, make a payment, or send us a change.',
  },
}

export default function PlanLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
