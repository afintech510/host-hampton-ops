import { getSupabase } from '@/lib/supabase'
import { applyLinkedPrices } from '@/lib/themePricing'
import { BOOKING_DEPOSIT_CENTS } from '@/lib/partyPricing'
import type { PricingCatalog } from '@/lib/pricingCatalog'
import type { CraftFaq, CraftParty } from '@/lib/craftParties'

/**
 * "How much does a ___ party cost?" — the first question a parent asks an
 * answer engine, and before 2026-10-07 only one of eleven craft pages answered
 * it. That one answered it with a TYPED figure ("studio packages start at
 * $750") that had been wrong since the studio floor moved to $850, and it sat
 * in FAQPage schema, which is exactly what ChatGPT and Perplexity quote.
 *
 * So the answer is BUILT, at render time, from the same rows checkout charges
 * from: theme prices via `applyLinkedPrices` (migration 062) and the guest
 * rules / studio rates via `loadPricingCatalog`. It cannot drift.
 *
 * No mobile figure, ever: this text becomes FAQPage structured data and plan
 * §15 keeps mobile prices out of schema. The at-home half points at the
 * pricing shown on the page instead.
 */

export interface StudioTheme {
  name: string
  slug: string
  price_cents: number
  description: string | null
  pricing_item_id: string | null
}

/** Active studio themes at their charged price. Empty on any failure. */
export async function loadStudioThemes(): Promise<StudioTheme[]> {
  try {
    const { data, error } = await getSupabase()
      .from('party_themes')
      .select('name, slug, price_cents, pricing_item_id, description')
      .eq('is_active', true)
      .order('sort_order')
    if (error) {
      console.error('loadStudioThemes: party_themes read failed —', error.message)
      return []
    }
    const priced = await applyLinkedPrices((data ?? []) as StudioTheme[])
    return priced.filter(t => Number(t.price_cents) > 0)
  } catch (err) {
    console.error('loadStudioThemes: party_themes read threw —', err)
    return []
  }
}

export function usd(cents: number): string {
  const d = cents / 100
  return d % 1 === 0 ? `$${d.toLocaleString('en-US')}` : `$${d.toFixed(2)}`
}

const COST_Q = /\b(cost|price|how much)\b/i

/** True for a FAQ entry that asks what something costs. */
export function isCostQuestion(f: CraftFaq): boolean {
  return COST_Q.test(f.q)
}

/**
 * The cost answer for one craft page, or null when there is nothing true to
 * say (a mobile-only activation is custom-quoted; no themes read = no figure).
 */
export function buildCostFaq(
  party: CraftParty,
  themes: StudioTheme[],
  catalog: Pick<PricingCatalog, 'guestRules' | 'studioRates'>,
): CraftFaq | null {
  const g = catalog.guestRules
  const s = catalog.studioRates
  const deposit = usd(BOOKING_DEPOSIT_CENTS)
  const lower = party.name.toLowerCase()
  const q = `How much does a ${lower} cost?`

  if (party.venue === 'mobile') return null

  if (party.venue === 'studio') {
    return {
      q: `How much does it cost to rent the studio for a ${lower.replace(/ venue$/, '')}?`,
      a:
        `A 3-hour private studio rental is ${usd(s.weekdayBaseCents)} on a weekday or ${usd(s.weekendBaseCents)} ` +
        `on a weekend (Saturday and Sunday). Full-day rentals are ${usd(s.weekdayFullDayCents)} weekday and ` +
        `${usd(s.weekendFullDayCents)} weekend, and extra hours are ${usd(s.weekdayAddlHourCents)} weekday / ` +
        `${usd(s.weekendAddlHourCents)} weekend. A ${deposit} payment reserves the date and comes off the total; ` +
        `a separate ${usd(s.securityDepositCents)} refundable card hold (not a charge) is placed before the event. ` +
        `Bring your own decor and catering, ` +
        `or add ours.`,
    }
  }

  if (!themes.length) return null
  const included =
    `${g.includedGuests} kids plus the birthday child, with a dedicated host, themed decor and setup, ` +
    `the activities, pizza, cupcakes, drinks and full cleanup`
  const extras =
    `Extra kids are ${usd(g.extraGuestCents)} each, a Mini Party (1.5 hours, smaller group) is ` +
    `${usd(g.miniPartyDiscountCents)} less, and a flat ${deposit} deposit holds the date.`
  const atHome =
    'We can also bring it to your home; at-home pricing is shown on this page, travel is free within 20 miles ' +
    'of Speonk, and there is never a mandatory gratuity.'

  const theme = themes.find(t => t.slug === party.slug)
  if (theme) {
    return {
      q,
      a: `At our private studio in Speonk, a ${theme.name} is ${usd(theme.price_cents)} for 2 hours with ${included}. ${extras} ${atHome}`,
    }
  }

  const prices = themes.map(t => t.price_cents)
  const lo = Math.min(...prices)
  const hi = Math.max(...prices)
  const range = lo === hi ? usd(lo) : `${usd(lo)}–${usd(hi)}`
  return {
    q,
    a: `Private studio parties in Speonk are ${range} for 2 hours, depending on the theme, with ${included}. ${extras} ${atHome}`,
  }
}

/**
 * The page's FAQs with the built cost answer first. A typed cost question in
 * the data is REPLACED, never kept beside it — two answers to one question is
 * the contradiction this module exists to end.
 */
export function withCostFaq(faqs: CraftFaq[], cost: CraftFaq | null): CraftFaq[] {
  if (!cost) return faqs
  return [cost, ...faqs.filter(f => !isCostQuestion(f))]
}
