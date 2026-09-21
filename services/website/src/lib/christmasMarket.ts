/**
 * The market registry.
 *
 * Everything that differs between one Host Hampton market and the next lives
 * here, the way `lib/fundraiserTeams.ts` holds everything that differs between
 * two identical fundraiser storefronts. The Spring Market taught the lesson the
 * expensive way: its name was hard-coded into SIX places (the hero, the button
 * label, the Stripe product name, `package_type`, the webhook's email and the
 * success page), so when the market passed, the page stayed live selling it.
 *
 * Adding next year's market should be an entry in MARKETS, not a migration and
 * not a find-and-replace.
 */

export interface MarketConfig {
  /** Matches `market_vendors.market_slug` and the `events.slug` that holds RSVPs. */
  slug: string
  /** The `events.slug` whose free tickets are the attendee RSVP list. */
  eventSlug: string
  name: string
  shortName: string
  dateLabel: string
  timeLabel: string
  /** ISO date of the market itself. Used for the "is this over?" check. */
  eventDate: string
  /**
   * When the site-wide banner turns ITSELF on.
   *
   * A window, rather than un-mounting the component from the layout, because
   * "take it out now and put it back later" is a promise about somebody's
   * memory in six weeks. `SpecialEventBanner` is the cautionary tale sitting in
   * this same repo: it has a kill switch but no start, so it shipped, expired
   * in July, and has rendered nothing since while still being imported.
   *
   * Both ends of the window are here so the banner's whole life is one thing
   * you can read at a glance.
   */
  promoStartsAt: string
  /** When promotion stops. The banner and the vendor form close themselves. */
  closesAt: string
  locationLine: string

  /** Booth fee before the processing fee, in cents. */
  boothFeeCents: number
  /** The processing fee passed on to the vendor, in cents. See note below. */
  serviceFeeCents: number

  /**
   * How many booths there are. Registrations past this go to the waitlist
   * rather than being refused — a vendor who filled the form is worth keeping
   * hold of even when the floor is full.
   */
  boothCapacity: number

  venmoHandle: string
  /** The number on the Venmo/Zelle account. NOT the public studio line. */
  venmoPhone: string
  venmoPhoneDisplay: string
}

/**
 * ── ON THE $2.05 ──
 *
 * The rest of this site charges a flat 3% "service fee" (`CC_RATE = 0.03` in
 * the events checkout; `$45 + $1.35` on the old vendor form). This one is 2.05,
 * not 1.50, and that is deliberate and Adam's call: 3% of $50 is $1.50, but
 * Stripe's actual cut is 2.9% + 30c = $1.81, so a 3% fee would still leave the
 * studio netting $49.69 on a booth advertised at $50. $52.05 nets $50.24.
 *
 * If you are reading this because you are adding a market and wondering whether
 * to follow the 3% convention or this one: follow this one for anything where
 * the headline number is what the studio must NET.
 */
export const CHRISTMAS_MARKET_2026: MarketConfig = {
  slug: 'christmas-market-2026',
  eventSlug: 'christmas-market-2026',
  name: '3rd Annual Host Hampton Christmas Market',
  shortName: 'Christmas Market',
  dateLabel: 'Saturday, December 5th',
  timeLabel: '10:00am – 1:00pm',
  eventDate: '2026-12-05',
  /**
   * Banner goes up **1 November 2026**, five weeks out.
   *
   * Adam's call on 2026-09-21: in late September the market is ten weeks away
   * and a permanent red bar on every page is just noise that people learn to
   * ignore before it matters. November 1 puts it up about a week ahead of the
   * announcement email in docs/christmas-market-2026-marketing.md, so the
   * banner is already familiar by the time the email lands.
   *
   * Moving this is a one-line change — it is the only thing that controls
   * whether the banner renders.
   */
  promoStartsAt: '2026-11-01T00:00:00-04:00',
  // End of the market day, Eastern. The box runs UTC (link 44 — `setHours()`
  // scheduled every reminder 4-5h early), so this is written with an explicit
  // offset and never derived from the server's local clock.
  closesAt: '2026-12-05T13:00:00-05:00',
  locationLine: 'Host Hampton · 295 Montauk Hwy, Suite 7, Speonk NY',

  boothFeeCents: 5000,
  serviceFeeCents: 205,

  boothCapacity: 9,

  venmoHandle: 'hosthampton',
  venmoPhone: '+16315992469',
  venmoPhoneDisplay: '(631) 599-2469',
}

