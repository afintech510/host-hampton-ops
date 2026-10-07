import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase'

/**
 * ONE price per party theme (migration 062).
 *
 * `party_themes` holds a theme's name, copy and images; the `pricing_items` row
 * it links to (`pricing_item_id`) holds its PRICE — the same row the party
 * planner and /party-packages charge from. Before this, the two tables carried
 * separate prices and drifted ($900 vs $950 for Slime on 2026-10-04, read by
 * ChatGPT as the site contradicting itself).
 *
 * Every reader of a theme's price goes through `withEffectivePrices`. A theme
 * with no link (Sleep Under, today), or whose linked row is inactive or priced
 * at zero, falls back to its own `price_cents` — never to nothing.
 */

type Supa = SupabaseClient

export interface LinkedThemeRow {
  price_cents: number
  pricing_item_id?: string | null
}

interface PriceRow {
  id: string
  price_cents: number
  is_active: boolean
}

/** Pure: replace each theme's `price_cents` with its linked row's, where usable. */
export function withEffectivePrices<T extends LinkedThemeRow>(themes: T[], items: PriceRow[]): T[] {
  const byId = new Map(items.map(i => [i.id, i]))
  return themes.map(t => {
    const item = t.pricing_item_id ? byId.get(t.pricing_item_id) : undefined
    if (item && item.is_active && Number(item.price_cents) > 0) {
      return { ...t, price_cents: Number(item.price_cents) }
    }
    return t
  })
}

/**
 * Read the linked prices for a set of themes. On a failed read the themes come
 * back with their own (mirrored) prices and the failure is logged — a marketing
 * page must still render, and the mirror is kept equal by the admin write path.
 */
export async function applyLinkedPrices<T extends LinkedThemeRow>(themes: T[], supabase?: Supa): Promise<T[]> {
  const ids = Array.from(new Set(themes.map(t => t.pricing_item_id).filter((x): x is string => !!x)))
  if (!ids.length) return themes
  try {
    const { data, error } = await (supabase ?? getSupabase())
      .from('pricing_items')
      .select('id, price_cents, is_active')
      .in('id', ids)
    if (error) {
      console.error('themePricing: linked price read failed, using theme mirror —', error.message)
      return themes
    }
    return withEffectivePrices(themes, (data ?? []) as PriceRow[])
  } catch (err) {
    console.error('themePricing: linked price read threw, using theme mirror —', err)
    return themes
  }
}
