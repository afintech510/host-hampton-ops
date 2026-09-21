/**
 * The market registry, and the two tripwires that guard what was actually
 * promised rather than what is merely easy to assert.
 *
 * Note what the last describe block does: it reads the vendor page's SOURCE and
 * fails if the Venmo handle is in it. The arithmetic tests below would all stay
 * green if somebody "simplified" the reveal into a client-side toggle, because
 * arithmetic is not what that requirement is about. The requirement is that the
 * credentials cannot be obtained without the form being submitted, and the only
 * thing that can prove it is the absence of the handle from the bundle.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CHRISTMAS_MARKET_2026 as MARKET,
  MARKETS,
  resolveMarket,
  marketTotalCents,
  isMarketClosed,
  isPromoLive,
  isVendorPaymentMethod,
  VENDOR_CATEGORIES,
  VENDOR_EXCLUSIONS,
  formatMarketMoney,
} from '@/lib/christmasMarket'

const SRC = join(__dirname, '..', '..')

describe('market registry', () => {
  it('resolves a known slug and refuses an unknown one', () => {
    expect(resolveMarket(MARKET.slug)).toBe(MARKET)
    expect(resolveMarket('spring-market-1999')).toBeNull()
    expect(resolveMarket('')).toBeNull()
    expect(resolveMarket(null)).toBeNull()
    expect(resolveMarket(undefined)).toBeNull()
  })

  it('keys every registry entry by its own slug', () => {
    // A mismatch here means resolveMarket() hands back a market whose slug is
    // not the one that was asked for, and rows get filed under the wrong market.
    for (const [key, m] of Object.entries(MARKETS)) {
      expect(m.slug).toBe(key)
    }
  })
})

describe('booth pricing', () => {
  it('charges $50 plus the processing fee, and the parts add up', () => {
    expect(MARKET.boothFeeCents).toBe(5000)
    expect(MARKET.serviceFeeCents).toBe(205)
    expect(marketTotalCents(MARKET)).toBe(5205)
    // Migration 059 has this as a CHECK. If the two ever disagree, the database
    // refuses the row and the vendor sees a 500 at the moment they try to pay.
    expect(marketTotalCents(MARKET)).toBe(MARKET.boothFeeCents + MARKET.serviceFeeCents)
  })

  it('actually nets $50 after Stripe takes 2.9% + 30c', () => {
    // The whole reason this fee is 205 and not the site-wide 3% (=150). If
    // someone "corrects" it back to 3% for consistency, the studio quietly
    // starts netting $49.69 on a booth advertised at $50.
    const total = marketTotalCents(MARKET)
    const stripeCut = Math.round(total * 0.029) + 30
    expect(total - stripeCut).toBeGreaterThanOrEqual(5000)
  })

  it('formats money with cents', () => {
    expect(formatMarketMoney(5205)).toBe('$52.05')
    expect(formatMarketMoney(5000)).toBe('$50.00')
  })
})

describe('market closure', () => {
  // Every assertion passes an explicit instant. Six tests in this repo were red
  // between 9pm and 8am ET because they read the wall clock instead.
  it('is open well before the market', () => {
    expect(isMarketClosed(MARKET, new Date('2026-11-01T12:00:00Z'))).toBe(false)
  })

  it('is open on the morning of the market', () => {
    // 9am Eastern on the day. The banner must still be up.
    expect(isMarketClosed(MARKET, new Date('2026-12-05T14:00:00Z'))).toBe(false)
  })

  it('closes after the market ends, not at UTC midnight', () => {
    // 1pm Eastern == 18:00Z. The box runs UTC; a naive local-time comparison
    // here is the same class of bug that scheduled every reminder 4-5h early.
    expect(isMarketClosed(MARKET, new Date('2026-12-05T17:59:00Z'))).toBe(false)
    expect(isMarketClosed(MARKET, new Date('2026-12-05T18:01:00Z'))).toBe(true)
  })

  it('stays closed a year later', () => {
    expect(isMarketClosed(MARKET, new Date('2027-01-01T00:00:00Z'))).toBe(true)
  })
})

describe('the banner window', () => {
  // Adam asked for the banner hidden on 2026-09-21 because the market was ten
  // weeks out. These assert the WINDOW, not the absence — a test that only
  // checked "hidden today" would go green forever and never notice the banner
  // failing to appear in November, which is the expensive direction.

  it('is off in September, when the market is ten weeks away', () => {
    expect(isPromoLive(MARKET, new Date('2026-09-21T12:00:00Z'))).toBe(false)
  })

  it('is still off the day before it is due up', () => {
    expect(isPromoLive(MARKET, new Date('2026-10-31T12:00:00Z'))).toBe(false)
  })

  it('turns itself on on 1 November — nobody has to remember', () => {
    expect(isPromoLive(MARKET, new Date('2026-11-01T05:00:00Z'))).toBe(true)
  })

  it('is up for the announcement email in mid-November', () => {
    expect(isPromoLive(MARKET, new Date('2026-11-10T12:00:00Z'))).toBe(true)
  })

  it('is up on the morning of the market', () => {
    expect(isPromoLive(MARKET, new Date('2026-12-05T14:00:00Z'))).toBe(true)
  })

  it('turns itself off once the market has ended', () => {
    expect(isPromoLive(MARKET, new Date('2026-12-05T18:01:00Z'))).toBe(false)
    expect(isPromoLive(MARKET, new Date('2027-01-01T00:00:00Z'))).toBe(false)
  })

  it('opens before it closes', () => {
    // A window inverted by a typo would render the banner never, silently.
    expect(new Date(MARKET.promoStartsAt).getTime())
      .toBeLessThan(new Date(MARKET.closesAt).getTime())
  })

  it('is the ONLY thing gating the banner', () => {
    // The market itself — page, RSVP, vendor form — must stay reachable during
    // the quiet period. If the banner's window ever leaks into those, sending a
    // vendor the link in October stops working.
    const banner = readFileSync(join(SRC, 'components/ChristmasMarketBanner.tsx'), 'utf8')
    expect(banner).toMatch(/isPromoLive\(MARKET\)/)

    for (const f of ['app/christmas-market/page.tsx', 'app/christmas-market/vendors/page.tsx']) {
      expect(readFileSync(join(SRC, f), 'utf8')).not.toMatch(/isPromoLive/)
    }
  })
})

describe('vendor input validation', () => {
  it('accepts only the two payment methods the DB CHECK allows', () => {
    expect(isVendorPaymentMethod('card')).toBe(true)
    expect(isVendorPaymentMethod('venmo')).toBe(true)
    expect(isVendorPaymentMethod('cash')).toBe(false)
    expect(isVendorPaymentMethod('')).toBe(false)
    expect(isVendorPaymentMethod(null)).toBe(false)
    expect(isVendorPaymentMethod(undefined)).toBe(false)
    expect(isVendorPaymentMethod(['card'])).toBe(false)
  })

  it('never offers a category the studio sells in-house', () => {
    // The door policy is "nothing that competes with us". If an exclusion ever
    // turns up in the dropdown, the form is inviting exactly what it forbids.
    const categories = VENDOR_CATEGORIES.map(c => c.toLowerCase())
    for (const excluded of VENDOR_EXCLUSIONS) {
      const bare = excluded.toLowerCase().replace(/[’']/g, '')
      expect(categories.some(c => c.replace(/[’']/g, '').includes(bare))).toBe(false)
    }
  })

  it('has a catch-all category so a maker who fits nothing can still apply', () => {
    expect(VENDOR_CATEGORIES.some(c => /other/i.test(c))).toBe(true)
  })
})

describe('the Venmo reveal is server-gated', () => {
  const vendorPage = readFileSync(join(SRC, 'app/christmas-market/vendors/page.tsx'), 'utf8')

  it('does not ship the Venmo handle in the vendor page bundle', () => {
    // THE tripwire. "Complete all the info to reveal the Venmo credentials"
    // means the credentials are not obtainable without submitting — which is
    // only true while they are absent from the client bundle. A client-side
    // `hidden` toggle would satisfy every other test in this file.
    expect(vendorPage).not.toMatch(/venmo\.com\/\?txn=pay/i)
    expect(vendorPage).not.toContain(MARKET.venmoHandle)
    expect(vendorPage).not.toContain(MARKET.venmoPhone)
    expect(vendorPage).not.toContain(MARKET.venmoPhoneDisplay)
  })

  it('renders the handle only from the API response', () => {
    // The reveal panel reads `venmo.handle` off state populated by the fetch.
    expect(vendorPage).toMatch(/venmo\.handle/)
    expect(vendorPage).toMatch(/setVenmo\(data\.venmo\)/)
  })

  it('the API route is the only place the handle comes from', () => {
    const route = readFileSync(join(SRC, 'app/api/christmas-market/vendor/route.ts'), 'utf8')
    expect(route).toMatch(/market\.venmoHandle/)
    // And it is returned AFTER the insert, never before. If the reveal ever
    // moves above the insert, the form stops capturing the vendor.
    const insertAt = route.indexOf(".from('market_vendors')\n    .insert(")
    const revealAt = route.indexOf('venmoHandle')
    expect(insertAt).toBeGreaterThan(-1)
    expect(revealAt).toBeGreaterThan(insertAt)
  })
})

describe('the vendor form is not promoted', () => {
  it('is noindex', () => {
    const layout = readFileSync(join(SRC, 'app/christmas-market/vendors/layout.tsx'), 'utf8')
    expect(layout).toMatch(/robots:\s*NOINDEX/)
  })

  it('is absent from the sitemap', () => {
    const sitemap = readFileSync(join(SRC, 'app/sitemap.xml/route.ts'), 'utf8')
    // The public market page belongs there; the vendor form does not.
    expect(sitemap).toContain("'/christmas-market'")
    expect(sitemap).not.toContain("'/christmas-market/vendors'")
  })

  it('is not linked from the public market page', () => {
    const publicPage = readFileSync(join(SRC, 'app/christmas-market/page.tsx'), 'utf8')
    // Only ever as a prose mention inside a comment, never an href.
    expect(publicPage).not.toMatch(/href=["'{][^)]*christmas-market\/vendors/)
  })

  it('reserves its own slugs so a CMS page cannot shadow them', () => {
    const slugSafety = readFileSync(join(SRC, 'lib/content/slugSafety.ts'), 'utf8')
    expect(slugSafety).toContain("'/christmas-market'")
    expect(slugSafety).toContain("'/christmas-market/vendors'")
  })
})
