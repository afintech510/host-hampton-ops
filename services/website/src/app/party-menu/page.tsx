import type { Metadata } from 'next'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'

export const metadata: Metadata = {
  title: 'Party Menu & Pricing | Host Hampton',
  description: 'Full pricing menu for Host Hampton party packages, room rentals, food & catering, decor, entertainment, and add-ons. Book your celebration today.',
}

export const dynamic = 'force-dynamic'

interface PricingItem {
  id: string
  name: string
  description: string | null
  category: string
  price_cents: number
  price_label: string | null
  is_popular: boolean
  sort_order: number
}

function fmt(cents: number, label?: string | null): string {
  if (label) return label
  if (cents === 0) return 'Included'
  const d = cents / 100
  return d % 1 === 0 ? `$${d.toLocaleString()}` : `$${d.toFixed(2)}`
}

export default async function PartyMenuPage() {
  let items: PricingItem[] = []
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('pricing_items')
      .select('id, name, description, category, price_cents, price_label, is_popular, sort_order, event_types')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
    items = (data || []) as (PricingItem & { event_types: string[] | null })[]
  } catch {
    // renders empty
  }

  // Helper: filter items by category + event type scope
  const isForEventType = (item: { event_types: string[] | null }, type: string) =>
    item.event_types === null || item.event_types.includes(type)

  const typed = items as (PricingItem & { event_types: string[] | null })[]
  const byCat = (cat: string, eventType?: string) =>
    typed.filter(i => i.category === cat && (!eventType || isForEventType(i, eventType)))

  // Kids party sections — exclude room-rental-only items
  const themes = byCat('party-theme', 'kids-party')
  const premiumActivities = byCat('activity-premium', 'kids-party')
  const standardActivities = byCat('activity-standard', 'kids-party')
  const partyAddOns = byCat('party-add-on', 'kids-party')

  // Room rental sections — room-rental-specific items
  const roomRentals = byCat('room-rental')
  const studioRentals = byCat('studio-rental')
  const deposits = byCat('deposit')
  const serviceAddOns = byCat('service-add-on', 'room-rental')

  // Universal sections — exclude room-rental-only items so they don't mix
  const food = byCat('food-add-on')
  const desserts = byCat('dessert-add-on')
  const beverages = byCat('beverage-add-on')
  const decor = typed.filter(i => i.category === 'decor-add-on' && isForEventType(i, 'kids-party'))
  const entertainment = byCat('entertainment-add-on')

  return (
    <div className="pb-0">
      {/* ── Hero ── */}
      <section className="py-20 text-center px-4">
        <h1 className="font-serif text-5xl md:text-6xl font-black tracking-tight text-hampton-navy mb-3">
          PARTY MENU
        </h1>
        <p className="text-lg font-semibold tracking-[0.25em] text-hampton-navy/50 uppercase">
          Full Pricing Guide
        </p>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 space-y-12 pb-20">

        {/* ═══ SLIDE 1: Party Themes ═══ */}
        <div className="bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
          <div className="bg-hampton-navy px-8 py-6 text-center">
            <h2 className="font-serif text-3xl font-black text-white tracking-tight">THEMED PARTY PACKAGES</h2>
            <p className="text-hampton-ivory/60 text-sm font-semibold tracking-[0.2em] uppercase mt-1">2 Hours Private Studio &bull; Everything Included</p>
          </div>

          {/* Intro box */}
          <div className="mx-8 mt-6 bg-hampton-blue/10 border-l-4 border-hampton-blue p-5 rounded-r-lg">
            <h3 className="font-serif font-bold text-lg text-hampton-navy mb-1">All-Inclusive Celebration</h3>
            <p className="text-xs text-hampton-navy/70 leading-relaxed font-medium">
              Every package includes 2 hours of private studio time, a dedicated party host, full themed decorations,
              activities &amp; entertainment, pizza or bagels, cupcakes &amp; birthday cake, treat cart, digital EVITE, and complete cleanup.
              10 guests + Birthday Star included. Additional guests $35 each.
            </p>
          </div>

          {/* Theme grid */}
          <div className="p-8 space-y-0">
            {themes.map((t, i) => (
              <div
                key={t.id}
                className={`flex items-center justify-between py-3.5 ${
                  i < themes.length - 1 ? 'border-b border-gray-100' : ''
                } ${t.is_popular ? 'bg-hampton-pink/5 -mx-4 px-4 rounded-xl' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <span className="font-bold text-hampton-navy text-base">{t.name}</span>
                  {t.is_popular && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white bg-hampton-pink px-2 py-0.5 rounded-full">
                      Popular
                    </span>
                  )}
                </div>
                <span className="font-black text-xl text-hampton-navy ml-4 tabular-nums">{fmt(t.price_cents)}</span>
              </div>
            ))}
          </div>

          {/* Deposit note */}
          <div className="px-8 pb-6 text-center">
            <p className="text-[11px] font-bold text-hampton-pink bg-hampton-pink/10 inline-block px-4 py-1.5 rounded-full border border-hampton-pink/20">
              $99 Deposit to Reserve &bull; Fully Applied Toward Balance
            </p>
          </div>
        </div>

        {/* ═══ SLIDE 2: Room Rental ═══ */}
        {roomRentals.length > 0 && (
          <div className="bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
            <div className="h-1 bg-hampton-navy" />
            <div className="text-center pt-8 pb-2 px-8">
              <h2 className="font-serif text-3xl font-black tracking-tight text-hampton-navy mb-1">PRIVATE PARTY</h2>
              <p className="text-sm font-semibold tracking-[0.25em] text-hampton-navy/40 uppercase">Room Rental</p>
            </div>

            {/* Intro */}
            <div className="mx-8 mt-4 bg-hampton-blue/10 border-l-4 border-hampton-blue p-5 rounded-r-lg">
              <h3 className="font-serif font-bold text-lg text-hampton-navy mb-1">Celebrate With Us</h3>
              <p className="text-xs text-hampton-navy/70 leading-relaxed font-medium">
                Our brand new event space is the perfect canvas for your next celebration.
                Whether it&apos;s a birthday, shower, or gathering, we provide the space — you bring the party.
              </p>
            </div>

            {/* Rental grid */}
            <div className="p-8">
              <div className="grid sm:grid-cols-2 gap-5">
                {/* Weekend column */}
                <div className="bg-white border-2 border-hampton-navy rounded-xl p-5 shadow-md">
                  <div className="text-center border-b border-gray-200 pb-3 mb-4">
                    <h3 className="font-serif font-bold text-2xl text-hampton-navy">Weekend</h3>
                    <p className="text-xs font-bold text-hampton-navy/40 uppercase tracking-wider mt-1">Fri, Sat, Sun</p>
                  </div>
                  <div className="space-y-3">
                    {roomRentals
                      .filter(r => r.name.toLowerCase().includes('weekend') || r.name.toLowerCase().includes('fri'))
                      .map(r => (
                        <div key={r.id} className="flex justify-between items-center">
                          <span className="font-medium text-hampton-navy/60 text-sm">{r.name.replace(/Party Room Rental\s*[-–—]\s*/i, '').replace(/Party Room Rental\s*/i, '')}</span>
                          <span className="font-black text-lg text-hampton-navy">{fmt(r.price_cents, r.price_label)}</span>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Weekday column */}
                <div className="bg-hampton-ivory/50 border border-gray-200 rounded-xl p-5">
                  <div className="text-center border-b border-gray-200 pb-3 mb-4">
                    <h3 className="font-serif font-bold text-2xl text-hampton-navy/70">Weekday</h3>
                    <p className="text-xs font-bold text-hampton-navy/30 uppercase tracking-wider mt-1">Mon — Thu</p>
                  </div>
                  <div className="space-y-3">
                    {roomRentals
                      .filter(r => r.name.toLowerCase().includes('weekday') || r.name.toLowerCase().includes('mon'))
                      .map(r => (
                        <div key={r.id} className="flex justify-between items-center">
                          <span className="font-medium text-hampton-navy/50 text-sm">{r.name.replace(/Party Room Rental\s*[-–—]\s*/i, '').replace(/Party Room Rental\s*/i, '')}</span>
                          <span className="font-bold text-lg text-hampton-navy/70">{fmt(r.price_cents, r.price_label)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              {/* Studio / Professional Use */}
              {studioRentals.length > 0 && (
                <div className="mt-6 bg-hampton-navy text-white rounded-xl p-5 shadow-md">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-serif font-bold text-lg text-white mb-1 flex items-center gap-2">
                        <span className="bg-white text-hampton-navy text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">Business</span>
                        Professional Use
                      </h3>
                      <p className="text-sm text-white/60 font-medium">Photography Studio &bull; Beauty Session &bull; Meetings</p>
                    </div>
                    <div className="text-right pl-4 border-l border-white/20">
                      <div className="text-2xl font-black text-white">{fmt(studioRentals[0].price_cents, studioRentals[0].price_label)}</div>
                      <div className="text-xs font-medium text-white/50 uppercase">Per Hour</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Deposit note */}
            {deposits.length > 0 && (
              <div className="px-8 pb-6 text-center">
                <p className="text-[11px] font-bold text-red-500 bg-red-50 inline-block px-4 py-1.5 rounded-full border border-red-100">
                  All Room Rentals Require a {fmt(deposits[0].price_cents)} Security Deposit (Refundable)
                </p>
              </div>
            )}
          </div>
        )}

        {/* ═══ SLIDE 3: Food & Beverage ═══ */}
        <div className="bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
          <div className="text-center pt-8 pb-2 px-8">
            <h2 className="font-serif text-3xl font-black text-hampton-pink tracking-tight mb-1">FOOD &amp; BEVERAGE</h2>
            <p className="text-hampton-navy/40 uppercase tracking-widest text-xs font-semibold">Catering &amp; Refreshments</p>
          </div>

          <div className="p-8 space-y-8">
            {/* Food */}
            {food.length > 0 && (
              <div className="bg-hampton-ivory/50 p-6 rounded-2xl border border-gray-100">
                <h3 className="font-serif font-bold text-xl text-hampton-navy mb-5 border-b border-gray-200 pb-2">Food &amp; Catering</h3>
                <div className="space-y-2.5">
                  {food.map(item => (
                    <div key={item.id} className="bg-white p-3.5 rounded-xl shadow-sm border border-gray-100 flex justify-between items-center">
                      <div>
                        <span className="font-bold text-hampton-navy text-sm block">{item.name}</span>
                        {item.description && <span className="text-[11px] text-hampton-navy/50">{item.description}</span>}
                      </div>
                      <span className="font-bold text-hampton-pink text-lg ml-4 whitespace-nowrap">{fmt(item.price_cents, item.price_label)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Desserts */}
            {desserts.length > 0 && (
              <div className="bg-hampton-pink/5 p-6 rounded-2xl border border-hampton-pink/10">
                <h3 className="font-serif font-bold text-xl text-hampton-navy mb-5 border-b border-hampton-pink/20 pb-2">Desserts</h3>
                <div className="space-y-2.5">
                  {desserts.map(item => (
                    <div key={item.id} className="bg-white p-3.5 rounded-xl shadow-sm border border-hampton-pink/10 flex justify-between items-center">
                      <div>
                        <span className="font-bold text-hampton-navy text-sm block">{item.name}</span>
                        {item.description && <span className="text-[11px] text-hampton-navy/50">{item.description}</span>}
                      </div>
                      <span className="font-black text-lg text-hampton-navy ml-4 whitespace-nowrap">{fmt(item.price_cents, item.price_label)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Beverages */}
            {beverages.length > 0 && (
              <div className="bg-hampton-ivory/50 p-6 rounded-2xl border border-gray-100">
                <h3 className="font-serif font-bold text-xl text-hampton-navy mb-5 border-b border-gray-200 pb-2">Beverages</h3>
                <div className="space-y-2.5">
                  {beverages.map(item => (
                    <div key={item.id} className="bg-white p-3.5 rounded-xl shadow-sm border border-gray-100 flex justify-between items-center">
                      <div>
                        <span className="font-bold text-hampton-navy text-sm block">{item.name}</span>
                        {item.description && <span className="text-[11px] text-hampton-navy/50">{item.description}</span>}
                      </div>
                      <span className="font-bold text-hampton-pink text-lg ml-4 whitespace-nowrap">{fmt(item.price_cents, item.price_label)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ═══ SLIDE 4: Decor & Entertainment ═══ */}
        <div className="bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
          <div className="text-center pt-8 pb-2 px-8">
            <h2 className="font-serif text-3xl font-black text-hampton-navy tracking-tight mb-1">DECOR &amp; ENTERTAINMENT</h2>
            <p className="text-hampton-navy/40 uppercase tracking-widest text-xs font-semibold">Elevate the Experience</p>
          </div>

          <div className="p-8 space-y-8">
            {/* Decor */}
            {decor.length > 0 && (
              <div className="bg-hampton-ivory/50 p-6 rounded-2xl border border-gray-100">
                <h3 className="font-serif font-bold text-xl text-hampton-navy mb-5 border-b border-gray-200 pb-2">Decor Upgrades</h3>
                <div className="space-y-2.5">
                  {decor.map(item => (
                    <div key={item.id} className="bg-white p-3.5 rounded-xl shadow-sm border border-gray-100 flex justify-between items-center">
                      <div>
                        <span className="font-bold text-hampton-navy text-sm block">{item.name}</span>
                        {item.description && <span className="text-[11px] text-hampton-navy/50">{item.description}</span>}
                      </div>
                      <span className="font-bold text-hampton-pink text-lg ml-4 whitespace-nowrap">{fmt(item.price_cents, item.price_label)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Entertainment */}
            {entertainment.length > 0 && (
              <div className="bg-hampton-pink/5 p-6 rounded-2xl border border-hampton-pink/10">
                <h3 className="font-serif font-bold text-xl text-hampton-pink/80 mb-5 border-b border-hampton-pink/20 pb-2">Entertainment</h3>
                <div className="space-y-2.5">
                  {entertainment.map(item => (
                    <div key={item.id} className="bg-white p-3.5 rounded-xl shadow-sm border border-hampton-pink/10 flex justify-between items-center">
                      <div>
                        <span className="font-bold text-hampton-navy text-sm block">{item.name}</span>
                        {item.description && <span className="text-[11px] text-hampton-navy/50">{item.description}</span>}
                      </div>
                      <span className="font-black text-lg text-hampton-navy ml-4 whitespace-nowrap">{fmt(item.price_cents, item.price_label)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ═══ SLIDE 5: Service Add-Ons & Party Extras ═══ */}
        <div className="bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
          <div className="text-center pt-8 pb-2 px-8">
            <h2 className="font-serif text-3xl font-black text-hampton-pink tracking-tight mb-1">SERVICE ADD-ONS</h2>
            <p className="text-hampton-navy/40 uppercase tracking-widest text-xs font-semibold">Make Your Event Effortless</p>
          </div>

          <div className="p-8 space-y-8">
            {/* Service add-ons */}
            {serviceAddOns.length > 0 && (
              <div className="bg-hampton-ivory/50 p-6 rounded-2xl border border-gray-100">
                <h3 className="font-serif font-bold text-xl text-hampton-navy mb-5 border-b border-gray-200 pb-2">The Essentials</h3>
                <div className="space-y-2.5">
                  {serviceAddOns.map(item => (
                    <div key={item.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex justify-between items-center">
                      <div>
                        <span className="font-bold text-hampton-navy text-base block">{item.name}</span>
                        {item.description && <span className="text-[11px] text-hampton-navy/50">{item.description}</span>}
                      </div>
                      <span className="font-bold text-hampton-pink text-xl ml-4 whitespace-nowrap">{fmt(item.price_cents, item.price_label)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Party extras */}
            {partyAddOns.length > 0 && (
              <div className="bg-hampton-pink/5 p-6 rounded-2xl border border-hampton-pink/10">
                <h3 className="font-serif font-bold text-xl text-hampton-pink/80 mb-5 border-b border-hampton-pink/20 pb-2">Party Extras</h3>
                <div className="space-y-2.5">
                  {partyAddOns.map(item => (
                    <div key={item.id} className="bg-white p-4 rounded-xl shadow-sm border border-hampton-pink/10 flex justify-between items-center">
                      <div>
                        <span className="font-bold text-hampton-navy text-base block">{item.name}</span>
                        {item.description && <span className="text-[11px] text-hampton-navy/50">{item.description}</span>}
                      </div>
                      <span className="font-black text-xl text-hampton-navy ml-4 whitespace-nowrap">{fmt(item.price_cents, item.price_label)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ═══ SLIDE 6: Activities ═══ */}
        {(premiumActivities.length > 0 || standardActivities.length > 0) && (
          <div className="bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
            <div className="text-center pt-8 pb-2 px-8">
              <h2 className="font-serif text-3xl font-black text-hampton-navy tracking-tight mb-1">ACTIVITIES</h2>
              <p className="text-hampton-navy/40 uppercase tracking-widest text-xs font-semibold">Included With Every Party Package</p>
            </div>

            <div className="p-8 space-y-6">
              {premiumActivities.length > 0 && (
                <div>
                  <h3 className="font-serif font-bold text-lg text-hampton-navy mb-4 border-b border-gray-200 pb-2">Premium Activities</h3>
                  <div className="flex flex-wrap gap-2.5">
                    {premiumActivities.map(item => (
                      <span
                        key={item.id}
                        className={`px-4 py-2 rounded-full text-sm font-medium border ${
                          item.price_cents > 0
                            ? 'bg-hampton-pink/10 border-hampton-pink/20 text-hampton-navy'
                            : 'bg-hampton-ivory border-hampton-pink/10 text-hampton-navy'
                        }`}
                      >
                        {item.name}
                        {item.price_cents > 0 && (
                          <span className="ml-1.5 font-bold text-hampton-pink">+{fmt(item.price_cents)}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {standardActivities.length > 0 && (
                <div>
                  <h3 className="font-serif font-bold text-lg text-hampton-navy mb-4 border-b border-gray-200 pb-2">Standard Activities</h3>
                  <div className="flex flex-wrap gap-2.5">
                    {standardActivities.map(item => (
                      <span
                        key={item.id}
                        className="px-4 py-2 rounded-full bg-gray-50 border border-gray-200 text-sm font-medium text-hampton-navy/70"
                      >
                        {item.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* ── CTA ── */}
      <section className="bg-hampton-pink/20 py-14 text-center px-4">
        <h2 className="section-heading mb-3">Ready to Book?</h2>
        <p className="text-hampton-navy text-base mb-7 max-w-md mx-auto">
          Reserve your date with a $99 deposit. We&apos;ll help you customize every detail.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/book" className="btn-primary px-10 py-4 text-base">
            Reserve Your Date
          </Link>
          <Link
            href="/party-packages"
            className="border-2 border-hampton-navy text-hampton-navy px-10 py-4 rounded-full text-base font-bold hover:bg-hampton-navy hover:text-white transition-all"
          >
            Build Your Party
          </Link>
        </div>
        <p className="text-hampton-navy/50 text-sm mt-6">
          Call or text us: <a href="tel:6319989325" className="font-semibold text-hampton-navy">(631) 998-9325</a>
        </p>
      </section>
    </div>
  )
}
