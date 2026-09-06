import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import UniversalCalendar from '@/components/UniversalCalendar'

export const metadata: Metadata = {
  title: 'Permanent Jewelry — Long Island (Speonk, NY)',
  description: 'Custom-welded permanent bracelets, anklets, and necklaces on Long Island — at Host Hampton in Speonk, NY. Perfect for moms & daughters, bachelorettes, and birthday parties. Starting at $65.',
}

const types = [
  { name: 'Bracelets', price: 'Starting at $65', img: '/images/jewelry-gold.png',  desc: 'The classic. Sized perfectly to your wrist, clasp-free forever.' },
  { name: 'Anklets',   price: 'Starting at $70', img: '/images/jewelry-weld.png',  desc: 'Delicate and dainty — perfect for summer in the Hamptons.' },
  { name: 'Necklaces', price: 'Starting at $85', img: '/images/jewelry-gold.png',  desc: 'Wear your story close to your heart.' },
  { name: 'Ring Stacks', price: 'Starting at $45', img: '/images/jewelry-gold.png', desc: 'Stack them up. Mix metals, mix styles.' },
]

export default function PermanentJewelry() {
  return (
    <div>
      <section className="py-20 text-center px-4">
        <h1 className="font-serif text-4xl md:text-5xl text-hampton-navy mb-4">Permanent Jewelry</h1>
        <p className="text-hampton-navy text-lg max-w-xl mx-auto mb-8">
          Custom-welded jewelry that stays with you forever. No clasp. No fuss. Just beautiful.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/book?event_type=jewelry" className="bg-hampton-pink text-hampton-navy font-bold px-8 py-4 rounded-full hover:bg-opacity-90 shadow-lg">
            Book a Jewelry Session
          </Link>
          <Link href="/contact-us" className="border-2 border-hampton-navy/40 text-hampton-navy font-semibold px-8 py-4 rounded-full hover:border-hampton-pink transition-all">
            Add to Your Party
          </Link>
        </div>
      </section>

      <section className="py-16 max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <h2 className="section-heading">Choose Your Jewelry</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {types.map(t => (
            <div key={t.name} className="card">
              <div className="relative aspect-square overflow-hidden">
                <Image src={t.img} alt={t.name} fill className="object-cover" />
              </div>
              <div className="p-5">
                <h3 className="font-semibold text-hampton-navy text-base mb-1">{t.name}</h3>
                <p className="text-hampton-navy text-sm mb-2">{t.price}</p>
                <p className="text-hampton-navy/60 text-xs leading-relaxed">{t.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Check Availability */}
      <section className="py-14 max-w-2xl mx-auto px-4 sm:px-6">
        <UniversalCalendar
          mode="booking"
          lockedBookingType="perm-jewelry"
          expandable={true}
          initialExpanded={false}
        />
      </section>

      <section className="bg-hampton-pink/10 py-14 text-center px-4">
        <h2 className="section-heading mb-3">Perfect for Groups</h2>
        <p className="text-hampton-navy max-w-lg mx-auto mb-7 text-base">
          Mommy & Me bracelets ($100), bachelorette groups, birthday parties — permanent jewelry is the most memorable party favor you'll ever give.
        </p>
        <Link href="/party-add-ons" className="btn-secondary mr-4">Add to a Party Package</Link>
        <Link href="/book?event_type=jewelry" className="btn-primary">Book a Standalone Session</Link>
      </section>
    </div>
  )
}
