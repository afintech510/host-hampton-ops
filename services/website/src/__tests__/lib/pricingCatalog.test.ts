/**
 * Tests for lib/pricingCatalog.ts — Phase 4 item 4.
 *
 * The point of this suite is the thing that makes moving prices into the DB
 * safe: a missing, broken or empty `pricing_items` table must render EXACTLY
 * today's published prices, never zero. A marketing page that says "$0" or a
 * checkout that charges nothing for a studio rental are both worse failures
 * than a stale figure, so parity with the pre-036 constants is asserted
 * directly rather than assumed.
 */

import {
  catalogFromRows,
  loadPricingCatalog,
  clearPricingCatalogCache,
  mobileBaseCentsFor,
  perChild,
  FALLBACK_CATALOG,
  FALLBACK_MOBILE_TIERS,
  FALLBACK_STUDIO_RATES,
  FALLBACK_GUEST_RULES,
  FALLBACK_MOBILE_POLICY,
  FALLBACK_MOBILE_STATIONS,
  type CatalogRow,
} from '@/lib/pricingCatalog'
import { studioRentalRate, studioRentalRateWith } from '@/lib/studioRental'

/** The full seed set migration 036 writes, as `pricing_items` rows. */
function seededRows(): CatalogRow[] {
  const row = (
    category: string,
    name: string,
    price_cents: number,
    metadata: Record<string, unknown>,
    extra: Partial<CatalogRow> = {},
  ): CatalogRow => ({ category, name, price_cents, metadata, sort_order: 0, ...extra })

  return [
    row('mobile-package', 'Mobile Party — Entry', 50000, {
      catalog_key: 'mobile_tier_entry', kind: 'published_tier', tier: 'Entry',
      minutes: 60, kids: 8, tagline: 'One craft, start to finish', popular: false,
      includes: ['One craft station of your choice', 'A dedicated host who runs the whole activity'],
    }),
    row('mobile-package', 'Mobile Party — Signature', 75000, {
      catalog_key: 'mobile_tier_signature', kind: 'published_tier', tier: 'Signature',
      minutes: 90, kids: 12, tagline: 'Our most-booked mobile party', popular: true,
      includes: ['Hair tinsel for every guest', 'Glitter tattoos'],
    }),
    row('mobile-package', 'Mobile Party Base (up to 18 guests)', 40000, {
      catalog_key: 'mobile_planner_base', max_guests: 18,
    }),
    row('mobile-package', 'Mobile Party — 19–27 guests surcharge', 15000, {
      catalog_key: 'mobile_planner_tier2', guest_threshold: 18,
    }),
    row('mobile-package', 'Mobile Party — 28+ guests surcharge', 15000, {
      catalog_key: 'mobile_planner_tier3', guest_threshold: 27,
    }),
    row('mobile-package', 'Mobile Party — Additional Child', 3500, { catalog_key: 'mobile_extra_child' }),
    row('mobile-package', 'Mobile Party — Minimum Guests', 0, { catalog_key: 'mobile_min_guests', value: 6 }),
    row('mobile-package', 'Mobile Party — Free Travel Radius', 0, {
      catalog_key: 'mobile_free_travel_miles', value: 20,
    }),

    row('studio-rental-rate', 'Studio Rental — Weekend 3 hr base', 60000, { catalog_key: 'studio_weekend_base' }),
    row('studio-rental-rate', 'Studio Rental — Weekday 3 hr base', 47500, { catalog_key: 'studio_weekday_base' }),
    row('studio-rental-rate', 'Studio Rental — Weekend additional hour', 15000, { catalog_key: 'studio_weekend_addl_hour' }),
    row('studio-rental-rate', 'Studio Rental — Weekday additional hour', 10000, { catalog_key: 'studio_weekday_addl_hour' }),
    row('studio-rental-rate', 'Studio Rental — Weekend full-day cap', 97500, { catalog_key: 'studio_weekend_full_day' }),
    row('studio-rental-rate', 'Studio Rental — Weekday full-day cap', 70000, { catalog_key: 'studio_weekday_full_day' }),
    row('studio-rental-rate', 'Studio Rental — Minimum block', 0, { catalog_key: 'studio_min_hours', value: 3 }),
    row('studio-rental-rate', 'Studio Rental — Refundable security hold', 50000, { catalog_key: 'studio_security_hold' }),

    row('guest-overage', 'Theme Party — Included Guests', 0, { catalog_key: 'theme_included_guests', value: 10 }),
    row('guest-overage', 'Theme Party — Additional Guest', 3500, { catalog_key: 'theme_extra_guest' }),
    row('guest-overage', 'Mini Party Discount', 20000, { catalog_key: 'mini_party_discount' }),
    row('guest-overage', 'Mini Party — Maximum Guests', 0, { catalog_key: 'mini_party_max_guests', value: 6 }),

    row('mobile-station', 'Slime', 0, { catalog_key: 'station_slime' }, { price_label: 'Ask', emoji: '🟢', sort_order: 7 }),
    row('mobile-station', 'Hair Tinsel', 0, { catalog_key: 'station_hair_tinsel' }, { price_label: 'Ask', emoji: '✨', sort_order: 2 }),
  ]
}

