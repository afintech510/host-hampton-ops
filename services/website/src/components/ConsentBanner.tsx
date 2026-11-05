'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { isMetaPixelBlockedPath } from '@/lib/evites/chrome'
import {
  CONSENT_OPEN_EVENT, readConsentChoice, saveConsent, type ConsentChoice,
} from '@/lib/consent'

/**
 * The cookie choice. Asks once, remembers for a year, can be reopened from the
 * footer ("Cookie settings").
 *
 * Accept and Decline are the same size and weight on purpose: a banner that makes
 * "no" a small grey link is not asking.
 *
 * Declining costs the visitor nothing — the site, the planner and every form work
 * exactly the same; only the ad and analytics tags stay quiet. A browser sending
 * Global Privacy Control is treated as having declined and is never asked.
 *
 * Not shown where the ad tags never run (invitation pages, the crew app, the troop
 * board) or in the admin.
 */
function applyChoice(choice: ConsentChoice) {
  const granted = choice === 'granted'
  // Meta: the Pixel was initialised in "revoked" mode; grant (or re-revoke) it, and
  // count the page the visitor is on now that they have said yes.
  window.fbq?.('consent', granted ? 'grant' : 'revoke')
  if (granted) window.fbq?.('track', 'PageView')
  // Google: Consent Mode v2, the same four signals the page started with.
  const v = granted ? 'granted' : 'denied'
  window.gtag?.('consent', 'update', {
    ad_storage: v, analytics_storage: v, ad_user_data: v, ad_personalization: v,
  })
  // Last: it writes the cookie and tells listeners (ViewContent), who must find
  // the Pixel already granted.
  saveConsent(choice)
}

export default function ConsentBanner() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const evaluate = useCallback(() => {
    const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
    setOpen(!gpc && readConsentChoice(document.cookie) === null)
  }, [])

  useEffect(() => {
    evaluate()
    const reopen = () => setOpen(true)
    window.addEventListener(CONSENT_OPEN_EVENT, reopen)
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen)
  }, [evaluate])

  if (!open) return null
  if (pathname && (isMetaPixelBlockedPath(pathname) || pathname.startsWith('/admin'))) return null

  const choose = (choice: ConsentChoice) => {
    applyChoice(choice)
    setOpen(false)
  }
  const btn = 'px-5 py-2 rounded-full text-sm font-bold border-2 border-hampton-navy transition-colors'

  return (
    <div
      role="dialog"
      aria-label="Cookie choices"
      className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4 pointer-events-none"
    >
      <div className="pointer-events-auto mx-auto max-w-3xl rounded-2xl bg-white shadow-xl border border-hampton-mauve/40 p-4 sm:flex sm:items-center sm:gap-4">
        <p className="text-sm text-hampton-navy/80 flex-1">
          We use cookies to see which ads and pages bring in parties, and to show our ads to people who might enjoy them.
          Decline and the site works exactly the same.{' '}
          <Link href="/privacy-policy" className="underline">Privacy policy</Link>
        </p>
        <div className="mt-3 sm:mt-0 flex gap-2 shrink-0">
          <button type="button" onClick={() => choose('denied')} className={`${btn} bg-white text-hampton-navy hover:bg-hampton-ivory`}>
            Decline
          </button>
          <button type="button" onClick={() => choose('granted')} className={`${btn} bg-hampton-navy text-white hover:opacity-90`}>
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
