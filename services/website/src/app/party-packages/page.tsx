import type { Metadata } from 'next'
import { getSupabase } from '@/lib/supabase'
import PartyPackagesContent from './PartyPackagesContent'

export const metadata: Metadata = {
  title: 'Party Packages & Pricing | Host Hampton',
  description: 'View all themed birthday party packages at Host Hampton. Glow, Swiftie, Spa, Slime, K-Pop, Barbie and more. Starting at $800. Book your party today!',
}

export const dynamic = 'force-dynamic'

export interface PricingItem {
  id: string
  name: string
  description: string | null
  category: string
  price_cents: number
  price_label: string | null
  is_popular: boolean
  sort_order: number
}

export default async function PartyPackages() {
  let pricingItems: PricingItem[] = []
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('pricing_items')
      .select('id, name, description, category, price_cents, price_label, is_popular, sort_order')
      .eq('is_active', true)
      .or('event_types.cs.{kids-party},event_types.is.null')
      .order('sort_order', { ascending: true })
    pricingItems = data || []
  } catch {
    // Page still renders without pricing data
  }

  return <PartyPackagesContent pricingItems={pricingItems} />
}
