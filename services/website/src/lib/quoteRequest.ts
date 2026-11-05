/**
 * Quote a party from a plain-language request — for callers that are not the
 * planner UI: the MCP `get_quote` tool, the website Host Assistant, the admin
 * overlay. The arithmetic is `lib/quoteEngine.ts` and nothing else; this file
 * only turns NAMES ("Glow Party", "slime making") into the catalog items the
 * engine prices, and refuses to guess.
 *
 *   - a name that matches no catalog item is reported in `unmatched`, never
 *     approximated to the nearest one;
 *   - a name that matches more than one item is `ambiguous`, never picked;
 *   - the model never supplies a price, only words and a guest count.
 */

import type { getSupabase } from '@/lib/supabase'
import { loadPricingCatalog, type PricingCatalog } from '@/lib/pricingCatalog'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { buildQuoteItems, computeQuote, type Quote, type QuoteItems, type QuoteSelection } from '@/lib/quoteEngine'
import type { PricingItem } from '@/components/QuoteBuilder/types'

type Supa = ReturnType<typeof getSupabase>

export const MAX_QUOTE_GUESTS = 50

export interface QuoteGroups {
  themes: PricingItem[]; premiumActivities: PricingItem[]; standardActivities: PricingItem[]; food: PricingItem[]; desserts: PricingItem[]
  beverages: PricingItem[]; decor: PricingItem[]; entertainment: PricingItem[]; partyAddOns: PricingItem[]
}

export interface LoadedCatalog { cat: PricingCatalog; groups: QuoteGroups; items: QuoteItems }

/** The same rows the planner's server page reads (`app/party-builder/page.tsx`). */
export async function loadQuoteCatalog(sb: Supa): Promise<{ kind: 'ok'; data: LoadedCatalog } | { kind: 'unavailable'; error: string }> {
  const { data, error } = await sb
    .from('pricing_items')
    .select('id, name, description, category, price_cents, price_label, price_type, is_popular, sort_order, emoji')
    .eq('is_active', true)
    .or('event_types.cs.{kids-party},event_types.is.null')
    .order('sort_order', { ascending: true })
  if (error) return { kind: 'unavailable', error: error.message }
  const rows = (data ?? []) as PricingItem[]
  if (rows.length === 0) return { kind: 'unavailable', error: 'pricing_items is empty' }
  const by = (c: string) => rows.filter(i => i.category === c)
  const groups: QuoteGroups = {
    themes: by('party-theme'), premiumActivities: by('activity-premium'), standardActivities: by('activity-standard'), food: by('food-add-on'),
    desserts: by('dessert-add-on'), beverages: by('beverage-add-on'), decor: by('decor-add-on'), entertainment: by('entertainment-add-on'),
    partyAddOns: by('party-add-on'),
  }
  return { kind: 'ok', data: { cat: await loadPricingCatalog(), groups, items: buildQuoteItems(groups) } }
}

const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()

export type NameMatch = { kind: 'one'; item: PricingItem } | { kind: 'none' } | { kind: 'ambiguous'; names: string[] }

/** Exact match on the normalised name, then on the name with "party"/"making" noise stripped. Never fuzzy. */
export function matchByName(list: PricingItem[], wanted: string): NameMatch {
  const w = norm(wanted)
  if (!w) return { kind: 'none' }
  const strip = (s: string) => norm(s).replace(/\b(party|parties|making|station|package)\b/g, ' ').replace(/\s+/g, ' ').trim()
  for (const f of [(i: PricingItem) => norm(i.name) === w, (i: PricingItem) => strip(i.name) !== '' && strip(i.name) === strip(wanted)]) {
    const hits = list.filter(f)
    if (hits.length === 1) return { kind: 'one', item: hits[0] }
    if (hits.length > 1) return { kind: 'ambiguous', names: hits.map(h => h.name) }
  }
  return { kind: 'none' }
}

export interface QuoteRequest {
  partyType: 'studio' | 'mobile'
  guests: number
  theme?: string
  activities?: string[]
  mini?: boolean
  addOns?: string[]
}

export type QuoteAnswer =
  | {
      ok: true
      quote: Quote
      theme: string | null
      activities: string[]
      addOns: string[]
      unmatched: string[]
      ambiguous: { asked: string; options: string[] }[]
      /** Mobile totals do not include travel: it is priced from the address when the party is booked. */
      travelNotIncluded: boolean
      plannerUrl: string
    }
  | { ok: false; error: string }

