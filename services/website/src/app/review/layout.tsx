import type { Metadata } from 'next'
import { NOINDEX } from '@/lib/seo'

/**
 * A reviewer preview of an unsent draft reply, behind a signed 7-day token. An indexed copy would outlive the token.
 *
 * `robots: NOINDEX` rather than a robots.txt Disallow: a disallowed URL is
 * never fetched, so the directive is never read and the bare URL can still be
 * listed from an inbound link. To stay OUT of the index a page has to be
 * crawlable and say no.
 */
export const metadata: Metadata = {
  title: 'Draft Review',
  robots: NOINDEX,
}

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
