import type { Metadata } from 'next'
import { NOINDEX } from '@/lib/seo'

/**
 * A photo set an admin sent one family (lib/photoSets.ts), behind a signed link.
 *
 * `robots: NOINDEX` as a meta tag rather than a robots.txt Disallow: a
 * disallowed URL is never fetched, so the directive is never read and the bare
 * URL can still be listed from an inbound link. `referrer: no-referrer` keeps the
 * link from travelling in a `Referer` header to anything the page reaches.
 */
export const metadata: Metadata = {
  title: 'Party photos',
  robots: NOINDEX,
  referrer: 'no-referrer',
}

export default function PhotoSetLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
