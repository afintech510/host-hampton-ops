import type { Metadata } from 'next'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { OG_DEFAULTS, SITE_URL, businessRef } from '@/lib/seo'
import { getSupabase } from '@/lib/supabase'
import { loadPricingCatalog } from '@/lib/pricingCatalog'
import { BOOKING_DEPOSIT_CENTS } from '@/lib/partyPricing'
import { usd } from '@/lib/partyCostFaq'
import { STUDIO_SEATED_CAPACITY } from '@/lib/studioRental'

/**
 * First birthdays are sold as a STUDIO RENTAL plus optional add-ons (Adam,
 * 2026-10-07).
 *
 * Before this the page showed three prices that disagreed with each other and
 * with the booking system: "$850 for up to 10 guests" in one sentence, a
 * $650 / $800 / $1,045 package table (sold by nothing — no pricing_items row
 * existed), and an "everything included" list. Answer engines quote a page's
 * figures, so they were quoting packages nobody could buy.
 *
 * Every figure is now READ: the rental rates from `loadPricingCatalog()` (what
 * /studio-rental charges) and the add-ons from the same `pricing_items` rows
 * /party-room-rental lists. Per-request for that reason — at build time there
 * are no Supabase credentials and the page would publish the fallback.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'First Birthday Party Venue — Long Island',
  description:
    "Rent our private studio in Speonk, NY for baby's first birthday. Weekday and weekend rates, room for the whole family, and optional decor, food and staff.",
  keywords: ['first birthday party Hamptons', 'first birthday party venue Long Island', 'first birthday party Speonk NY', 'toddler birthday party venue', '1st birthday party Long Island'],
  alternates: { canonical: `${SITE_URL}/first-birthday-parties` },
  openGraph: {
    ...OG_DEFAULTS,
    title: 'First Birthday Party Venue on Long Island',
    description: "A private Hamptons studio for baby's first birthday — yours for the afternoon, never shared.",
    url: `${SITE_URL}/first-birthday-parties`,
  },
}

interface AddOn {
  id: string
  name: string
  description: string | null
  category: string
  price_cents: number
  price_label: string | null
  price_type: string | null
}

function fmt(cents: number, label?: string | null, priceType?: string | null): string {
  if (label) return label
  if (cents === 0) return 'Included'
  const price = usd(cents)
  if (priceType === 'per_person') return `${price}/person`
  if (priceType === 'per_hour') return `${price}/hr`
  return price
}

/** The room-rental add-ons, exactly as /party-room-rental reads them. */
async function loadAddOns(): Promise<AddOn[]> {
  try {
    const { data, error } = await getSupabase()
      .from('pricing_items')
      .select('id, name, description, category, price_cents, price_label, price_type')
      .eq('is_active', true)
      .or('event_types.cs.{room-rental},event_types.is.null')
      .in('category', ['service-add-on', 'decor-add-on'])
      .order('sort_order', { ascending: true })
    if (error) {
      console.error('first-birthday: add-ons read failed —', error.message)
      return []
    }
    return (data ?? []) as AddOn[]
  } catch (err) {
    console.error('first-birthday: add-ons read threw —', err)
    return []
  }
}

const included = [
  `Private studio for ${STUDIO_SEATED_CAPACITY} seated guests — never shared`,
  'Tables and chairs',
  'WiFi and a Bluetooth speaker system',
  'Prep area for your food and cake',
  'Room for strollers, grandparents and little ones',
  'Bring your own decor, cake, caterer and vendors',
]

