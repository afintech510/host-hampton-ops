import type { Metadata } from 'next'
import { NOINDEX } from '@/lib/seo'

/**
 * A customer party plan and its invoice, reachable only with a signed portal cookie. Never a search result.
 *
 * `robots: NOINDEX` rather than a robots.txt Disallow: a disallowed URL is
 * never fetched, so the directive is never read and the bare URL can still be
 * listed from an inbound link. To stay OUT of the index a page has to be
 * crawlable and say no.
 */
export const metadata: Metadata = {
  title: 'Party Plan',
  robots: NOINDEX,
}

export default function PlanLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
