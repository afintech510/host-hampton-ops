import type { Metadata } from 'next'
import { NOINDEX } from '@/lib/seo'

/**
 * A per-guest check-in link behind a signed token.
 *
 * `robots: NOINDEX` rather than a robots.txt Disallow: a disallowed URL is
 * never fetched, so the directive is never read and the bare URL can still be
 * listed from an inbound link. To stay OUT of the index a page has to be
 * crawlable and say no.
 */
export const metadata: Metadata = {
  title: 'Check In',
  robots: NOINDEX,
}

export default function CheckinLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
