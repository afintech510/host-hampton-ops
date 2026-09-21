import type { Metadata } from 'next'
import { NOINDEX } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'Booth Confirmed — Host Hampton Christmas Market',
  robots: NOINDEX,
}

export default function ChristmasMarketVendorSuccessLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
