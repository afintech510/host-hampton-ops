import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { MapPin, Home, Store, Truck, Palette, ChevronDown } from 'lucide-react'
import MobilePartyForm from '@/components/MobilePartyForm'
import { CRAFT_STATIONS } from '@/lib/craftStations'
import { locationsByRegion, LOCATIONS } from '@/lib/locations'
import { CRAFT_PARTIES } from '@/lib/craftParties'

const CANONICAL = 'https://www.hosthampton.com/mobile-craft-party'

export const metadata: Metadata = {
  title: 'Mobile Craft Party — Kids Arts & Crafts Parties Across Long Island',
  description:
    'Book a mobile craft party anywhere on Long Island. We bring hands-on arts & crafts — canvas painting, sand art, drip-paint balloon dogs, slime & more — to your home, or host at our Speonk studio. Serving the Hamptons to Nassau County.',
  keywords: [
    'mobile craft party',
    'mobile craft party near me',
    'kids craft party Long Island',
    'at home arts and crafts party',
    'mobile art party Long Island',
    'kids arts and crafts birthday party',
    'craft party Hamptons',
    'sand art party Long Island',
    'canvas painting party kids',
  ],
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: 'Mobile Craft Party — We Bring the Crafts to You',
    description:
      'Hands-on kids craft parties at your home or our Speonk studio. Canvas painting, sand art, balloon-dog drip painting, slime & more — anywhere on Long Island.',
    url: CANONICAL,
  },
}

const dualOptions = [
  {
    icon: Home,
    title: 'At Your House',
    desc: 'We pack up every station, drive to your home, backyard, park, or rental, set up, run the crafts, and clean it all up. You just enjoy the party.',
  },
  {
    icon: Store,
    title: 'At Our Speonk Studio',
    desc: 'Prefer to leave the mess with us? Book the same craft party in our private Hamptons celebration studio — decor, hosting, and cleanup all included.',
  },
]

const faqs = [
  {
    q: 'What is a mobile craft party?',
    a: 'It’s a hands-on arts-and-crafts birthday party we bring to you. Our team arrives with all the supplies, sets up your chosen craft stations, runs every activity with the kids, and packs everything up afterward. You can also host the exact same party at our Speonk studio if you’d rather not have it at home.',
  },
  {
    q: 'How far will you travel for a mobile craft party?',
    a: 'We serve all of Long Island — from Montauk and the East End through central Suffolk into Nassau County — and we’ll come into Manhattan and the boroughs for larger events. Parties within about 20 miles of our Speonk studio have no travel fee; beyond that a modest travel fee covers the drive.',
  },
  {
    q: 'What craft stations can we choose?',
    a: 'Mix and match any of our crafts — canvas painting, sand art, our signature drip-paint balloon dogs, slime, seashell decorating, bracelet making, canvas bag and trucker hat bars, and more. Every craft is a keepsake the kids take home, which doubles as the party favor.',
  },
  {
    q: 'What ages are craft parties good for?',
    a: 'Roughly ages 3 to 13. Younger kids love sand art, slime, and decorating; older kids gravitate to canvas painting, balloon-dog drip art, and jewelry making. We tailor the station mix to the birthday child’s age and group size.',
  },
  {
    q: 'How much space do we need at home?',
    a: 'A living room, garage, patio, or backyard works great — roughly 200–300 sq ft per station. We’ll help you plan the layout when you book, and we always have a rain backup for outdoor parties.',
  },
  {
    q: 'How far in advance should we book?',
    a: 'We recommend 2–4 weeks ahead, especially for spring and summer weekends and for parties in Nassau County or the city, which we schedule a bit further out.',
  },
]

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map(f => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
}

const serviceSchema = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  serviceType: 'Mobile kids craft party',
  name: 'Host Hampton Mobile Craft Party',
  description:
    'Hands-on mobile arts and crafts birthday parties brought to your home, or hosted at the Host Hampton studio in Speonk, NY. Serving Long Island from the Hamptons to Nassau County.',
  provider: {
    '@type': 'LocalBusiness',
    name: 'Host Hampton',
    telephone: '+1-631-998-9325',
    url: 'https://www.hosthampton.com',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '295 Montauk Highway, Suite 7',
      addressLocality: 'Speonk',
      addressRegion: 'NY',
      postalCode: '11972',
      addressCountry: 'US',
    },
  },
  areaServed: LOCATIONS.map(l => ({ '@type': 'City', name: `${l.name}, NY` })),
  url: CANONICAL,
}

