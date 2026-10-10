'use client'

import Script from 'next/script'
import { usePathname } from 'next/navigation'
import { GA_ID, GADS_ID } from '@/lib/gtag'
import { gaInitScript } from '@/lib/gaInit'

export default function GoogleAnalytics() {
  const pathname = usePathname()

  if (!GA_ID) return null

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {gaInitScript({ gaId: GA_ID, gadsId: GADS_ID, pathname })}
      </Script>
    </>
  )
}
