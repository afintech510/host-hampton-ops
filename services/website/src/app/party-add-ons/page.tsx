import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'

export const metadata: Metadata = {
  title: 'Party Add-Ons | Host Hampton',
  description: 'Customize your Host Hampton party with premium add-ons — balloon arches, character visits, photographers, custom cakes, and more. Available for all party packages.',
}

export const dynamic = 'force-dynamic'

const categoryConfig = [
  { category: 'decor-add-on', label: 'Decor Upgrades' },
  { category: 'entertainment-add-on', label: 'Entertainment' },
  { category: 'food-add-on', label: 'Food & Catering' },
  { category: 'dessert-add-on', label: 'Desserts' },
  { category: 'beverage-add-on', label: 'Beverages' },
  { category: 'party-add-on', label: 'Favors & Extras' },
  { category: 'service-add-on', label: 'Services' },
]

function formatPrice(cents: number, label?: string | null): string {
  if (label) return label
  if (cents === 0) return 'Included'
  const dollars = cents / 100
  return dollars % 1 === 0 ? `$${dollars.toLocaleString()}` : `$${dollars.toFixed(2)}`
}

interface PricingRow {
  name: string
  description: string | null
  category: string
  price_cents: number
  price_label: string | null
  sort_order: number
}

export default async function PartyAddOns() {
  redirect('/kids-party-menu')
  let items: PricingRow[] = []
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('pricing_items')
      .select('name, description, category, price_cents, price_label, sort_order')
      .eq('is_active', true)
      .in('category', categoryConfig.map(c => c.category))
      .or('event_types.cs.{kids-party},event_types.is.null')
      .order('sort_order', { ascending: true })
    items = data || []
  } catch {
    // page renders empty
  }

  const byCategory = new Map<string, PricingRow[]>()
  for (const item of items) {
    const list = byCategory.get(item.category) || []
    list.push(item)
    byCategory.set(item.category, list)
  }

  return (
    <div>
      <section className="py-16 text-center px-4">
        <h1 className="font-serif text-4xl text-hampton-navy mb-4">Party Add-Ons</h1>
        <p className="text-hampton-navy text-lg max-w-xl mx-auto">
          Every party is magical. These extras make it unforgettable.
        </p>
      </section>

      <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6">
        <div className="space-y-12">
          {categoryConfig.map(cat => {
            const catItems = byCategory.get(cat.category)
            if (!catItems || catItems.length === 0) return null
            return (
              <div key={cat.category}>
                <h2 className="font-semibold text-xl text-hampton-navy mb-5 border-b border-hampton-pink/20 pb-2">{cat.label}</h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  {catItems.map(item => (
                    <div key={item.name} className="bg-white border border-hampton-pink/20 rounded-xl p-4 flex justify-between items-start gap-4">
                      <div>
                        <h3 className="font-semibold text-hampton-navy text-sm tracking-wide mb-0.5">{item.name}</h3>
                        {item.description && (
                          <p className="text-hampton-navy text-xs leading-relaxed">{item.description}</p>
                        )}
                      </div>
                      <span className="text-hampton-navy font-bold text-base shrink-0">
                        {formatPrice(item.price_cents, item.price_label)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="bg-hampton-pink/10 py-14 text-center px-4">
        <h2 className="section-heading mb-3">Add These to Your Package</h2>
        <p className="text-hampton-navy mb-7">Add-ons are selected during the planning process — after you reserve your date.</p>
        <Link href="/book" className="btn-primary px-10 py-4 text-base">Reserve Your Date First — $99</Link>
      </section>
    </div>
  )
}
