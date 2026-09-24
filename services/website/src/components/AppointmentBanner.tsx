'use client'

/**
 * Site-wide promo bar for whichever appointment event is currently on.
 *
 * ── THIS IS THE FIX FOR "IMPORTED BY NOTHING" ──
 *
 * `SpecialEventBanner`, the component this replaces, was mounted on `/events`
 * by hand for one pop-up in July 2026. It had an `EXPIRY_DATE` and **no start
 * date**, so there was no way to put it up ahead of time — which meant it had
 * to be added by hand and then deleted by hand (commit 64afaa2). After that it
 * sat in the tree for three months imported from nowhere, rendering nothing.
 *
 * This one is mounted PERMANENTLY in `app/layout.tsx`, and that is safe
 * precisely because the window governs visibility: `livePromoEvent()` returns
 * the event whose `promoStartsAt .. closesAt` contains right now, or null.
 * Nobody has to remember to add it, and nobody has to remember to take it away.
 *
 * ── WHERE IT SITS ──
 *
 * `sticky top-20`, directly under the `fixed top-0` nav, same as
 * `ChristmasMarketBanner`. A banner ABOVE the nav means shifting the nav and
 * re-deriving `main`'s `pt-20` on every page in the site, which is a global
 * layout change to promote one Friday.
 *
 * Both banners can be up at once — they stack, and that is correct: a Christmas
 * Market and a Christmas Hair day are two different things a customer might
 * want. `livePromoEvent()` picks the soonest-closing appointment event so only
 * ONE appointment bar is ever on the page.
 *
 * ── DISMISSAL ──
 *
 * Per-browser and permanent for this event. The key carries the SLUG, so
 * dismissing Halloween Hair does not pre-dismiss Christmas Hair. Read in an
 * effect rather than during render, because localStorage does not exist on the
 * server and reading it during render is a hydration mismatch.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { livePromoEvent } from '@/lib/appointmentEvents'

/**
 * Pages where the banner would be noise or an actual distraction: anything
 * behind the admin door, the checkout and portal flows (never interrupt a
 * customer who is paying), and the appointment pages themselves.
 */
const HIDDEN_PREFIXES = [
  '/admin',
  '/my-booking',
  '/appointments',
  '/christmas-market',
  '/party-planner',
  '/party-builder',
  '/plan',
  '/checkin',
  '/r/',
  '/s/',
]

export default function AppointmentBanner() {
  const pathname = usePathname()
  const [dismissed, setDismissed] = useState(true) // assume hidden until proven otherwise

  // Evaluated on every render rather than memoised: the window is a function of
  // the clock, and a tab left open across `closesAt` should stop advertising a
  // day that has been and gone.
  const EVENT = livePromoEvent()

  useEffect(() => {
    if (!EVENT) return
    try {
      setDismissed(localStorage.getItem(`hh_banner_dismissed_${EVENT.slug}`) === '1')
    } catch {
      // Private mode, or storage disabled. Showing the banner is the safe
      // failure — an undismissable banner beats a banner nobody ever sees.
      setDismissed(false)
    }
  }, [EVENT])

  // Outside every promo window — too early, or the last one has been and gone.
  if (!EVENT) return null
  if (dismissed) return null
  if (pathname && HIDDEN_PREFIXES.some(p => pathname.startsWith(p))) return null

  function dismiss() {
    setDismissed(true)
    try {
      if (EVENT) localStorage.setItem(`hh_banner_dismissed_${EVENT.slug}`, '1')
    } catch {
      /* dismissal just won't persist */
    }
  }

  return (
    <div
      className="sticky top-20 z-40 text-white shadow-md"
      style={{ backgroundColor: EVENT.accentHex }}
    >
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-3">
        <Link
          href={`/appointments/${EVENT.slug}`}
          className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm hover:opacity-90 transition-opacity"
        >
          <span className="font-bold">{EVENT.name}</span>
          <span className="opacity-90">{EVENT.dateLabel}</span>
          <span className="hidden sm:inline opacity-75">·</span>
          <span className="hidden sm:inline opacity-90">By appointment</span>
          <span className="underline underline-offset-2 font-semibold whitespace-nowrap">Book your slot →</span>
        </Link>
        <button
          onClick={dismiss}
          aria-label={`Dismiss ${EVENT.name} announcement`}
          className="shrink-0 w-7 h-7 grid place-items-center rounded-full hover:bg-white/20 transition-colors text-lg leading-none"
        >
          ×
        </button>
      </div>
    </div>
  )
}
