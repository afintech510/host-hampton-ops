import { Check } from 'lucide-react'
import { unstable_noStore as noStore } from 'next/cache'
import { getSupabase } from '@/lib/supabase'
import { loadPricingCatalog } from '@/lib/pricingCatalog'
import { BOOKING_DEPOSIT_CENTS } from '@/lib/partyPricing'

/**
 * Studio AND at-home prices for one themed party, side by side.
 *
 * WHY. /spa-party showed only the generic $500/$750 mobile craft tiers under
 * "Spa Party Pricing", so all four AI deep dives (2026-10-04) either quoted
 * $500 as the price of a spa party or said the page had no spa price at all.
 *
 * The STUDIO figures are read, not typed: the theme's `pricing_items` row (what
 * the planner charges) and the Mini Party discount from the catalog. The
 * AT-HOME figure is Adam's own ruling for this theme (craftParties.ts) and is
 * rendered as text only — no mobile price may appear in structured data
 * (plan §15), and this component emits none.
 */
export default async function ThemePartyPriceBlock({
  partyName,
  studioItemName,
  atHomeFromCents,
  atHomeNote,
}: {
  partyName: string
  studioItemName: string
  atHomeFromCents: number
  atHomeNote: string
}) {
  // Live prices: see the noStore() note in MobilePriceBlock.
  noStore()
  const [catalog, studioCents] = await Promise.all([loadPricingCatalog(), loadStudioPrice(studioItemName)])
  const g = catalog.guestRules
  const usd = (c: number) => `$${Math.round(c / 100).toLocaleString('en-US')}`

  const cards = [
    studioCents
      ? {
          label: 'At Our Speonk Studio',
          price: usd(studioCents),
          sub: `2 hours · ${g.includedGuests} kids + the birthday child`,
          points: [
            `Mini Party: ${usd(studioCents - g.miniPartyDiscountCents)} — 1.5 hours, smaller group`,
            `Extra guests ${usd(g.extraGuestCents)} each`,
            'Host, decor, pizza or bagels, cupcakes and cleanup included',
          ],
        }
      : null,
    {
      label: 'At Your Home',
      price: `From ${usd(atHomeFromCents)}`,
      sub: 'Anywhere on Long Island',
      points: [
        atHomeNote,
        'Free travel within 20 miles of Speonk',
        'No mandatory gratuity — what we quote is what you pay',
      ],
    },
  ].filter((c): c is NonNullable<typeof c> => c !== null)

  return (
    <section className="py-16 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-10">
          <p className="section-subheading">Pricing</p>
          <h2 className="section-heading">{partyName} Pricing</h2>
          <p className="text-hampton-navy/70 max-w-xl mx-auto">
            A {usd(BOOKING_DEPOSIT_CENTS)} deposit holds your date and comes off your total.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-5">
          {cards.map(c => (
            <div key={c.label} className="bg-white border-2 border-hampton-navy/10 rounded-2xl p-6 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-widest text-hampton-pink mb-2">{c.label}</p>
              <p className="font-serif text-4xl font-black text-hampton-navy">{c.price}</p>
              <p className="text-sm text-hampton-navy/60 mb-4">{c.sub}</p>
              <ul className="space-y-2">
                {c.points.map(p => (
                  <li key={p} className="flex items-start gap-2 text-sm text-hampton-navy">
                    <Check size={14} className="text-hampton-pink shrink-0 mt-0.5" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** The theme's live price, or null — the card is omitted rather than shown at $0. */
async function loadStudioPrice(itemName: string): Promise<number | null> {
  try {
    const { data, error } = await getSupabase()
      .from('pricing_items')
      .select('price_cents')
      .eq('category', 'party-theme')
      .eq('name', itemName)
      .eq('is_active', true)
      .maybeSingle()
    if (error || !data || !(Number(data.price_cents) > 0)) {
      if (error) console.error('ThemePartyPriceBlock: price read failed —', error.message)
      return null
    }
    return Number(data.price_cents)
  } catch (err) {
    console.error('ThemePartyPriceBlock: price read threw —', err)
    return null
  }
}