export default function MobileCraftPartyHub() {
  const regions = locationsByRegion()

  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceSchema) }} />

      {/* ── Hero ── */}
      <section className="relative py-20 md:py-28 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center gap-12">
          <div className="flex-1 text-center md:text-left">
            <p className="text-[#c4975a] text-sm font-semibold tracking-widest uppercase mb-4">
              Mobile Craft Parties · All of Long Island
            </p>
            <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-hampton-navy leading-tight mb-6">
              Kids Craft Parties — <span className="italic text-hampton-blue">at Your House or Ours</span>
            </h1>
            <p className="text-hampton-navy/80 text-lg md:text-xl leading-relaxed mb-8 max-w-lg">
              We bring hands-on arts &amp; crafts — canvas painting, sand art, drip-paint balloon dogs, slime and more — straight to your home. Or host the same party at our Speonk studio. Every craft is a keepsake the kids take home.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
              <a href="#book" className="bg-hampton-navy text-white font-bold px-8 py-4 rounded-full text-base hover:bg-hampton-navy/90 transition-all shadow-lg hover:shadow-xl">
                Get a Quote
              </a>
              <a href="#crafts" className="border-2 border-hampton-navy/40 text-hampton-navy font-semibold px-8 py-4 rounded-full text-base hover:border-[#c4975a] transition-all">
                See the Crafts
              </a>
            </div>
            <div className="flex items-center gap-2 mt-6 justify-center md:justify-start text-hampton-navy/60 text-sm">
              <MapPin size={14} />
              <span>Hamptons &amp; the East End → Central Suffolk → Nassau County → NYC</span>
            </div>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-3 max-w-md w-full">
            {['/images/theme-slime.webp', '/images/gallery/venue-painting-workshop.webp', '/images/gallery/outdoor-party-setup.webp', '/images/theme-spa.webp'].map((src, i) => (
              <div key={i} className={`relative rounded-2xl overflow-hidden aspect-square shadow-xl ${i === 1 ? 'ring-2 ring-[#c4975a]' : ''}`}>
                <Image src={src} alt="Kids craft party" fill className="object-cover" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Two Ways ── */}
      <section className="bg-hampton-pink/10 py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <p className="section-subheading">Two Ways to Party</p>
            <h2 className="section-heading">Your House, or Our Studio</h2>
            <p className="text-hampton-navy/70 max-w-xl mx-auto">
              Same crafts, same hands-on hosts, same zero-cleanup promise. You pick the place.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-6">
            {dualOptions.map(o => (
              <div key={o.title} className="bg-white border border-hampton-pink/20 rounded-2xl p-8 text-center hover:shadow-md transition-shadow">
                <div className="w-14 h-14 bg-hampton-pink/20 rounded-full flex items-center justify-center mx-auto mb-5 text-hampton-navy">
                  <o.icon size={26} />
                </div>
                <h3 className="font-semibold text-hampton-navy text-xl mb-2">{o.title}</h3>
                <p className="text-hampton-navy/70 text-sm leading-relaxed">{o.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Crafts ── */}
      <section id="crafts" className="py-20 max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <p className="section-subheading">Hands-On &amp; Take-Home</p>
          <h2 className="section-heading">Pick Your Craft Stations</h2>
          <p className="text-hampton-navy/70 max-w-xl mx-auto">
            Mix and match as many as you like — we bring every supply and a host to run each one.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CRAFT_STATIONS.map(c => (
            <div key={c.name} className="bg-white border border-hampton-pink/20 rounded-2xl p-5 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl" role="img" aria-label={c.name}>{c.emoji}</span>
                <h3 className="font-semibold text-hampton-navy text-base">{c.name}</h3>
              </div>
              <p className="text-hampton-navy/70 text-sm leading-relaxed">{c.blurb}</p>
            </div>
          ))}
        </div>
        <div className="mt-10">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-hampton-navy/40 mb-4">
            Popular Party Types
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {[...CRAFT_PARTIES.map(c => ({ href: `/${c.slug}`, label: c.name })), { href: '/glow-party', label: 'Glow Party' }].map(l => (
              <Link key={l.href} href={l.href} className="bg-white border border-hampton-pink/20 rounded-full px-4 py-2 text-xs font-medium text-hampton-navy hover:border-[#c4975a]/50 hover:text-hampton-blue transition-colors">
                {l.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-sm text-hampton-navy/60">
            Want the full menu — spa, glam, photobooth and more?{' '}
            <Link href="/mobile-party" className="text-hampton-blue font-semibold underline underline-offset-2">See all mobile party stations →</Link>
          </p>
        </div>
      </section>

      {/* ── Where We Go (locations) ── */}
      <section className="bg-hampton-pink/10 py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <p className="section-subheading">We Come to You</p>
            <h2 className="section-heading">Mobile Craft Parties Across Long Island</h2>
            <p className="text-hampton-navy/70 max-w-2xl mx-auto">
              From East Hampton to Nassau County — and into Manhattan for the right event. Find your town for local details, or just{' '}
              <a href="#book" className="text-hampton-blue font-semibold underline underline-offset-2">request a quote</a>.
            </p>
          </div>
          <div className="space-y-10">
            {regions.map(group => (
              <div key={group.region}>
                <h3 className="font-serif text-lg text-hampton-navy mb-4 flex items-center gap-2">
                  <Truck size={16} className="text-hampton-navy/50" />
                  {group.region}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {group.items.map(loc => (
                    <Link
                      key={loc.slug}
                      href={`/mobile-craft-party/${loc.slug}`}
                      className="bg-white border border-hampton-pink/20 rounded-xl px-4 py-3 text-sm font-medium text-hampton-navy hover:border-[#c4975a]/50 hover:text-hampton-blue transition-colors flex items-center justify-between gap-2"
                    >
                      <span>{loc.name}</span>
                      <MapPin size={12} className="text-hampton-navy/30 shrink-0" />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Contact Form ── */}
      <section id="book" className="bg-gradient-to-r from-hampton-pink/20 to-hampton-ivory py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <p className="section-subheading">Let’s Make It Happen</p>
            <h2 className="section-heading">Request Your Craft Party</h2>
            <p className="text-hampton-navy/70 max-w-lg mx-auto">
              Tell us your town, date, and which crafts you love — we’ll send a custom quote, usually within 24 hours.
            </p>
          </div>
          <div className="max-w-2xl mx-auto">
            <MobilePartyForm />
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-20 max-w-3xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <p className="section-subheading">Good to Know</p>
          <h2 className="section-heading">Mobile Craft Party FAQ</h2>
        </div>
        <div className="space-y-3">
          {faqs.map(faq => (
            <details key={faq.q} className="group rounded-xl border border-hampton-pink/20 bg-white open:border-[#c4975a]/40 transition-all">
              <summary className="flex items-center justify-between gap-4 p-5 cursor-pointer list-none font-semibold text-hampton-navy text-sm">
                {faq.q}
                <ChevronDown size={16} className="shrink-0 text-hampton-navy/40 group-open:rotate-180 transition-transform" />
              </summary>
              <p className="px-5 pb-5 text-hampton-navy/70 text-sm leading-relaxed">{faq.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="bg-gradient-to-r from-hampton-pink to-hampton-mauve py-16">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-4 flex items-center justify-center gap-3">
            <Palette size={30} /> Ready to Get Crafty?
          </h2>
          <p className="text-hampton-navy/70 text-base mb-8">
            Book a mobile craft party at your place — or ours. Fill out the form above or call us directly.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="#book" className="bg-hampton-navy text-hampton-ivory font-bold px-10 py-4 rounded-full text-base hover:bg-opacity-90 transition-all shadow-xl">
              Get Your Free Quote
            </a>
            <a href="tel:6319989325" className="border-2 border-hampton-navy/40 text-hampton-navy font-semibold px-10 py-4 rounded-full text-base hover:border-[#c4975a] transition-all">
              Call (631) 998-9325
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
