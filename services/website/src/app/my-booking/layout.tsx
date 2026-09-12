import type { Metadata } from 'next'
import { NOINDEX } from '@/lib/seo'

/**
 * The customer portal. Every page under it shows one customer their own booking.
 *
 * `robots: NOINDEX` rather than a robots.txt Disallow: a disallowed URL is
 * never fetched, so the directive is never read and the bare URL can still be
 * listed from an inbound link. To stay OUT of the index a page has to be
 * crawlable and say no.
 */
export const metadata: Metadata = {
  title: 'My Booking',
  robots: NOINDEX,
}

export default function MyBookingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
