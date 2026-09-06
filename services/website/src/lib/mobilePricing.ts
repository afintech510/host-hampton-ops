/**
 * Mobile party pricing — single source of truth for the published anchor.
 *
 * Owner-confirmed 2026-09-05. Change it HERE and every page updates: the
 * mobile-craft-party hub, /mobile-party, all craft landing pages, and all 26
 * town pages render from this file.
 *
 * Both tiers work out to the same $62.50/child — the Signature tier buys more
 * time and more stations, not a higher per-head rate. Worth keeping true if
 * these numbers ever move.
 *
 * Competitive context (see docs/marketing/mobile-pricing-analysis.md): Emily's
 * Slime Party is $499 for 12 (60 min, one craft); The Slime Machine is $675 for
 * 11 but adds tax + a 20% MANDATORY gratuity (~$810 real). We add neither, which
 * is why "what we quote is what you pay" belongs next to the price.
 */

export interface MobileTier {
  name: string
  /** Whole dollars. */
  price: number
  minutes: number
  /** Kids included, NOT counting the birthday child (who is free). */
  kids: number
  tagline: string
  /** What the tier includes, in plain language. */
  includes: string[]
  popular?: boolean
}

export const MOBILE_TIERS: MobileTier[] = [
  {
    name: 'Entry',
    price: 500,
    minutes: 60,
    kids: 8,
    tagline: 'One craft, start to finish',
    includes: [
      'One craft station of your choice',
      'A dedicated host who runs the whole activity',
      'All supplies, aprons and surface covers brought in',
      'A finished keepsake for every child',
      'Full setup and cleanup — we leave it as we found it',
    ],
  },
  {
    name: 'Signature',
    price: 750,
    minutes: 90,
    kids: 12,
    tagline: 'Our most-booked mobile party',
    popular: true,
    includes: [
      'Hair tinsel for every guest',
      'Glitter tattoos',
      'Your choice of craft station',
      'A dedicated host running every station',
      'All supplies, aprons and surface covers brought in',
      'A finished keepsake for every child',
      'Full setup and cleanup — we leave it as we found it',
    ],
  },
]

/** Fewest guests we'll run a mobile party for. */
export const MIN_GUESTS = 6

/** Flat deposit that holds a mobile party date (studio uses 25% instead). */
export const DEPOSIT = 250

/** Per additional child beyond the included count. */
export const EXTRA_CHILD_PRICE = 35

/** Free-travel radius from the Speonk studio, in miles. */
export const FREE_TRAVEL_MILES = 20

/** Both tiers price out to this per child — a useful thing to keep honest. */
export function perChild(tier: MobileTier): number {
  return Math.round((tier.price / tier.kids) * 100) / 100
}
