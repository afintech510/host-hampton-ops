import type { Metadata } from 'next'
import { getSupabase } from '@/lib/supabase'
import PartyBuilderContent from './PartyBuilderContent'
import type { PricingItem } from '@/components/QuoteBuilder/types'

export const metadata: Metadata = {
  title: "Kids Party Builder — Host Hampton, Speonk NY",
  description:
    'Build your custom kids party — choose a theme, add activities, food, decor & more. See pricing in real time, pick your date, and book with a $99 deposit.',
  openGraph: {
    title: "Kids Party Builder — Host Hampton",
    description: 'Build your custom party, pick a date, and book instantly with a $99 deposit.',
  },
}

export const dynamic = 'force-dynamic'

export default async function PartyBuilderPage({
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

  return (
    <PartyBuilderContent
      themes={byCategory('party-theme')}
      premiumActivities={byCategory('activity-premium')}
      standardActivities={byCategory('activity-standard')}
      food={byCategory('food-add-on')}
      desserts={byCategory('dessert-add-on')}
      beverages={byCategory('beverage-add-on')}
      decor={byCategory('decor-add-on')}
      entertainment={byCategory('entertainment-add-on')}
      partyAddOns={byCategory('party-add-on')}
      savedQuote={searchParams.q ?? null}
    />
  )
}
