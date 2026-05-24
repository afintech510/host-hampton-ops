import type { Metadata } from 'next'
import { getSupabase } from '@/lib/supabase'
import PartyBuilderContent from './PartyBuilderContent'
import type { PricingItem } from '@/components/QuoteBuilder/types'

export const metadata: Metadata = {
  title: "Host Hampton Party Plan — Speonk NY",
  description:
    'Your custom Host Hampton Party Plan — review details, add options, pick a date, and pay 25% down to reserve.',
  openGraph: {
    title: "Host Hampton Party Plan",
    description: 'Review, customize, and reserve your party in one place.',
  },
}

export const dynamic = 'force-dynamic'

export default async function PartyBuilderPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; session_id?: string }
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
      checkoutStatus={searchParams.status ?? null}
      checkoutSessionId={searchParams.session_id ?? null}
    />
  )
}
