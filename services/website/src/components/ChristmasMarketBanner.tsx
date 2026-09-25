'use client'

/**
 * Site-wide promo bar for the Christmas Market.
 *
 * ── WHERE IT SITS, AND WHY NOT HIGHER ──
 *
 * `Nav` is `fixed top-0` and `main` carries a matching `pt-20`. A banner ABOVE
 * the nav would mean shifting the nav down and re-deriving that padding on
 * every page in the site — a global layout change to promote one Saturday in
 * December. So this is `sticky top-20` instead: it sits directly under the nav,
 * scrolls with the page, and sticks there. Same visibility, no global math, and
 * nothing to unwind in January.
 *
 * ── IT TURNS ITSELF ON, AND OFF ──
 *
 * `isPromoLive` is a WINDOW: `promoStartsAt` .. `closesAt`, both in the market
 * registry. Adam asked on 2026-09-21 to hide the banner because the market was
 * still ten weeks out, and a start date is the answer rather than un-mounting
 * the component — "take it out now, put it back in November" is a promise
 * about somebody's memory, and this repo already has the counter-example:
 * `SpecialEventBanner` has an `EXPIRY_DATE` but no start, so it expired in July
 * and has rendered nothing since while still being imported.
 *
 * Both ends live beside each other in one config object, so "when is this on
 * the site" is a question with a single readable answer.
 *
 * ── DISMISSAL ──
 *
 * Dismissal is per-browser and permanent for this market (the key carries the
 * slug, so next year's banner is not pre-dismissed). It is read in an effect
 * rather than during render because localStorage does not exist on the server
 * and reading it during render is a hydration mismatch.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CHRISTMAS_MARKET_2026 as MARKET, isPromoLive } from '@/lib/christmasMarket'

const DISMISS_KEY = `hh_banner_dismissed_${MARKET.slug}`

/**
 * Pages where the banner would be noise or an actual distraction: anything
 * behind the admin door, the checkout and portal flows (never interrupt a
 * customer who is paying), and the market's own pages.
 */
const HIDDEN_PREFIXES = [
  '/admin',
  '/my-booking',
  '/christmas-market',
  '/events/christmas-market',
  '/party-planner',
  '/party-builder',
  '/plan',
  '/checkin',
  '/r/',
  '/s/',
]

export default function ChristmasMarketBanner() {
  const pathname = usePathname()
  const [dismissed, setDismissed] = useState(true) // assume hidden until proven otherwise

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1')
    } catch {
      // Private mode, or storage disabled. Showing the banner is the safe
      // failure — an undismissable banner beats a banner nobody ever sees.
      setDismissed(false)
    }
  }, [])

  // Outside the promo window — too early, or the market has been and gone.
  // One check for both ends; see `promoStartsAt` in the market registry.
  if (!isPromoLive(MARKET)) return null
  if (dismissed) return null
  if (pathname && HIDDEN_PREFIXES.some(p => pathname.startsWith(p))) return null

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* dismissal just won't persist */
    }
  }

  return (
    <div className="sticky top-20 z-40 bg-gradient-to-r from-[#8b1d2c] via-[#a8283a] to-[#8b1d2c] text-white shadow-md">
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-3">
        <Link
          href="/christmas-market"
          className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm hover:opacity-90 transition-opacity"
        >
          <span aria-hidden="true">🎄</span>
          <span className="font-bold">3rd Annual Holiday Market</span>
          <span className="opacity-90">{MARKET.dateLabel}, {MARKET.timeLabel}</span>
          <span className="hidden sm:inline opacity-75">·</span>
          <span className="hidden sm:inline opacity-90">Free pictures with Santa</span>
          <span className="underline underline-offset-2 font-semibold whitespace-nowrap">RSVP free →</span>
        </Link>
        <button
          onClick={dismiss}
          aria-label="Dismiss Holiday Market announcement"
          className="shrink-0 w-7 h-7 grid place-items-center rounded-full hover:bg-white/20 transition-colors text-lg leading-none"
        >
          ×
        </button>
      </div>
    </div>
  )
}