describe('pricingCatalog', () => {
  beforeEach(() => clearPricingCatalogCache())

  describe('the seeded catalog reproduces the pre-036 constants', () => {
    it('reads every group from the rows migration 036 writes', () => {
      const c = catalogFromRows(seededRows())

      expect(c.fromDb).toBe(true)
      expect(c.studioRates).toEqual(FALLBACK_STUDIO_RATES)
      expect(c.guestRules).toEqual(FALLBACK_GUEST_RULES)
      expect(c.mobilePolicy).toEqual(FALLBACK_MOBILE_POLICY)
      expect(c.mobileBands).toEqual(FALLBACK_CATALOG.mobileBands)
    })

    it('rebuilds the two published tiers, prices in whole dollars', () => {
      const c = catalogFromRows(seededRows())

      expect(c.mobileTiers.map(t => [t.name, t.price, t.minutes, t.kids])).toEqual([
        ['Entry', 500, 60, 8],
        ['Signature', 750, 90, 12],
      ])
      // The "Most Booked" ribbon on /mobile-party hangs off this flag.
      expect(c.mobileTiers[0].popular).toBe(false)
      expect(c.mobileTiers[1].popular).toBe(true)
    })

    it('orders stations by sort_order, not by the order rows arrive in', () => {
      const c = catalogFromRows(seededRows())
      expect(c.mobileStations.map(s => s.name)).toEqual(['Hair Tinsel', 'Slime'])
      expect(c.mobileStations.every(s => s.priceLabel === 'Ask' && s.priceCents === 0)).toBe(true)
    })
  })

  describe('a broken table renders today’s prices, never zero', () => {
    it('falls back completely when there are no rows at all', () => {
      const c = catalogFromRows([])

      expect(c.fromDb).toBe(false)
      expect(c).toEqual(FALLBACK_CATALOG)
      // The assertion that actually matters: no price is 0.
      expect(c.studioRates.weekendBaseCents).toBe(60000)
      expect(c.mobileTiers[0].price).toBe(500)
      expect(c.mobileStations.length).toBe(FALLBACK_MOBILE_STATIONS.length)
    })

    it('falls back per-field, so one bad row cannot zero a rate', () => {
      const rows = seededRows().map(r =>
        (r.metadata as { catalog_key?: string }).catalog_key === 'studio_weekend_base'
          ? { ...r, price_cents: 0 }
          : r,
      )
      const c = catalogFromRows(rows)

      expect(c.studioRates.weekendBaseCents).toBe(FALLBACK_STUDIO_RATES.weekendBaseCents)
      // Everything else still came from the DB.
      expect(c.studioRates.weekdayBaseCents).toBe(47500)
    })

    it('falls back for a tier whose includes list is missing', () => {
      const rows = seededRows().map(r =>
        (r.metadata as { catalog_key?: string }).catalog_key === 'mobile_tier_signature'
          ? { ...r, price_cents: 99900, metadata: { catalog_key: 'mobile_tier_signature', tier: 'Signature' } }
          : r,
      )
      const c = catalogFromRows(rows)
      // A blank tier card is worse than a stale one.
      expect(c.mobileTiers[1]).toEqual(FALLBACK_MOBILE_TIERS[1])
    })

    it('reports fromDb=false when the table is only partly seeded', () => {
      const rows = seededRows().filter(
        r => (r.metadata as { catalog_key?: string }).catalog_key !== 'studio_min_hours',
      )
      expect(catalogFromRows(rows).fromDb).toBe(false)
    })

    it('ignores rows with no catalog_key rather than mis-keying them', () => {
      const c = catalogFromRows([
        ...seededRows(),
        { category: 'studio-rental-rate', name: 'Something Adam typed', price_cents: 1, metadata: {} },
      ])
      expect(c.studioRates).toEqual(FALLBACK_STUDIO_RATES)
    })
  })

  describe('loadPricingCatalog', () => {
    function supaReturning(result: { data: unknown; error: unknown }) {
      const chain: Record<string, unknown> = {
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(result).then(res, rej),
      }
      for (const m of ['select', 'eq', 'in', 'order']) chain[m] = () => chain
      return { from: () => chain } as never
    }

    it('returns the fallback and does not throw when the query errors', async () => {
      const c = await loadPricingCatalog(supaReturning({ data: null, error: { message: 'relation missing' } }))
      expect(c).toEqual(FALLBACK_CATALOG)
    })

    it('returns the fallback when the client itself throws', async () => {
      const exploding = { from: () => { throw new Error('no network') } } as never
      const c = await loadPricingCatalog(exploding)
      expect(c).toEqual(FALLBACK_CATALOG)
    })

    it('caches a real read but NEVER caches a fallback', async () => {
      let calls = 0
      const failing = {
        from: () => {
          calls++
          const chain: Record<string, unknown> = {
            then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
          }
          for (const m of ['select', 'eq', 'in', 'order']) chain[m] = () => chain
          return chain
        },
      } as never

      await loadPricingCatalog(failing)
      await loadPricingCatalog(failing)
      // Caching a fallback would hold the wrong prices for a minute after the
      // DB came back, which is the one thing a price cache must not do.
      expect(calls).toBe(2)

      const rows = seededRows()
      const good = supaReturning({ data: rows, error: null })
      const first = await loadPricingCatalog(good)
      expect(first.fromDb).toBe(true)
      // A second call is served from cache; proven by it surviving a client
      // that would otherwise throw.
      const second = await loadPricingCatalog({ from: () => { throw new Error('should not be called') } } as never)
      expect(second.fromDb).toBe(true)
    })
  })

  describe('derived helpers', () => {
    it('keeps both tiers at the same per-child rate', () => {
      // Documented intent: Signature buys time and stations, not a higher
      // per-head rate. If this ever fails, a price moved without the other.
      const [entry, signature] = FALLBACK_MOBILE_TIERS
      expect(perChild(entry)).toBe(62.5)
      expect(perChild(signature)).toBe(62.5)
    })

    it('applies the mobile guest bands cumulatively', () => {
      const b = FALLBACK_CATALOG.mobileBands
      expect(mobileBaseCentsFor(b, 10)).toBe(40000)
      expect(mobileBaseCentsFor(b, 18)).toBe(40000) // threshold is exclusive
      expect(mobileBaseCentsFor(b, 19)).toBe(55000)
      expect(mobileBaseCentsFor(b, 27)).toBe(55000)
      expect(mobileBaseCentsFor(b, 28)).toBe(70000)
    })
  })

  describe('studioRentalRate parity', () => {
    // 2026-09-12 is a Saturday, 2026-09-15 a Tuesday.
    const SAT = '2026-09-12'
    const TUE = '2026-09-15'

    it('the pre-036 signature still prices exactly as it did', () => {
      expect(studioRentalRate(SAT, 3).rentalCents).toBe(60000)
      expect(studioRentalRate(SAT, 5).rentalCents).toBe(90000)
      expect(studioRentalRate(TUE, 3).rentalCents).toBe(47500)
      expect(studioRentalRate(TUE, 5).rentalCents).toBe(67500)
      // Full-day caps. A 6-hour weekday is already over the $700 cap
      // (47500 + 3×10000 = 77500), which is the cap doing its job.
      expect(studioRentalRate(TUE, 6).rentalCents).toBe(70000)
      expect(studioRentalRate(SAT, 12).rentalCents).toBe(97500)
      expect(studioRentalRate(TUE, 12).rentalCents).toBe(70000)
      expect(studioRentalRate(SAT, 12).isFullDay).toBe(true)
    })

    it('the DB-driven variant agrees with it on the seeded rates', () => {
      const { studioRates } = catalogFromRows(seededRows())
      for (const [date, hours] of [[SAT, 3], [SAT, 7], [TUE, 3], [TUE, 9]] as [string, number][]) {
        expect(studioRentalRateWith(studioRates, date, hours)).toEqual(studioRentalRate(date, hours))
      }
    })

    it('a price change in the DB actually changes what is charged', () => {
      const rows = seededRows().map(r =>
        (r.metadata as { catalog_key?: string }).catalog_key === 'studio_weekend_base'
          ? { ...r, price_cents: 65000 }
          : r,
      )
      const { studioRates } = catalogFromRows(rows)
      expect(studioRentalRateWith(studioRates, SAT, 3).rentalCents).toBe(65000)
      // ...and the compiled fallback is untouched by it.
      expect(studioRentalRate(SAT, 3).rentalCents).toBe(60000)
    })

    it('clamps to the catalog minimum block, not a hardcoded 3', () => {
      const rows = seededRows().map(r =>
        (r.metadata as { catalog_key?: string }).catalog_key === 'studio_min_hours'
          ? { ...r, metadata: { catalog_key: 'studio_min_hours', value: 4 } }
          : r,
      )
      const { studioRates } = catalogFromRows(rows)
      // A 2-hour request is billed as the 4-hour minimum block, and the base
      // covers the whole block — so no additional hours, just the base.
      const clamped = studioRentalRateWith(studioRates, SAT, 2)
      expect(clamped.hours).toBe(4)
      expect(clamped.addlHours).toBe(0)
      expect(clamped.rentalCents).toBe(60000)
      // The 5th hour is the first chargeable extra.
      expect(studioRentalRateWith(studioRates, SAT, 5).rentalCents).toBe(75000)
    })
  })
})
