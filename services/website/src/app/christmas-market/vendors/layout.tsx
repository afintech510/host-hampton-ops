import type { Metadata } from 'next'
import { NOINDEX } from '@/lib/seo'

/**
 * NOT PROMOTED — Adam's requirement for the Christmas Market vendor form.
 *
 * `robots: NOINDEX` rather than a robots.txt Disallow, for the reason the
 * vendor-registration success page already documents: a disallowed URL is never
 * fetched, so the directive is never read, and the bare URL can still be listed
 * from an inbound link. To stay OUT of the index a page must be crawlable and
 * say no.
 *
 * This page is also deliberately absent from app/sitemap.xml and linked from
 * nowhere on the public site. The market's PUBLIC page (/christmas-market) is
 * the promoted one; this is the link Adam sends to vendors directly.
 */
export const metadata: Metadata = {
  title: 'Vendor Booth Registration — Host Hampton Holiday Market',
  robots: NOINDEX,
}

export default function ChristmasMarketVendorLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