export const MARKETS: Record<string, MarketConfig> = {
  [CHRISTMAS_MARKET_2026.slug]: CHRISTMAS_MARKET_2026,
}

/** Unknown slug returns null — the caller 400s rather than guessing a market. */
export function resolveMarket(slug: string | null | undefined): MarketConfig | null {
  if (!slug) return null
  return MARKETS[slug] ?? null
}

export function marketTotalCents(m: MarketConfig): number {
  return m.boothFeeCents + m.serviceFeeCents
}

/**
 * Has the market happened yet?
 *
 * Takes `now` so a test can ask about a specific instant rather than the wall
 * clock — six tests in this repo were red between 9pm and 8am ET for exactly
 * that reason (link 45).
 */
export function isMarketClosed(m: MarketConfig, now: Date = new Date()): boolean {
  return now.getTime() > new Date(m.closesAt).getTime()
}

/**
 * Should the site-wide banner be on the page right now?
 *
 * Note this governs the BANNER only, not the market. `/christmas-market`, the
 * RSVP event and the vendor form are all reachable before the banner goes up —
 * that is the whole point of a quiet period. Adam can send the vendor link and
 * work the RSVP list for weeks without a red bar on the homepage.
 */
export function isPromoLive(m: MarketConfig, now: Date = new Date()): boolean {
  if (now.getTime() < new Date(m.promoStartsAt).getTime()) return false
  return !isMarketClosed(m, now)
}

/**
 * What a vendor can sell.
 *
 * The exclusions are the studio's own service list. Host Hampton does hair
 * tinsel, permanent jewelry, trucker hats, totes and glitter tattoos in-house,
 * and a vendor selling the same thing three feet away is competing with the
 * room that is hosting them. Kids' toys are out because the market sits inside
 * a kids' party studio and the point of the day is gifts for grown-ups to buy.
 *
 * This list is shown to the vendor on the form. It is a door policy stated up
 * front, which is cheaper than a refund conversation in December.
 */
export const VENDOR_CATEGORIES = [
  'Jewelry (non-permanent)',
  'Candles & home fragrance',
  'Baked goods & confections',
  'Skincare & bath',
  'Art, prints & stationery',
  'Ceramics & pottery',
  'Apparel & accessories',
  'Holiday decor & wreaths',
  'Pet goods',
  'Specialty food & gifts',
  'Other (tell us below)',
] as const

export const VENDOR_EXCLUSIONS = [
  'Kids’ toys',
  'Hair tinsel',
  'Permanent jewelry',
  'Trucker hats',
  'Tote bags',
  'Glitter tattoos',
] as const

/**
 * Categories are first-come, first-served and we do not double up — a second
 * candle vendor halves the first one's day. The form says so; the admin screen
 * is what makes it enforceable, by showing category next to every paid row.
 */
export const VENDOR_CATEGORY_POLICY =
  'One vendor per category, first come first served. We’ll refund you in full if your category is already taken.'

/** Accepted values for `market_vendors.payment_method`. Mirrors the DB CHECK. */
export const VENDOR_PAYMENT_METHODS = ['card', 'venmo'] as const
export type VendorPaymentMethod = (typeof VENDOR_PAYMENT_METHODS)[number]

export function isVendorPaymentMethod(v: unknown): v is VendorPaymentMethod {
  return typeof v === 'string' && (VENDOR_PAYMENT_METHODS as readonly string[]).includes(v)
}

export function formatMarketMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
