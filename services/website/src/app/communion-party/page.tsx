import type { Metadata } from 'next'
import Link from 'next/link'
import { Check } from 'lucide-react'

export const metadata: Metadata = {
  title: 'First Communion Party Venue | Host Hampton, Long Island',
  description:
    'Celebrate your child\'s First Communion at Host Hampton in Speonk, NY. Private party room, elegant decor, full catering, and customizable themes. Reserve with a $99 deposit. Serving all of Long Island and the Hamptons.',
  keywords: ['communion party venue Long Island', 'first communion party Hamptons', 'communion celebration venue NY', 'communion party room rental Speonk'],
}

export default function CommunionParty() {
  return (
    <>
      <section className="py-20 text-center px-4">
        <p className="text-hampton-pink text-sm font-semibold tracking-widest uppercase mb-4">A Sacred Milestone</p>
        <h1 className="font-serif text-4xl md:text-5xl text-hampton-navy mb-5 max-w-3xl mx-auto leading-tight">
          First Communion Party Venue on Long Island
        </h1>
        <p className="text-hampton-navy text-lg max-w-xl mx-auto mb-8">
          Host Hampton's private studio is the perfect setting for an elegant, memorable First Communion celebration. We handle every detail so your family can focus on what matters.
        </p>
        <Link href="/book?event_type=communion"
              className="bg-hampton-pink text-hampton-navy font-bold px-8 py-4 rounded-full text-base hover:bg-opacity-90 shadow-lg">
          Reserve Your Date
        </Link>
      </section>

      <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <h2 className="section-heading">A Beautiful Setting for a Beautiful Day</h2>
          <p className="text-hampton-navy text-base max-w-xl mx-auto">
            Our boutique studio is perfect for intimate communion parties of 8 to 20 guests. Elegant, clean, and completely private.
          </p>
        </div>
        <div className="grid md:grid-cols-2 gap-8">
          <div>
            <h3 className="font-semibold text-hampton-navy text-lg mb-4">What We Provide</h3>
            <ul className="space-y-2">
              {[
                'Private studio — never shared with other events',
                'Elegant white and gold or custom color decor',
                'Balloon arrangements and floral accents',
                'Full catering: pizza, platters, beverages',
                'Cupcakes, cake table setup',
                'Professional setup & full cleanup',
                '2–3 hours of exclusive space',
              ].map(i => (
                <li key={i} className="flex items-start gap-2 text-sm text-hampton-navy">
                  <Check size={14} className="text-hampton-navy shrink-0 mt-0.5" />
                  <span>{i}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-hampton-pink/10 rounded-2xl p-6">
            <h3 className="font-semibold text-hampton-navy text-lg mb-4">Pricing</h3>
            <div className="space-y-3">
              {[
                { name: 'Intimate Communion',  guests: 'Up to 10 guests', price: 800 },
                { name: 'Family Celebration',  guests: 'Up to 12 guests', price: 1045, popular: true },
                { name: 'Full Family Affair',  guests: 'Up to 15 guests', price: 1295 },
              ].map(p => (
                <div key={p.name}
                     className={`rounded-xl p-4 ${p.popular ? 'bg-hampton-pink/30 border border-hampton-pink' : 'bg-white border border-hampton-pink/20'}`}>
                  <div className="flex justify-between items-center">
                    <div>
                      {p.popular && <span className="text-xs text-hampton-navy font-bold uppercase block mb-0.5">Popular</span>}
                      <p className="font-semibold text-hampton-navy text-sm">{p.name}</p>
                      <p className="text-hampton-navy text-xs">{p.guests} · 2 hours</p>
                    </div>
                    <p className="text-xl font-bold text-hampton-navy">${p.price.toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-gradient-to-r from-hampton-pink to-hampton-pink/30 py-14 text-center px-4">
        <h2 className="font-serif text-3xl text-hampton-navy mb-4">Ready to Celebrate This Milestone?</h2>
        <p className="text-hampton-navy/70 text-base max-w-md mx-auto mb-7">
          Reserve your date with a $99 deposit. We'll be in touch within 24 hours to start planning every beautiful detail.
        </p>
        <Link href="/book?event_type=communion"
              className="bg-hampton-navy text-white font-bold px-8 py-4 rounded-full hover:bg-opacity-90 transition-all shadow-lg">
          Reserve Your Communion Party
        </Link>
        <p className="text-hampton-navy/70 text-xs mt-3">Questions? Call (631) 998-9325</p>
      </section>
    </>
  )
}
