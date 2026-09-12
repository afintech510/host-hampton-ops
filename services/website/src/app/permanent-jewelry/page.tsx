import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import UniversalCalendar from '@/components/UniversalCalendar'

export const metadata: Metadata = {
  title: 'Permanent Jewelry — Long Island (Speonk, NY)',
  description: 'Custom-welded permanent bracelets, anklets and necklaces at Host Hampton in Speonk, NY. Moms & daughters, bachelorettes, parties. From $65.',
}

const types = [
  { name: 'Bracelets', price: 'Starting at $65', img: '/images/jewelry-gold.png',  desc: 'The classic. Sized perfectly to your wrist, clasp-free forever.' },
  { name: 'Anklets',   price: 'Starting at $70', img: '/images/jewelry-weld.png',  desc: 'Delicate and dainty — perfect for summer in the Hamptons.' },
  { name: 'Necklaces', price: 'Starting at $85', img: '/images/jewelry-gold.png',  desc: 'Wear your story close to your heart.' },
  { name: 'Ring Stacks', price: 'Starting at $45', img: '/images/jewelry-gold.png', desc: 'Stack them up. Mix metals, mix styles.' },
]

const jewelryFaqs = [
  {
    q: 'What is permanent jewelry?',
    a: 'A chain sized to your wrist, ankle, neck or finger and micro-welded closed — no clasp. It stays on through showering, swimming and sleeping. It is not truly permanent: it can be removed any time with a small snip, and we can re-weld it later.',
  },
  {
    q: 'Can you do permanent jewelry at my house or party?',
    a: 'Yes. We bring the full welding setup to your home or venue anywhere on Long Island — the Hamptons and both forks, central Suffolk, and Nassau County. It is a favorite add-on for bridal and baby showers, bachelorettes, girls’ nights and milestone birthdays. You can also book our Speonk studio for the group instead.',
  },
  {
    q: 'How much does a permanent jewelry party cost?',
    a: 'Pieces start at $65 for bracelets, $70 anklets, $85 necklaces and $45 ring stacks, and each guest pays for their own piece. Mommy & Me bracelet pairs are $100. For groups at your location we quote based on group size and travel — ask and we will send it, usually within 24 hours.',
  },
  {
    q: 'How long does each piece take?',
    a: 'About 5–10 minutes per person once they have chosen a chain, so a group moves quickly. We will help you plan timing based on your headcount.',
  },
  {
    q: 'Is the welding safe?',
    a: 'Yes. It is a quick, low-heat micro-weld with a protective barrier between the chain and your skin — most people describe it as a tiny pinch of warmth, if they feel anything at all.',
  },
]

const jewelryFaqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: jewelryFaqs.map(f => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
}

export default function PermanentJewelry() {
  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jewelryFaqSchema).replace(/</g, '\\u003c') }}
      />
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
                <Image src={t.img} alt={t.name} fill sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw" className="object-cover" />
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

      {/* ── Parties: studio or at your home (B-4) ── */}
      <section className="bg-hampton-pink/10 py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <p className="section-subheading">Groups &amp; Parties</p>
            <h2 className="section-heading mb-3">Permanent Jewelry Parties — at Our Studio or Your Home</h2>
            <p className="text-hampton-navy/75 max-w-2xl mx-auto text-base leading-relaxed">
              Mommy &amp; Me bracelets ($100), bachelorette and bridal groups, milestone birthdays, girls&apos; nights
              and team celebrations. Everyone picks their chain, we size and weld it on the spot, and it goes home
              on their wrist — the most memorable party favor you&apos;ll ever give.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-6 mb-10">
            <div className="bg-white border border-hampton-pink/20 rounded-2xl p-7">
              <h3 className="font-semibold text-hampton-navy text-lg mb-2">At Our Speonk Studio</h3>
              <p className="text-hampton-navy/70 text-sm leading-relaxed">
                Book the studio for your group — a private, styled space on the East End with the welding
                station already set up. Pairs naturally with a bridal or baby shower.
              </p>
            </div>
            <div className="bg-white border border-hampton-pink/20 rounded-2xl p-7">
              <h3 className="font-semibold text-hampton-navy text-lg mb-2">At Your Home or Venue</h3>
              <p className="text-hampton-navy/70 text-sm leading-relaxed">
                We bring the full welding setup to you — anywhere on Long Island, from the Hamptons and the
                forks through central Suffolk into Nassau. Ideal for showers, bachelorettes and house parties.
              </p>
            </div>
          </div>

          <div className="text-center">
            <Link href="/party-add-ons" className="btn-secondary mr-4">Add to a Party Package</Link>
            <Link href="/book?event_type=jewelry" className="btn-primary">Book a Session</Link>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-16 max-w-3xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <p className="section-subheading">Good to Know</p>
          <h2 className="section-heading">Permanent Jewelry FAQ</h2>
        </div>
        <div className="space-y-3">
          {jewelryFaqs.map(faq => (
            <details key={faq.q} className="group rounded-xl border border-hampton-pink/20 bg-white open:border-[#c4975a]/40 transition-all">
              <summary className="flex items-center justify-between gap-4 p-5 cursor-pointer list-none font-semibold text-hampton-navy text-sm">
                {faq.q}
                <span className="shrink-0 text-hampton-navy/40 group-open:rotate-180 transition-transform">▾</span>
              </summary>
              <p className="px-5 pb-5 text-hampton-navy/70 text-sm leading-relaxed">{faq.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  )
}
