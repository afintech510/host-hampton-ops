'use client'

/**
 * Card checkout landed. The row was already written before Stripe opened and
 * the webhook is what flips it to `paid` — this page only says thank you and
 * fires the GA4 conversion.
 *
 * `useSearchParams()` is inside a Suspense boundary and the PAGE CHROME is
 * outside it. That ordering is deliberate (link 13): a client page that calls
 * useSearchParams above its boundary prerenders as the FALLBACK, which is how
 * /book once shipped as ten characters of HTML.
 */

import { Suspense, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { trackPurchase } from '@/lib/gtag'
import { CHRISTMAS_MARKET_2026 as MARKET, marketPricing } from '@/lib/christmasMarket'

// This page is only ever reached from Stripe's `success_url`, so the card
// total is the right conversion value. A Venmo vendor never lands here — they
// get the reveal panel on the form itself and nothing is charged yet.
const TOTAL_DOLLARS = marketPricing(MARKET, 'card').totalCents / 100

function VendorConversionTracker() {
  const searchParams = useSearchParams()
  useEffect(() => {
    const sessionId = searchParams.get('session_id')
    if (!sessionId) return
    const key = `hh_conversion_${sessionId}`
    if (sessionStorage.getItem(key)) return
    trackPurchase(sessionId, TOTAL_DOLLARS, 'Christmas Market Vendor Booth')
    sessionStorage.setItem(key, '1')
  }, [searchParams])
  return null
}

export default function ChristmasMarketVendorSuccessPage() {
  return (
    <main style={{ minHeight: '100vh', background: '#F6F1EB', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
      <Suspense fallback={null}>
        <VendorConversionTracker />
      </Suspense>

      <div style={{ maxWidth: 480, textAlign: 'center' }}>
        <div style={{
          width: 80, height: 80, background: 'linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%)',
          borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 28px', fontSize: 36,
        }}>
          ✓
        </div>

        <p style={{ color: '#1a2744', opacity: 0.6, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', margin: '0 0 12px', fontFamily: 'sans-serif' }}>
          Host Hampton &middot; {MARKET.shortName}
        </p>

        <h1 style={{ color: '#1a2744', fontSize: 32, fontFamily: 'Georgia, serif', fontWeight: 'normal', margin: '0 0 16px', lineHeight: 1.3 }}>
          Your booth is booked!
        </h1>

        <p style={{ color: '#555', fontSize: 16, lineHeight: 1.75, margin: '0 0 28px', fontFamily: 'sans-serif' }}>
          You&rsquo;re in for <strong style={{ color: '#1a2744' }}>{MARKET.dateLabel}</strong>, {MARKET.timeLabel}.
          Check your email for your confirmation and setup details — remember to bring your own table.
        </p>

        <div style={{ background: 'white', borderRadius: 12, padding: '20px 28px', boxShadow: '0 2px 12px rgba(26,39,68,0.08)', marginBottom: 28 }}>
          <p style={{ color: '#1a2744', fontSize: 14, fontWeight: 'bold', margin: '0 0 4px', fontFamily: 'sans-serif' }}>
            Questions? We&rsquo;re here.
          </p>
          <p style={{ color: '#555', fontSize: 14, margin: 0, fontFamily: 'sans-serif' }}>
            Text or call <a href="tel:+16319989325" style={{ color: '#1a2744', fontWeight: 'bold' }}>(631) 998-9325</a>
            {' '}or DM <a href="https://www.instagram.com/hosthampton" style={{ color: '#1a2744', fontWeight: 'bold' }}>@hosthampton</a>
          </p>
        </div>

        <a href="/christmas-market" style={{ display: 'inline-block', color: '#1a2744', fontSize: 14, fontFamily: 'sans-serif', textDecoration: 'underline', opacity: 0.6 }}>
          See the market page
        </a>
      </div>
    </main>
  )
}
