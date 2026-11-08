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
import { buildPlanSnapshot } from '@/lib/plan'
import type { BookingLineItem } from '@/types/booking-flow'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import {
  buildQuoteItems, computeQuote, MAX_PREMIUM_ACTIVITIES, MAX_STANDARD_ACTIVITIES, type Quote, type QuoteItems, type QuoteLineItem, type QuoteSelection,
} from '@/lib/quoteEngine'
import type { PricingItem } from '@/components/QuoteBuilder/types'

type Supa = ReturnType<typeof getSupabase>

export const MAX_QUOTE_GUESTS = 50

export interface QuoteGroups {
  themes: PricingItem[]; premiumActivities: PricingItem[]; standardActivities: PricingItem[]; food: PricingItem[]; desserts: PricingItem[]
  beverages: PricingItem[]; decor: PricingItem[]; entertainment: PricingItem[]; partyAddOns: PricingItem[]
}

/**
 * A theme's website face: the `party_themes` row (name, slug, copy) linked to the
 * `pricing_items` row the planner charges. The two names can differ ("Sweets &
 * Treats" on the site, "Sweets-n-Treats Party" on the price list), and before
 * 2026-11-07 the theme list handed ChatGPT one and the quote refused it.
 */
export interface ThemeInfo { pricing_item_id: string | null; name: string; slug: string; description: string | null }

export interface LoadedCatalog {
  cat: PricingCatalog; groups: QuoteGroups; items: QuoteItems
  /** The website names and slugs for the priced themes; empty when unreadable (themes still match by price-list name). */
  themeInfo?: ThemeInfo[]
}

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
  const info = await sb.from('party_themes').select('pricing_item_id, name, slug, description').eq('is_active', true).order('sort_order', { ascending: true })
  if (info.error) console.error('loadQuoteCatalog: party_themes unreadable, matching themes by price-list name only —', info.error.message)
  return {
    kind: 'ok',
    data: { cat: await loadPricingCatalog(), groups, items: buildQuoteItems(groups), themeInfo: (info.data ?? []) as ThemeInfo[] },
  }
}

/** Every name a theme answers to: its price-list name, its website name and its slug. */
export function themeAliases(loaded: Pick<LoadedCatalog, 'themeInfo'>, theme: PricingItem): string[] {
  const linked = (loaded.themeInfo ?? []).filter(t => t.pricing_item_id === theme.id)
  return [theme.name, ...linked.map(t => t.name), ...linked.map(t => t.slug)]
}

/**
 * Exact (normalised) match on ANY alias first, so the website's own name for a
 * theme always prices; then the ordinary `matchByName` on price-list names.
 */
export function matchTheme(loaded: Pick<LoadedCatalog, 'groups' | 'themeInfo'>, wanted: string): NameMatch {
  const w = norm(wanted)
  if (!w) return { kind: 'none' }
  const hits = loaded.groups.themes.filter(t => themeAliases(loaded, t).some(a => norm(a) === w))
  if (hits.length === 1) return { kind: 'one', item: hits[0] }
  if (hits.length > 1) return { kind: 'ambiguous', names: hits.map(h => h.name) }
  return matchByName(loaded.groups.themes, wanted)
}

/** One studio theme as every AI surface lists it. `name` is accepted by the quote as-is. */
export interface ThemeListing { name: string; price_list_name: string; slug: string | null; price_cents: number; about: string | null }

/**
 * The priced themes, named the way the website names them. Built from the SAME
 * rows the quote matches, so a listed name always prices. Every active theme on
 * the price list is listed — including ones with no marketing page (Adam,
 * 2026-11-07: Custom, Trucker Hat, Unicorn and Race Car are offered).
 */
export function listThemes(loaded: Pick<LoadedCatalog, 'groups' | 'themeInfo'>): ThemeListing[] {
  return loaded.groups.themes.map(t => {
    const face = (loaded.themeInfo ?? []).find(i => i.pricing_item_id === t.id)
    return {
      name: face?.name ?? t.name,
      price_list_name: t.name,
      slug: face?.slug ?? null,
      price_cents: t.price_cents,
      about: (face?.description ?? t.description ?? null)?.replace(/\s+/g, ' ').trim() || null,
    }
  })
}

const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()

