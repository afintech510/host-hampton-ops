'use client'

import Script from 'next/script'
import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { META_PIXEL_ID } from '@/lib/metaPixel'
import { isMetaPixelBlockedPath } from '@/lib/evites/chrome'

/**
 * Meta Pixel, mounted once in the root layout.
 *
 * Gated on NEXT_PUBLIC_META_PIXEL_ID so it stays completely dark until the value
 * is set — the same pattern GoogleAnalytics uses for GADS_ID. Unset means not a
 * single byte goes to Meta.
 *
 * ADVANCED MATCHING IS OFF, by decision (2026-09-22). `fbq('init', id)` is called
 * with NO user-data object, so no hashed email or phone leaves the browser. Note
 * this is only half the switch: "Automatic Advanced Matching" is also a toggle in
 * Events Manager → Settings, and if that is on, Meta scrapes form fields on its
 * own regardless of what this file does. It must be turned off there too.
 */
export default function MetaPixel() {
  const pathname = usePathname()
  const bootstrapped = useRef(false)

  // The init script below fires the FIRST PageView. Every client-side navigation
  // after that is a history push, not a document load, so nothing else would ever
  // fire and a 20-page site would report as a 1-page site — which would quietly
  // ruin the per-page audiences this pixel exists to build.
  //
  // Deliberately keyed on pathname only. Reading useSearchParams() here would
  // opt every page in the app out of static rendering, and this component lives
  // in the root layout, so that cost would be site-wide.
  useEffect(() => {
    if (!META_PIXEL_ID) return
    // A guest's invitation (`/i/<slug>`) and the host's invitation page send Meta
    // NOTHING (spec §7.1, §13). Skipped BEFORE the bootstrap bookkeeping, so
    // landing on one and walking into the site still gets exactly one PageView:
    // the inline script counts that page, and this effect then treats it as the
    // first run.
    if (isMetaPixelBlockedPath(pathname)) return
    // Skip the first run: the inline script already counted this page view.
    if (!bootstrapped.current) {
      bootstrapped.current = true
      return
    }
    window.fbq?.('track', 'PageView')
  }, [pathname])

  if (!META_PIXEL_ID) return null

  // After every hook (navHookOrder.test.ts): this component is in the root layout
  // and survives a client-side navigation. Not rendered, so the init script (and
  // its first PageView) never loads on these pages.
  if (isMetaPixelBlockedPath(pathname)) return null

  return (
    <Script id="meta-pixel" strategy="afterInteractive">
      {`
        !function(f,b,e,v,n,t,s)
        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window,document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', '${META_PIXEL_ID}');
        fbq('track', 'PageView');
      `}
    </Script>
  )
}
