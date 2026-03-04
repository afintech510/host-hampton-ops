'use client'

import Script from 'next/script'
import { GA_ID, GADS_ID } from '@/lib/gtag'

export default function GoogleAnalytics() {
  if (!GA_ID) return null

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_ID}', { send_page_view: true });
          ${GADS_ID ? `gtag('config', '${GADS_ID}');` : ''}
        `}
      </Script>
    </>
  )
}