const WORDS = (v: unknown, max: number): string[] => (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string').map(x => x.trim().slice(0, 80)).filter(Boolean).slice(0, max)

export function quoteFromCatalog(loaded: LoadedCatalog, raw: QuoteRequest): QuoteAnswer {
  const guests = Math.floor(Number(raw.guests))
  if (!Number.isFinite(guests) || guests < 1 || guests > MAX_QUOTE_GUESTS) return { ok: false, error: `guests must be a whole number from 1 to ${MAX_QUOTE_GUESTS}.` }
  if (raw.partyType !== 'studio' && raw.partyType !== 'mobile') return { ok: false, error: 'party_type must be "studio" or "mobile".' }
  const { groups, items, cat } = loaded
  const unmatched: string[] = []
  const ambiguous: { asked: string; options: string[] }[] = []

  const resolve = (asked: string, list: PricingItem[]): PricingItem | null => {
    const m = matchByName(list, asked)
    if (m.kind === 'one') return m.item
    if (m.kind === 'ambiguous') ambiguous.push({ asked, options: m.names })
    else unmatched.push(asked)
    return null
  }

  let themeItem: PricingItem | null = null
  if (raw.partyType === 'studio') {
    const wanted = typeof raw.theme === 'string' ? raw.theme.trim().slice(0, 80) : ''
    if (!wanted) return { ok: false, error: 'A studio quote needs a theme. Use list_party_themes for the names.' }
    themeItem = resolve(wanted, groups.themes)
  }

  const activityIds: string[] = []
  const activityNames: string[] = []
  for (const a of WORDS(raw.activities, 8)) {
    const it = resolve(a, [...groups.premiumActivities, ...groups.standardActivities])
    if (it && !activityIds.includes(it.id)) { activityIds.push(it.id); activityNames.push(it.name) }
  }

  const sel: QuoteSelection = {
    locationType: raw.partyType, guestCount: guests, isMiniParty: raw.partyType === 'studio' && !!raw.mini, themeId: themeItem?.id ?? null,
    activityIds, foodIds: [], dessertIds: [], beverageIds: [], decorIds: [], entertainmentIds: [], partyAddOnIds: [],
  }
  const addOnNames: string[] = []
  const slots: [PricingItem[], string[]][] = [
    [groups.food, sel.foodIds], [groups.desserts, sel.dessertIds], [groups.beverages, sel.beverageIds], [groups.decor, sel.decorIds],
    [groups.entertainment, sel.entertainmentIds], [groups.partyAddOns, sel.partyAddOnIds],
  ]
  for (const a of WORDS(raw.addOns, 10)) {
    let found: PricingItem | null = null
    let amb: string[] | null = null
    for (const [list, target] of slots) {
      const m = matchByName(list, a)
      if (m.kind === 'one') { found = m.item; target.push(m.item.id); break }
      if (m.kind === 'ambiguous') amb = m.names
    }
    if (found) addOnNames.push(found.name)
    else if (amb) ambiguous.push({ asked: a, options: amb })
    else unmatched.push(a)
  }

  if (raw.partyType === 'studio' && !themeItem) {
    return { ok: false, error: ambiguous.some(x => x.asked === raw.theme) ? `"${raw.theme}" matches more than one theme: ${ambiguous[0].options.join(', ')}.` : `No theme named "${raw.theme}". Use list_party_themes for the names.` }
  }

  const quote = computeQuote(cat, items, sel)
  return {
    ok: true, quote, theme: themeItem?.name ?? null, activities: activityNames, addOns: addOnNames, unmatched, ambiguous,
    travelNotIncluded: raw.partyType === 'mobile', plannerUrl: quoteToPlannerUrl(sel, themeItem?.name ?? null),
  }
}

/**
 * A planner link that opens `/party-builder` already filled in. `q` is the
 * planner's own `QuoteData`, base64url JSON (what `parseQuoteParam` reads),
 * written ASCII-only because the browser decodes it with `atob`.
 */
export function quoteToPlannerUrl(sel: QuoteSelection, themeName: string | null): string {
  if (sel.locationType === 'mobile') return `${CANONICAL_ORIGIN}/party-builder`
  const data = {
    theme: sel.themeId, themeName, guestCount: sel.guestCount, foodChoice: null, cupcakeFlavor: null, activities: sel.activityIds,
    food: sel.foodIds, desserts: sel.dessertIds, decor: sel.decorIds, entertainment: sel.entertainmentIds, beverages: sel.beverageIds,
    extras: sel.partyAddOnIds, contactName: '', contactEmail: '', contactPhone: '', isMiniParty: sel.isMiniParty,
  }
  const json = JSON.stringify(data).replace(/[\u0080-￿]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  return `${CANONICAL_ORIGIN}/party-builder?q=${Buffer.from(json, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}
