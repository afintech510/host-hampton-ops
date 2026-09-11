import type { Metadata } from 'next'
import { getSupabase } from '@/lib/supabase'
import KidsPartyMenuContent from './KidsPartyMenuContent'
import { loadPricingCatalog } from '@/lib/pricingCatalog'
import type { PricingItem } from '@/components/QuoteBuilder/types'

export const metadata: Metadata = {
  title: "Kids Party Menu & Quote Builder — Long Island",
  description:
    'Browse our full kids party menu — themes, activities, food, desserts, decor, entertainment and more. Select items to build your custom quote instantly.',
  openGraph: {
    title: "Kids Party Menu & Quote Builder",
    description: 'Browse our full kids party menu. Select items, see your total in real time, and save your quote.',
  },
}

export const dynamic = 'force-dynamic'

export default async function KidsPartyMenuPage({
  searchParams,
}: {
  searchParams: { q?: string }
}) {
  let items: PricingItem[] = []
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('pricing_items')
      .select('id, name, description, category, price_cents, price_label, price_type, is_popular, sort_order, emoji')
      .eq('is_active', true)
      .or('event_types.cs.{kids-party},event_types.is.null')
      .order('sort_order', { ascending: true })
    items = data ?? []
  } catch {
    // page still renders
  }

  const byCategory = (cat: string) => items.filter(i => i.category === cat)

  // Guest rules + the DIY studio rate card (migration 036).
  const catalog = await loadPricingCatalog()

  return (
    <KidsPartyMenuContent
      themes={byCategory('party-theme')}
      premiumActivities={byCategory('activity-premium')}
      standardActivities={byCategory('activity-standard')}
      food={byCategory('food-add-on')}
      desserts={byCategory('dessert-add-on')}
      beverages={byCategory('beverage-add-on')}
      decor={byCategory('decor-add-on')}
      entertainment={byCategory('entertainment-add-on')}
      partyAddOns={byCategory('party-add-on')}
      catalog={catalog}
      savedQuote={searchParams.q ?? null}
    />
  )
}
