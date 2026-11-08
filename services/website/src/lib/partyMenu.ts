/**
 * The party menu, as the AI surfaces serve it: what a studio party includes,
 * the activity rules, every add-on with its price, and the mobile anchor.
 *
 * Built from the SAME `LoadedCatalog` the quote prices from
 * (`lib/quoteRequest.ts`), so an item the menu lists is an item `get_quote`
 * can price, at the price it lists. The ChatGPT connector (`get_party_menu`)
 * and the website Host Assistant both call it; neither restates a figure.
 *
 * Pure: no reads here. `lib/mcp/readers.ts` loads the catalog.
 */

import type { PricingItem } from '@/components/QuoteBuilder/types'
import type { PricingCatalog } from '@/lib/pricingCatalog'
import { BOOKING_DEPOSIT_CENTS, MAJOR_BOOKING_DEPOSIT_RATE, MAJOR_BOOKING_THRESHOLD_CENTS } from '@/lib/partyPricing'
import {
  MAX_PREMIUM_ACTIVITIES, MAX_STANDARD_ACTIVITIES, PREMIUM_EXTRA_CENTS, PREMIUM_UPGRADE_FLAT_CENTS, STANDARD_EXTRA_CENTS,
  THEME_PREMIUM_INCLUDED_THRESHOLD,
} from '@/lib/quoteEngine'
import { listThemes, type LoadedCatalog } from '@/lib/quoteRequest'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { usd } from '@/lib/partyCostFaq'

/**
 * What every classic studio party includes. The one copy: `/llms.txt` prints
 * this list and the AI tools serve it, so the two cannot disagree.
 */
export const STUDIO_PARTY_INCLUDES = [
  'a dedicated host',
  'full themed decor and setup',
  'the theme activities',
  'pizza or bagels',
  'cupcakes',
  'juice and water',
  'a treat cart',
  'a Host Hampton EVITE',
  'full cleanup',
] as const

/** STUDIO_PARTY_INCLUDES as one sentence fragment: "a, b, … and z". */
export function includesSentence(): string {
  const l = [...STUDIO_PARTY_INCLUDES]
  return `${l.slice(0, -1).join(', ')}, and ${l[l.length - 1]}`
}

export interface MenuItem {
  /** Pass this to get_quote as an add-on or activity. */
  name: string
  price: string
  /** True when the price is per child (multiplied by the guest count). */
  per_child: boolean
  about: string | null
}

function menuItem(i: PricingItem): MenuItem {
  const perChild = i.price_type === 'per_person'
  return {
    name: i.name,
    price: perChild ? `${usd(i.price_cents)} per child` : i.price_label || (i.price_cents > 0 ? usd(i.price_cents) : 'Included'),
    per_child: perChild,
    about: (i.description ?? '').replace(/\s+/g, ' ').trim() || null,
  }
}

/**
 * The mobile answer while the mobile grid is unbuilt: a starting figure if the
 * `mobile_quote_from` row is active, otherwise no figure at all. Never a total.
 */
export function mobileAnchor(cat: Pick<PricingCatalog, 'mobileQuoteFrom' | 'mobilePolicy'>) {
  const f = cat.mobileQuoteFrom
  const from = f ? `start at ${usd(f.cents)} for ${f.kids} kids and ` : ''
  return {
    ...(f ? { starts_at: usd(f.cents), for_kids: f.kids } : {}),
    how_it_is_priced:
      `Mobile parties (we come to the family's home, backyard, park or venue) ${from}are quoted individually from the guest count, the stations and the location, usually within 24 hours. ` +
      `Travel is free within ${cat.mobilePolicy.freeTravelMiles} miles of the studio. What we quote is what you pay; no mandatory gratuity.`,
    get_a_quote: `${CANONICAL_ORIGIN}/mobile-party`,
    rule_for_assistants: f
      ? `Do not total a mobile party. Say it starts at ${usd(f.cents)} for ${f.kids} kids and is quoted individually, then offer the quote form link or to send an inquiry.`
      : 'Do not state any dollar figure for a mobile party. Say it is quoted individually, then offer the quote form link or to send an inquiry.',
  }
}

export function buildPartyMenu(loaded: LoadedCatalog) {
  const { cat, groups } = loaded
  const g = cat.guestRules
  const themes = listThemes(loaded)
  return {
    studio_party: {
      length: '2 hours of private studio time',
      kids_included: `${g.includedGuests} kids plus the birthday child`,
      extra_child: usd(g.extraGuestCents),
      mini_party: `${usd(g.miniPartyDiscountCents)} off the classic price, 1.5 hours, up to ${g.miniPartyMaxGuests} kids`,
      deposit: `${usd(BOOKING_DEPOSIT_CENTS)} holds the date and comes off the total (${Math.round(MAJOR_BOOKING_DEPOSIT_RATE * 100)}% for a party of ${usd(MAJOR_BOOKING_THRESHOLD_CENTS)} or more)`,
      every_party_includes: [...STUDIO_PARTY_INCLUDES],
    },
    themes: themes.map(t => ({ name: t.name, price: usd(t.price_cents), about: t.about })),
    activities: {
      rules: [
        `Pick up to ${MAX_PREMIUM_ACTIVITIES} premium and up to ${MAX_STANDARD_ACTIVITIES} standard activities.`,
        `Themes at ${usd(THEME_PREMIUM_INCLUDED_THRESHOLD)} or more include 1 premium activity; on a lower-priced theme the first premium is a flat ${usd(PREMIUM_UPGRADE_FLAT_CENTS)} upgrade.`,
        `A 2nd premium activity is ${usd(PREMIUM_EXTRA_CENTS)} per child (birthday child included).`,
        `The first 2 standard activities are included; a 3rd is ${usd(STANDARD_EXTRA_CENTS)} per child (birthday child included).`,
        'Use get_quote for the exact figure; it applies these rules.',
      ],
      premium: groups.premiumActivities.map(a => a.name),
      standard: groups.standardActivities.map(a => a.name),
    },
    add_ons: {
      food: groups.food.map(menuItem),
      desserts: groups.desserts.map(menuItem),
      drinks: groups.beverages.map(menuItem),
      decor: groups.decor.map(menuItem),
      entertainment: groups.entertainment.map(menuItem),
      party_extras: groups.partyAddOns.map(menuItem),
    },
    mobile_parties: mobileAnchor(cat),
    links: {
      full_menu: `${CANONICAL_ORIGIN}/party-menu`,
      plan_and_book: `${CANONICAL_ORIGIN}/party-builder`,
    },
    note: 'Every price here is the live price list. Pass these exact names to get_quote for a total.',
  }
}

export type PartyMenu = ReturnType<typeof buildPartyMenu>
