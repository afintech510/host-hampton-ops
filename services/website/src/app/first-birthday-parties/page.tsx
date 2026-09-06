import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { Check, Heart, Star } from 'lucide-react'

export const metadata: Metadata = {
  title: 'First Birthday Party Venue — Long Island & the Hamptons',
  description:
    'Make baby\'s first birthday magical at Host Hampton in Speonk, NY. Private studio, full setup, themed decorations, and a stress-free celebration for toddlers on Long Island. Reserve with a 25% deposit.',
  keywords: ['first birthday party Hamptons', 'first birthday party venue Long Island', 'first birthday party Speonk NY', 'toddler birthday party venue', '1st birthday party Long Island'],
}

const firstBirthdaySchema = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: 'First Birthday Party at Host Hampton',
  description: 'Private studio first birthday party packages for babies and toddlers in Speonk, NY (The Hamptons area).',
  provider: {
    '@type': 'LocalBusiness',
    name: 'Host Hampton',
    address: { '@type': 'PostalAddress', streetAddress: '295 Montauk Hwy', addressLocality: 'Speonk', addressRegion: 'NY', postalCode: '11972' },
    telephone: '+16319989325',
  },
  areaServed: ['Hamptons', 'Long Island', 'Speonk NY', 'Southampton', 'East End'],
  offers: { '@type': 'Offer', price: '850', priceCurrency: 'USD', description: 'First birthday party starting at $850 for up to 10 guests' },
}

const included = [
  'Balloon arches in your chosen colors',
  'Custom "ONE" banner or name banner',
  'Smash cake setup (family brings cake)',
  'Soft play area for little ones',
  'Sensory activities safe for babies',
  '2 hours private studio — never shared',
  'Pizza or finger foods for adults',
  'Cupcakes and treat cart for kids',
  'Full setup before arrival, cleanup after',
  'Digital invitation for guests',
]

export default function FirstBirthdayParties() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(firstBirthdaySchema) }}
      />

      {/* Hero */}
      <section className="py-20 text-center px-4">
        <p className="text-hampton-pink text-sm font-semibold tracking-widest uppercase mb-4">
          Speonk, NY — The Hamptons
        </p>
        <h1 className="font-serif text-4xl md:text-5xl text-hampton-navy mb-5 max-w-3xl mx-auto leading-tight">
          First Birthday Parties Worth Remembering — On Long Island
        </h1>
        <p className="text-hampton-navy text-lg max-w-xl mx-auto mb-8">
          Baby only turns one once. Make it magical in a beautiful Hamptons studio — at a price that makes sense. We handle every detail and guide the little ones through each activity so you can actually enjoy the moment. Customize as much or as little as you like.
        </p>
        <Link href="/book?package=Toddler+Party&event_type=first-birthday"
              className="bg-hampton-pink text-hampton-navy font-bold px-8 py-4 rounded-full text-base hover:bg-opacity-90 transition-all shadow-lg">
          Reserve Your Date
        </Link>
        <p className="text-hampton-navy text-xs mt-3">Change details anytime up to 1 week before the party</p>
      </section>

      {/* Why perfect for first birthdays */}
      <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <h2 className="section-heading">Why Host Hampton for Baby's First Birthday?</h2>
          <p className="text-hampton-navy text-base max-w-xl mx-auto">
            We know first birthdays are as much for the parents as they are for the birthday baby. Here's why Long Island families choose us.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { icon: '🎈', title: 'Zero Stress Setup', desc: 'We decorate before you arrive and clean up after you leave. You walk in to a perfectly styled space, walk out without touching a thing.' },
            { icon: '👶', title: 'Toddler-Safe Space', desc: 'Our studio is set up for little ones. Soft surfaces, low activities, and a calm environment so babies feel comfortable and parents feel at ease.' },
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

      {/* What's included */}
      <section className="bg-hampton-pink/10 py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <h2 className="section-heading text-center mb-2">Everything Included</h2>
          <p className="text-center text-hampton-navy mb-8">First birthday packages start at $850 for up to 10 guests.</p>
          <div className="bg-white rounded-2xl border border-hampton-pink/20 p-8 grid sm:grid-cols-2 gap-3">
            {included.map(item => (
              <div key={item} className="flex items-start gap-2">
                <Check size={16} className="text-hampton-navy shrink-0 mt-0.5" />
                <span className="text-hampton-navy text-sm">{item}</span>
              </div>
            ))}
          </div>
          <div className="text-center mt-8">
            <Link href="/party-add-ons"
                  className="text-hampton-navy underline text-sm hover:text-hampton-navy transition-colors">
              View full add-ons menu (character visits, photographers, cake smash setups +)
            </Link>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-16 max-w-4xl mx-auto px-4 sm:px-6 text-center">
        <h2 className="section-heading mb-2">Simple, Transparent Pricing</h2>
        <p className="text-hampton-navy mb-8">No hidden fees. Everything listed is included.</p>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { name: 'Mini First Birthday', guests: 'Up to 8 guests',  price: 650 },
            { name: 'First Birthday Fave', guests: 'Up to 10 guests', price: 800, popular: true },
            { name: 'Big ONE Bash',        guests: 'Up to 12 guests', price: 1045 },
          ].map(p => (
            <div key={p.name}
                 className={`rounded-2xl p-6 border-2 ${p.popular ? 'border-hampton-pink bg-hampton-pink/10' : 'bg-white border-hampton-pink/20'}`}>
              {p.popular && <p className="text-hampton-navy text-xs font-bold mb-2 uppercase tracking-wide">Most Popular</p>}
              <h3 className="font-serif text-hampton-navy text-base font-bold mb-1">{p.name}</h3>
              <p className="text-hampton-navy text-xs mb-4">{p.guests} • 2 hours</p>
              <p className="text-3xl font-bold text-hampton-navy">${p.price.toLocaleString()}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-gradient-to-r from-hampton-pink to-hampton-pink/30 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl text-hampton-navy text-center mb-8">First Birthday FAQ</h2>
          <div className="space-y-4">
            {[
              { q: 'How old does my child need to be?', a: 'We love first birthdays for babies as young as 6 months old. Our toddler setup is designed for babies and toddlers up to age 4.' },
              { q: 'Can I bring my own cake?', a: 'Absolutely! We include cupcakes in every package, and you\'re welcome to bring a smash cake from your favorite bakery.' },
              { q: 'What about siblings and very young guests?', a: 'Siblings of all ages are welcome. Our space is safe for babies and has activities for older kids too.' },
              { q: 'How far in advance should I book?', a: 'Weekend dates fill up fast — especially spring and summer. We recommend booking 6–8 weeks in advance. Your 25% deposit locks the date.' },
              { q: 'Can I change the date after booking?', a: 'Yes! Life with a baby is unpredictable. You can change your date up to 1 week before the party, subject to availability.' },
            ].map(f => (
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
          Let's Plan the Perfect First Birthday
        </h2>
        <p className="text-hampton-navy/70 text-base mb-8 max-w-md mx-auto">
          Reserve your date with a 25% deposit. We'll handle the rest — you enjoy every magical moment.
        </p>
        <Link href="/book?package=Toddler+Party&event_type=first-birthday"
              className="bg-hampton-navy text-hampton-ivory font-bold px-10 py-4 rounded-full text-base hover:bg-opacity-90 shadow-lg">
          Reserve Your Date Now
        </Link>
      </section>
    </>
  )
}
