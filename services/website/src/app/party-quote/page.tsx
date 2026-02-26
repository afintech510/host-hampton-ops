import type { Metadata } from 'next'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import QuoteBuilder from '@/components/QuoteBuilder'
import type { PricingItem } from '@/components/QuoteBuilder'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: "Children's Party Quote Builder | Host Hampton, Speonk NY",
  description:
    'Build your dream party quote instantly. Choose a theme, activities, food, desserts, decor, entertainment, and more. See your estimated total in real time.',
  openGraph: {
    title: "Children's Party Quote Builder | Host Hampton",
    description: 'Build your dream party quote instantly. Choose a theme, add-ons, and see your total in real time.',
  },
}

export default async function PartyQuotePage({
  searchParams,
}: {
  searchParams: { q?: string }
}) {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('pricing_items')
    .select('id, name, description, category, price_cents, price_label, is_popular, sort_order, event_types, emoji')
    .eq('is_active', true)
    .or('event_types.cs.{kids-party},event_types.is.null')
    .order('sort_order')

  const items: PricingItem[] = data ?? []
  const byCategory = (cat: string) => items.filter(i => i.category === cat)

  return (
    <div>
      {/* Hero */}
      <section className="pt-16 pb-10 text-center px-4">
        <p className="section-subheading">Plan Your Perfect Party</p>
        <h1 className="font-serif text-4xl md:text-5xl text-hampton-navy mb-4 tracking-tight">
          Party Quote Builder
        </h1>
        <p className="text-hampton-navy/70 text-lg max-w-xl mx-auto leading-relaxed">
          Choose your theme, pick your favorites, and see your estimated total instantly.
          When you&apos;re ready, reserve your date with a <strong>$99 deposit</strong>.
        </p>
        <div className="flex justify-center gap-3 mt-5 text-xs">
          <Link href="/party-menu" className="text-hampton-navy/50 underline underline-offset-2 hover:text-hampton-navy transition-colors">
            View Full Menu
          </Link>
          <span className="text-hampton-mauve">|</span>
          <Link href="/party-packages" className="text-hampton-navy/50 underline underline-offset-2 hover:text-hampton-navy transition-colors">
            Theme Party Details
          </Link>
        </div>
      </section>

      {/* Quote Builder Module */}
      <QuoteBuilder
        themes={byCategory('party-theme')}
        activities={[...byCategory('activity-standard'), ...byCategory('activity-premium')]}
        food={byCategory('food-add-on')}
        desserts={byCategory('dessert-add-on')}
        decor={byCategory('decor-add-on')}
        entertainment={byCategory('entertainment-add-on')}
        beverages={byCategory('beverage-add-on')}
        extras={[...byCategory('party-add-on'), ...byCategory('service-add-on')]}
        savedQuote={searchParams.q ?? null}
      />
    </div>
  )
}
