import type { Metadata } from 'next'
import { getSupabase } from '@/lib/supabase'
import PartyPackagesContent from './PartyPackagesContent'

export const metadata: Metadata = {
  title: 'Kids Party Packages & Pricing — Long Island',
  description: 'Themed kids birthday party packages on Long Island — at our Hamptons studio in Speonk or mobile at your house. Glow, Swiftie, Spa, Slime, K-Pop, Barbie and more, starting at $800.',
}

export const dynamic = 'force-dynamic'

export interface PricingItem {
  id: string
  name: string
  description: string | null
  category: string
  price_cents: number
  price_label: string | null
  price_type: 'flat' | 'per_person' | 'per_hour'
  is_popular: boolean
  sort_order: number
}

export default async function PartyPackages() {
  let pricingItems: PricingItem[] = []
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('pricing_items')
      .select('id, name, description, category, price_cents, price_label, price_type, is_popular, sort_order')
      .eq('is_active', true)
      .or('event_types.cs.{kids-party},event_types.is.null')
      .order('sort_order', { ascending: true })
    pricingItems = data || []
  } catch {
    // Page still renders without pricing data
  }

  return <PartyPackagesContent pricingItems={pricingItems} />
}