export default async function FirstBirthdayParties() {
  const [catalog, addOns] = await Promise.all([loadPricingCatalog(), loadAddOns()])
  const s = catalog.studioRates
  const deposit = usd(BOOKING_DEPOSIT_CENTS)

  const costAnswer =
    `A first birthday at Host Hampton is a private studio rental: ${usd(s.weekdayBaseCents)} for 3 hours on a weekday ` +
    `or ${usd(s.weekendBaseCents)} on a weekend (Saturday and Sunday), with extra hours at ${usd(s.weekdayAddlHourCents)} ` +
    `weekday / ${usd(s.weekendAddlHourCents)} weekend. Decor, setup, clean-up, food and party staff are optional add-ons. ` +
    `A ${deposit} deposit holds the date and comes off the total.`

  const faqs = [
    { q: 'How much does a first birthday party cost?', a: costAnswer },
    { q: 'How old does my child need to be?', a: 'Any age — we host first birthdays for babies and toddlers, and siblings of every age are welcome.' },
    { q: 'Can I bring my own cake and food?', a: 'Yes. Bring a smash cake from your favorite bakery and your own food or caterer, or add catering and treats from our menu.' },
    { q: 'How far in advance should I book?', a: `Weekend dates fill up fast — especially spring and summer. We recommend booking 6–8 weeks in advance. Your ${deposit} deposit locks the date.` },
    { q: 'Can I change the date after booking?', a: 'Yes! Life with a baby is unpredictable. You can change your date up to 1 week before the party, subject to availability.' },
  ]

  const firstBirthdaySchema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: 'First Birthday Party Studio Rental at Host Hampton',
    description: 'Private studio rental for first birthday parties in Speonk, NY (The Hamptons area), with optional decor, food and staff.',
    provider: businessRef(),
    areaServed: ['Hamptons', 'Long Island', 'Speonk NY', 'Southampton', 'East End'],
    url: `${SITE_URL}/first-birthday-parties`,
    offers: [
      { '@type': 'Offer', name: 'Weekday studio rental (Mon–Fri, 3 hours)', price: String(s.weekdayBaseCents / 100), priceCurrency: 'USD', url: `${SITE_URL}/first-birthday-parties` },
      { '@type': 'Offer', name: 'Weekend studio rental (Sat–Sun, 3 hours)', price: String(s.weekendBaseCents / 100), priceCurrency: 'USD', url: `${SITE_URL}/first-birthday-parties` },
    ],
  }
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(firstBirthdaySchema).replace(/</g, '\\u003c') }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema).replace(/</g, '\\u003c') }} />

      {/* Hero */}
      <section className="py-20 text-center px-4">
        <p className="text-hampton-pink text-sm font-semibold tracking-widest uppercase mb-4">
          Speonk, NY — The Hamptons
        </p>
        <h1 className="font-serif text-4xl md:text-5xl text-hampton-navy mb-5 max-w-3xl mx-auto leading-tight">
          First Birthday Parties Worth Remembering — On Long Island
        </h1>
        <p className="text-hampton-navy text-lg max-w-xl mx-auto mb-4">
          Baby only turns one once. Rent our beautiful, private Hamptons studio for the afternoon and make it
          yours — bring your own decor and food, or let us add decor, setup, clean-up and treats.
        </p>
        <p className="text-hampton-navy font-semibold mb-8">
          Starting at {usd(s.weekdayBaseCents)} weekdays · {usd(s.weekendBaseCents)} weekends · 3 hours
        </p>
        <Link href="/studio-rental"
              className="bg-hampton-pink text-hampton-navy font-bold px-8 py-4 rounded-full text-base hover:bg-opacity-90 transition-all shadow-lg">
          Check Availability
        </Link>
      </section>

      {/* Why perfect for first birthdays */}
      <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <h2 className="section-heading">Why Host Hampton for Baby&apos;s First Birthday?</h2>
          <p className="text-hampton-navy text-base max-w-xl mx-auto">
            We know first birthdays are as much for the parents as they are for the birthday baby. Here&apos;s why Long Island families choose us.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { icon: '🏠', title: 'All Yours, Never Shared', desc: 'A private studio for your family and friends — no other party in the room, no outside noise.' },
            { icon: '🎈', title: 'As Hands-Off As You Like', desc: 'Add our setup & decor and our clean-up service and you won’t have to touch a thing. Or bring your own and style it your way.' },
            { icon: '📸', title: 'Picture-Perfect Moments', desc: 'Every corner of our studio is designed to be beautiful. Your camera roll will thank you — and so will grandma.' },
          ].map(f => (
            <div key={f.title} className="bg-white border border-hampton-pink/20 rounded-2xl p-6 text-center">
              <div className="text-4xl mb-3">{f.icon}</div>
              <h3 className="font-semibold text-hampton-navy text-base mb-2">{f.title}</h3>
              <p className="text-hampton-navy text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="bg-hampton-pink/10 py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="section-heading mb-2">Simple, Transparent Pricing</h2>
          <p className="text-hampton-navy mb-8">A private studio rental, priced by the day of the week.</p>
          <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
            {[
              { name: 'Weekday', days: 'Monday – Friday', base: s.weekdayBaseCents, addl: s.weekdayAddlHourCents, full: s.weekdayFullDayCents },
              { name: 'Weekend', days: 'Saturday & Sunday', base: s.weekendBaseCents, addl: s.weekendAddlHourCents, full: s.weekendFullDayCents },
            ].map(p => (
              <div key={p.name} className="rounded-2xl p-6 border-2 bg-white border-hampton-pink/20">
                <h3 className="font-serif text-hampton-navy text-lg font-bold mb-1">{p.name}</h3>
                <p className="text-hampton-navy text-xs mb-4">{p.days} · 3 hours</p>
                <p className="text-hampton-navy text-xs uppercase tracking-wide">Starting at</p>
                <p className="text-3xl font-bold text-hampton-navy mb-3">{usd(p.base)}</p>
                <p className="text-hampton-navy/70 text-xs">Extra hours {usd(p.addl)}/hr · Full day {usd(p.full)}</p>
              </div>
            ))}
          </div>
          <p className="text-hampton-navy/70 text-sm mt-6">
            A {deposit} deposit holds your date and comes off the total. A refundable {usd(s.securityDepositCents)} card
            hold (not a charge) is placed before the event.
          </p>
        </div>
      </section>

      {/* What's included + add-ons */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <h2 className="section-heading text-center mb-8">What&apos;s Included</h2>
          <div className="bg-white rounded-2xl border border-hampton-pink/20 p-8 grid sm:grid-cols-2 gap-3 mb-12">
            {included.map(item => (
              <div key={item} className="flex items-start gap-2">
                <Check size={16} className="text-hampton-navy shrink-0 mt-0.5" />
                <span className="text-hampton-navy text-sm">{item}</span>
              </div>
            ))}
          </div>

          {addOns.length > 0 && (
            <>
              <h2 className="section-heading text-center mb-2">Optional Add-Ons</h2>
              <p className="text-center text-hampton-navy mb-8">Pick as many or as few as you like.</p>
              <div className="bg-white rounded-2xl border border-hampton-pink/20 divide-y divide-hampton-pink/10">
                {addOns.map(a => (
                  <div key={a.id} className="flex items-start justify-between gap-4 px-6 py-4">
                    <div>
                      <p className="font-semibold text-hampton-navy text-sm">{a.name}</p>
                      {a.description && <p className="text-hampton-navy/60 text-xs">{a.description}</p>}
                    </div>
                    <span className="font-bold text-hampton-navy text-sm whitespace-nowrap">{fmt(a.price_cents, a.price_label, a.price_type)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="text-center mt-8">
            <Link href="/party-room-rental"
                  className="text-hampton-navy underline text-sm hover:text-hampton-navy transition-colors">
              See the food, drinks and treats menu
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-gradient-to-r from-hampton-pink to-hampton-pink/30 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl text-hampton-navy text-center mb-8">First Birthday FAQ</h2>
          <div className="space-y-4">
            {faqs.map(f => (
              <div key={f.q} className="bg-white/60 rounded-xl p-5">
                <h3 className="text-hampton-navy font-semibold text-base mb-1">{f.q}</h3>
                <p className="text-hampton-navy/70 text-sm leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 text-center px-4 bg-gradient-to-r from-hampton-pink to-hampton-mauve">
        <h2 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-4">
          Let&apos;s Plan the Perfect First Birthday
        </h2>
        <p className="text-hampton-navy/70 text-base mb-8 max-w-md mx-auto">
          Pick your date and reserve it with a {deposit} deposit — you enjoy every magical moment.
        </p>
        <Link href="/studio-rental"
              className="bg-hampton-navy text-hampton-ivory font-bold px-10 py-4 rounded-full text-base hover:bg-opacity-90 shadow-lg">
          Check Availability
        </Link>
      </section>
    </>
  )
}