export type NameMatch = { kind: 'one'; item: PricingItem } | { kind: 'none' } | { kind: 'ambiguous'; names: string[] }

const FILLER = new Set(['party', 'parties', 'making', 'station', 'package', 'the', 'a', 'an', 'make', 'your', 'own', 'my', 'bar', 'session'])
const tokens = (s: string) => norm(s).split(' ').filter(Boolean)

/**
 * Exact match on the normalised name; then on the name with filler words
 * stripped; then, as a last resort, WHOLE-WORD containment: every meaningful
 * word asked for appears as a whole word in exactly one item's name ("slime" →
 * "Make Your Own Slime", "tattoos" → "Glitter Tattoos"). One hit is a match;
 * several is `ambiguous` ("hair" names two items) and is never picked between.
 * No edit distance, no substrings, no guessing.
 */
export function matchByName(list: PricingItem[], wanted: string): NameMatch {
  const w = norm(wanted)
  if (!w) return { kind: 'none' }
  const strip = (s: string) => norm(s).replace(/\b(party|parties|making|station|package)\b/g, ' ').replace(/\s+/g, ' ').trim()
  for (const f of [(i: PricingItem) => norm(i.name) === w, (i: PricingItem) => strip(i.name) !== '' && strip(i.name) === strip(wanted)]) {
    const hits = list.filter(f)
    if (hits.length === 1) return { kind: 'one', item: hits[0] }
    if (hits.length > 1) return { kind: 'ambiguous', names: hits.map(h => h.name) }
  }
  const want = tokens(wanted).filter(t => !FILLER.has(t))
  if (want.length === 0) return { kind: 'none' }
  const hits = list.filter(i => { const have = new Set(tokens(i.name)); return want.every(t => have.has(t)) })
  if (hits.length === 1) return { kind: 'one', item: hits[0] }
  if (hits.length > 1) return { kind: 'ambiguous', names: hits.map(h => h.name) }
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
      /** Activities past the planner's limits (2 premium, 3 standard) — dropped, NOT priced. */
      overLimit: string[]
      /** Mobile totals do not include travel: it is priced from the address when the party is booked. */
      travelNotIncluded: boolean
      plannerUrl: string
    }
  | { ok: false; error: string }

/** The planner's own total and deposit for these items — the arithmetic `/api/party-builder/save` will run. */
export function plannerTotals(lineItems: QuoteLineItem[], guests: number): { totalCents: number; depositCents: number } {
  const snap = buildPlanSnapshot({ lineItems: lineItems as unknown as BookingLineItem[], guestCount: guests })
  return { totalCents: snap.totalCents, depositCents: snap.depositCents }
}

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
    const m = matchTheme(loaded, wanted)
    if (m.kind === 'one') themeItem = m.item
    else if (m.kind === 'ambiguous') ambiguous.push({ asked: wanted, options: m.names })
    else unmatched.push(wanted)
  }

  const activityIds: string[] = []
  const activityNames: string[] = []
  const overLimit: string[] = []
  const premiumIds = new Set(groups.premiumActivities.map(a => a.id))
  for (const a of WORDS(raw.activities, 8)) {
    const it = resolve(a, [...groups.premiumActivities, ...groups.standardActivities])
    if (!it || activityIds.includes(it.id)) continue
    // The planner will not let a parent pick more than this; a quote must not price what cannot be booked.
    if (raw.partyType === 'studio') {
      const isPremium = premiumIds.has(it.id)
      const already = activityIds.filter(id => premiumIds.has(id) === isPremium).length
      if (already >= (isPremium ? MAX_PREMIUM_ACTIVITIES : MAX_STANDARD_ACTIVITIES)) { overLimit.push(it.name); continue }
    }
    activityIds.push(it.id); activityNames.push(it.name)
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
    const amb = ambiguous.find(x => x.asked === String(raw.theme).trim().slice(0, 80))
    return { ok: false, error: amb ? `"${raw.theme}" matches more than one theme: ${amb.options.join(', ')}.` : `No theme named "${raw.theme}". Use list_party_themes for the names.` }
  }

  const quote = computeQuote(cat, items, sel)
  return {
    ok: true, quote, theme: themeItem?.name ?? null, activities: activityNames, addOns: addOnNames, unmatched, ambiguous, overLimit,
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
