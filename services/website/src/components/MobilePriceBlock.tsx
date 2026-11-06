import { Check, Gift, MapPin, ShieldCheck, CalendarCheck } from 'lucide-react'
import { unstable_noStore as noStore } from 'next/cache'
import { loadPricingCatalog } from '@/lib/pricingCatalog'

/**
 * The mobile-party packages (plan item B-1), WITHOUT their prices.
 *
 * Adam, 2026-11-05: "remove the pricing listed for now" — the $500 / $750 tier
 * prices and every other dollar figure (the extra-child price, the deposit) are
 * off the public pages while the mobile numbers are reworked. The two packages
 * stay: what each covers, how long, how many kids. A visitor asks for a quote.
 * Nothing here is the price anyone is CHARGED: the planner and the quote engine
 * read `mobileBands`, never `mobileTiers`, so this changes what is shown only.
 * To publish prices again, put `tier.price` back into the tier card.
 *
 * The fine print carries the two things rivals can't say — no mandatory gratuity
 * (The Slime Machine adds 20%) and a genuinely free local radius. No dollar figure.
 *
 * Every number here comes from `pricing_items` via `loadPricingCatalog()`
 * (migration 036). This is a server component, and all four of its callers
 * (/mobile-party, /mobile-craft-party, the 26 town pages, CraftPartyLanding)
 * are server components too, so the await costs one cached query per minute
 * rather than one per page.
 *
 * `noStore()` makes every page that renders this block dynamic. Without it
 * `next build` prerenders those pages with no Supabase env, so they served
 * FALLBACK_CATALOG under a one-year cache header and never saw a price edit.
 * It sits here rather than in `loadPricingCatalog` because client components
 * import that module, and here rather than as `dynamic` on each page because
 * a page that forgets the export goes stale silently.
 */
export default async function MobilePriceBlock({
  heading = 'Mobile Party Packages',
  subheading = "Brought to your door. Tell us your date and guest count and we'll send your exact quote — what we quote is what you pay.",
}: {
  heading?: string
  subheading?: string
}) {
  noStore()
  const { mobileTiers, mobilePolicy } = await loadPricingCatalog()

  return (
    <section className="py-16 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10">
          <p className="section-subheading">Packages</p>
          <h2 className="section-heading">{heading}</h2>
          <p className="text-hampton-navy/70 max-w-xl mx-auto">{subheading}</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-6">
          {mobileTiers.map(tier => (
            <div
              key={tier.name}
              className={`relative bg-white rounded-2xl p-7 border transition-shadow hover:shadow-md ${
                tier.popular ? 'border-[#c4975a] shadow-lg' : 'border-hampton-pink/20'
              }`}
            >
              {tier.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#c4975a] text-white text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                  Most Booked
                </span>
              )}

              <h3 className="font-serif text-2xl text-hampton-navy mb-1">{tier.name}</h3>
              <p className="text-hampton-navy/60 text-sm mb-4">{tier.tagline}</p>

              <div className="flex items-baseline gap-2 mb-1">
                <span className="font-serif text-4xl text-hampton-navy">{tier.minutes}</span>
                <span className="text-hampton-navy/60 text-sm">minutes</span>
              </div>
              <p className="text-hampton-navy/70 text-sm mb-5">
                Up to <strong>{tier.kids} kids</strong> — plus the birthday child, free
              </p>

              <ul className="space-y-2">
                {tier.includes.map(item => (
                  <li key={item} className="flex gap-2 text-sm text-hampton-navy/75 leading-relaxed">
                    <Check size={15} className="shrink-0 mt-0.5 text-[#c4975a]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Trust / fine print — the part competitors can't match */}
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="flex items-start gap-2.5 bg-hampton-pink/10 rounded-xl p-4">
            <Gift size={17} className="shrink-0 mt-0.5 text-hampton-navy/60" />
            <p className="text-hampton-navy/75 text-sm leading-relaxed">
              <strong>Birthday child is always free.</strong> Extra guests are added to your quote.
            </p>
          </div>
          <div className="flex items-start gap-2.5 bg-hampton-pink/10 rounded-xl p-4">
            <MapPin size={17} className="shrink-0 mt-0.5 text-hampton-navy/60" />
            <p className="text-hampton-navy/75 text-sm leading-relaxed">
              <strong>Free travel within {mobilePolicy.freeTravelMiles} miles</strong> of our Speonk studio; a modest
              mileage charge beyond it.
            </p>
          </div>
          <div className="flex items-start gap-2.5 bg-hampton-pink/10 rounded-xl p-4">
            <ShieldCheck size={17} className="shrink-0 mt-0.5 text-hampton-navy/60" />
            <p className="text-hampton-navy/75 text-sm leading-relaxed">
              <strong>No mandatory gratuity.</strong> What we quote is what you pay.
            </p>
          </div>
          <div className="flex items-start gap-2.5 bg-hampton-pink/10 rounded-xl p-4">
            <CalendarCheck size={17} className="shrink-0 mt-0.5 text-hampton-navy/60" />
            <p className="text-hampton-navy/75 text-sm leading-relaxed">
              <strong>A deposit holds your date.</strong> {mobilePolicy.minGuests} guest minimum.
            </p>
          </div>
        </div>

        <p className="text-center text-hampton-navy/50 text-xs mt-6">
          Bigger group, longer party, or a specific theme in mind? Tell us what you want — we tailor every
          party and send your quote, usually within 24 hours.
        </p>
      </div>
    </section>
  )
}
