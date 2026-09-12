import type { Metadata } from 'next'
import { OG_DEFAULTS, SITE_URL } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'Vendor Registration — Host Hampton Markets',
  description:
    'Register as a vendor for a Host Hampton market or pop-up in Speonk, NY. Tell us about your business and reserve your table.',
  alternates: { canonical: `${SITE_URL}/vendor-registration` },
  openGraph: {
    ...OG_DEFAULTS,
    title: 'Vendor Registration — Host Hampton Markets',
    description: 'Reserve your table at a Host Hampton market or pop-up on the East End.',
    url: `${SITE_URL}/vendor-registration`,
  },
}

export default function VendorRegistrationLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: 'body { background: #BCCDEB !important; }' }} />
      {children}
    </>
  )
}
