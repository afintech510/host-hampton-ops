import type { Metadata } from 'next'
import { getSupabase } from '@/lib/supabase'
import StudioRentalContent from './StudioRentalContent'
import type { PricingItem } from '@/components/QuoteBuilder/types'

export const metadata: Metadata = {
  title: 'Rent the Studio — Host Hampton | Speonk, NY',
  description:
    'Reserve our private Hamptons studio for your baby shower, first birthday, or holiday party. Seats up to 65 (85 standing). Pick your date, build your add-ons, sign, and reserve with a 25% deposit — all online.',
  openGraph: {
    title: 'Rent the Studio — Host Hampton',
    description: 'Pick your date, build your add-ons, sign, and reserve in one place.',
  },
}

export const dynamic = 'force-dynamic'

export default async function StudioRentalPage() {
  let items: PricingItem[] = []
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('pricing_items')
      .select('id, name, description, category, price_cents, price_label, price_type, is_popular, sort_order, emoji')
      .eq('is_active', true)
      .contains('event_types', ['studio-rental'])
      .order('sort_order', { ascending: true })
    items = data ?? []
  } catch {
    // page still renders without the menu
  }

  const byCategory = (cat: string) => items.filter(i => i.category === cat)

  return (
    <StudioRentalContent
      decor={byCategory('decor-add-on')}
      services={byCategory('service-add-on')}
      food={byCategory('food-add-on')}
      desserts={byCategory('dessert-add-on')}
      beverages={byCategory('beverage-add-on')}
    />
  )
}
