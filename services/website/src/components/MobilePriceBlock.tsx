import { Check, Gift, MapPin, ShieldCheck, CalendarCheck } from 'lucide-react'
import { MOBILE_TIERS, EXTRA_CHILD_PRICE, FREE_TRAVEL_MILES, MIN_GUESTS, DEPOSIT } from '@/lib/mobilePricing'

/**
 * The published mobile-party price anchor (plan item B-1).
 *
 * Every competitor publishes a starting price and we published none, which meant
 * losing price-shoppers before we could explain the value. The two-tier layout is
 * deliberate: the Entry tier is the "from" number that wins the comparison, and
 * the Signature tier is where most people land.
 *
 * The fine print carries the two things rivals can't say — no mandatory gratuity
 * (The Slime Machine adds 20%) and a genuinely free local radius.
 */
export default function MobilePriceBlock({
  heading = 'Mobile Party Pricing',
  subheading = 'Straightforward pricing, brought to your door. What we quote is what you pay.',
}: {
  heading?: string
  subheading?: string
}) {
  return (
    <section className="py-16 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10">
          <p className="section-subheading">Pricing</p>
          <h2 className="section-heading">{heading}</h2>
          <p className="text-hampton-navy/70 max-w-xl mx-auto">{subheading}</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-6">
          {MOBILE_TIERS.map(tier => (
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
                <span className="font-serif text-4xl text-hampton-navy">${tier.price}</span>
                <span className="text-hampton-navy/60 text-sm">/ {tier.minutes} min</span>
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
              <strong>Birthday child is always free</strong> — additional kids ${EXTRA_CHILD_PRICE} each.
            </p>
          </div>
          <div className="flex items-start gap-2.5 bg-hampton-pink/10 rounded-xl p-4">
            <MapPin size={17} className="shrink-0 mt-0.5 text-hampton-navy/60" />
            <p className="text-hampton-navy/75 text-sm leading-relaxed">
              <strong>Free travel within {FREE_TRAVEL_MILES} miles</strong> of our Speonk studio; a modest
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
              <strong>A ${DEPOSIT} deposit holds your date.</strong> {MIN_GUESTS} guest minimum.
            </p>
          </div>
        </div>

        <p className="text-center text-hampton-navy/50 text-xs mt-6">
          Bigger group, longer party, or a specific theme in mind? Tell us what you want — we tailor every
          party, and no two are the same.
        </p>
      </div>
    </section>
  )
}
