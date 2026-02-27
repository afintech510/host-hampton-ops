import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { Check, MapPin, PartyPopper, Sparkles, Users, Clock, Truck, Heart, ChevronDown } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Mobile Party — We Bring the Party to You | Host Hampton',
  description:
    'Host Hampton brings themed birthday parties, activities, and entertainment directly to your home, backyard, or venue. Full-service mobile party packages starting at $650 in the Hamptons & Long Island.',
  keywords: [
    'mobile party Long Island',
    'at home birthday party Hamptons',
    'mobile birthday party service NY',
    'backyard party entertainment Speonk',
    'traveling party company Long Island',
    'mobile kids party Hamptons',
  ],
  openGraph: {
    title: 'Mobile Party — We Bring the Party to You | Host Hampton',
    description:
      'Themed birthday parties delivered to your door. Professional hosts, activities, decor & cleanup — all at your location.',
  },
}

const whyMobile = [
  { icon: Truck,       title: 'We Come to You',        desc: 'Your home, backyard, park, or venue — we set up wherever you want to celebrate.' },
  { icon: PartyPopper, title: 'Full-Service Fun',       desc: 'Activities, entertainment, and a dedicated party host. We run the show so you can relax.' },
  { icon: Sparkles,    title: 'Themed Decor Included',  desc: 'We arrive with decorations, supplies, and everything needed to transform your space.' },
  { icon: Heart,       title: 'Zero Cleanup',           desc: 'When the party ends, we pack up everything. Your space goes back to normal.' },
]

const howItWorks = [
  { n: '01', title: 'Choose Your Package',   desc: 'Pick the mobile party package that fits your group. Add themed decor or extra activities.' },
  { n: '02', title: 'Share Your Location',   desc: 'Tell us where, when, and what you\'re celebrating. We handle all the logistics.' },
  { n: '03', title: 'We Arrive & Set Up',    desc: 'Our team shows up early with everything. Decor goes up, activities are prepped, and you greet your guests stress-free.' },
  { n: '04', title: 'Celebrate & Enjoy',     desc: 'Our host runs the party — games, crafts, entertainment. When it\'s over, we clean up and disappear.' },
]

const packages = [
  {
    name: 'Activity Pack',
    sub: 'Entertainment & host only',
    price: 650,
    hours: 1.5,
    includes: [
      'Professional party host',
      '2–3 themed activities & games',
      'All craft supplies & materials',
      'Music & party energy',
      'Setup & cleanup of activity area',
    ],
  },
  {
    name: 'Party Pack',
    sub: 'Activities + themed decor',
    price: 950,
    hours: 2,
    popular: true,
    includes: [
      'Everything in Activity Pack',
      'Themed balloon display & table decor',
      'Coordinated tablecloths, plates, napkins',
      'Party favors for each guest',
      'Photo-worthy setup for pictures',
      'Extended 2-hour party time',
    ],
  },
  {
    name: 'Full Service',
    sub: 'The complete mobile experience',
    price: 1350,
    hours: 2.5,
    includes: [
      'Everything in Party Pack',
      'Premium themed backdrop & decorations',
      'Additional host for larger groups',
      'Cupcakes or cake coordination',
      '2.5-hour extended party time',
      'Custom signage with birthday child\'s name',
    ],
  },
]

const perfectFor = [
  '🏡 Backyard Birthday Parties',
  '🌳 Park & Outdoor Celebrations',
  '🏘 Community Center Events',
  '🏫 School & Classroom Parties',
  '🎄 Holiday Parties at Home',
  '👶 First Birthday Celebrations',
  '🏖 Beach House Gatherings',
  '🏢 Corporate Family Events',
]

const addOns = [
  { name: 'Themed Face Painting',    price: '$75',       desc: 'Professional face painter for your party theme.' },
  { name: 'Balloon Twisting',        price: '$75',       desc: 'Custom balloon animals & creations for every guest.' },
  { name: 'Extra Activity Station',  price: '$100',      desc: 'Add another craft or game station to the lineup.' },
  { name: 'Premium Decor Upgrade',   price: '$150',      desc: 'Upgraded backdrop, florals, and coordinated styling.' },
  { name: 'Additional Host',         price: '$125/hr',   desc: 'Extra hands for larger groups (20+ guests).' },
  { name: 'Extended Time',           price: '$125/hr',   desc: 'Keep the fun going with additional party hours.' },
]

const faqs = [
  {
    q: 'How far will you travel?',
    a: 'We travel throughout the Hamptons, Long Island, and surrounding areas. Parties within 20 miles of Speonk are included. Beyond that, a small travel fee may apply — just ask!',
  },
  {
    q: 'What space do I need at my location?',
    a: 'For most packages, a living room, garage, backyard, or patio works great. We need roughly 200–300 sq ft for activities and decor. We\'ll help you figure out the best setup during planning.',
  },
  {
    q: 'What happens if it rains (for outdoor parties)?',
    a: 'We always have a backup plan! If your party is outdoors, we can move activities inside or set up under a covered area. We\'ll coordinate with you ahead of time so there\'s no stress on party day.',
  },
  {
    q: 'Do you bring tables and chairs?',
    a: 'Our mobile packages assume you have basic seating and a table at your location. If you need tables or chairs, let us know and we can coordinate rentals for you.',
  },
  {
    q: 'Can I choose a specific party theme?',
    a: 'Absolutely! We offer all of our studio themes for mobile parties — Glow, Swiftie, Spa, Slime, K-Pop, Barbie, and more. We\'ll adapt the decor and activities to work at your location.',
  },
  {
    q: 'How far in advance should I book?',
    a: 'We recommend booking 2–4 weeks in advance, especially for weekends. A $99 deposit secures your date, and you can finalize details later.',
  },
]

export default function MobilePartyPage() {
  return (
    <div>
      {/* ── Hero ── */}
      <section className="relative py-20 md:py-28 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center gap-12">
          <div className="flex-1 text-center md:text-left">
            <p className="text-[#c4975a] text-sm font-semibold tracking-widest uppercase mb-4">
              New — Mobile Party Service
            </p>
            <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-hampton-navy leading-tight mb-6">
              We Bring the Party <br className="hidden sm:block" />
              <span className="italic text-hampton-blue">to You</span>
            </h1>
            <p className="text-hampton-navy/80 text-lg md:text-xl leading-relaxed mb-8 max-w-lg">
              Our party helpers, activities, and themed decor — delivered to your home, backyard, or any venue.
              You provide the space. We provide the magic.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
              <Link
                href="/contact-us"
                className="bg-hampton-navy text-white font-bold px-8 py-4 rounded-full text-base hover:bg-hampton-navy/90 transition-all shadow-lg hover:shadow-xl"
              >
                Get a Quote
              </Link>
              <a
                href="#packages"
                className="border-2 border-hampton-navy/40 text-hampton-navy font-semibold px-8 py-4 rounded-full text-base hover:border-[#c4975a] transition-all"
              >
                See Packages
              </a>
            </div>
            <div className="flex items-center gap-2 mt-6 justify-center md:justify-start text-hampton-navy/60 text-sm">
              <MapPin size={14} />
              <span>Serving the Hamptons, Long Island & surrounding areas</span>
            </div>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-3 max-w-md w-full">
            {['/images/theme-glow.png', '/images/theme-swiftie.png', '/images/theme-spa.png', '/images/theme-slime.png'].map((src, i) => (
              <div key={i} className={`relative rounded-2xl overflow-hidden aspect-square shadow-xl ${i === 1 ? 'ring-2 ring-[#c4975a]' : ''}`}>
                <Image src={src} alt="Mobile party theme" fill className="object-cover" />
                {i === 1 && (
                  <div className="absolute inset-0 bg-hampton-navy/40 flex items-center justify-center">
                    <span className="text-white font-bold text-sm bg-[#c4975a] px-3 py-1 rounded-full">At Your Home</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why Mobile ── */}
      <section className="bg-hampton-pink/10 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <p className="section-subheading">Why Go Mobile?</p>
            <h2 className="section-heading">All the Fun — None of the Travel</h2>
            <p className="text-hampton-navy/70 max-w-xl mx-auto">
              Same Host Hampton quality. Same stress-free experience. Just at your location instead of ours.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {whyMobile.map(w => (
              <div key={w.title} className="bg-white border border-hampton-pink/20 rounded-2xl p-6 text-center hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-hampton-pink/20 rounded-full flex items-center justify-center mx-auto mb-4 text-hampton-navy">
                  <w.icon size={22} />
                </div>
                <h3 className="font-semibold text-hampton-navy text-base mb-2">{w.title}</h3>
                <p className="text-hampton-navy/70 text-sm leading-relaxed">{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <p className="section-subheading">Simple & Stress-Free</p>
            <h2 className="section-heading">How It Works</h2>
          </div>
          <div className="grid md:grid-cols-4 gap-8">
            {howItWorks.map(s => (
              <div key={s.n} className="text-center">
                <div className="text-5xl font-serif text-[#c4975a]/30 mb-3">{s.n}</div>
                <h3 className="font-semibold text-hampton-navy text-lg mb-2">{s.title}</h3>
                <p className="text-hampton-navy/70 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Packages ── */}
      <section id="packages" className="bg-gradient-to-r from-hampton-pink to-hampton-pink/30 py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <p className="text-hampton-navy text-sm font-semibold tracking-widest uppercase mb-2">Choose Your Level</p>
            <h2 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-4">Mobile Party Packages</h2>
            <p className="text-hampton-navy/70 max-w-md mx-auto">
              Every package includes a professional host, activities, and complete setup & cleanup at your location.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {packages.map(pkg => (
              <div
                key={pkg.name}
                className={`rounded-2xl p-6 ${
                  pkg.popular
                    ? 'bg-white border-2 border-[#c4975a] shadow-lg relative'
                    : 'bg-white border border-hampton-pink/30'
                }`}
              >
                {pkg.popular && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#c4975a] text-white text-xs font-bold px-3 py-1 rounded-full">
                    Most Popular
                  </span>
                )}
                <h3 className="font-serif text-hampton-navy text-xl font-bold mb-1">{pkg.name}</h3>
                <p className="text-hampton-navy/60 text-xs mb-4">{pkg.sub}</p>
                <p className="text-3xl font-bold text-hampton-navy mb-1">${pkg.price.toLocaleString()}</p>
                <p className="text-hampton-navy/50 text-xs mb-5">up to 10 guests · {pkg.hours} hrs</p>
                <ul className="space-y-2 mb-6">
                  {pkg.includes.map(item => (
                    <li key={item} className="flex items-start gap-2 text-sm text-hampton-navy">
                      <Check size={14} className="shrink-0 mt-0.5 text-[#c4975a]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/contact-us"
                  className={`block w-full text-center py-3 rounded-full font-bold text-sm transition-all ${
                    pkg.popular
                      ? 'bg-hampton-navy text-white hover:bg-hampton-navy/90'
                      : 'border-2 border-hampton-navy/30 text-hampton-navy hover:border-[#c4975a]'
                  }`}
                >
                  Get a Quote
                </Link>
              </div>
            ))}
          </div>
          <p className="text-center text-hampton-navy/50 text-sm mt-6">
            Additional guests: $25/guest. All themes available. Travel within 20 mi included.
          </p>
        </div>
      </section>

      {/* ── Perfect For ── */}
      <section className="py-20 max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <p className="section-subheading">Endless Possibilities</p>
          <h2 className="section-heading">Perfect For</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {perfectFor.map(u => (
            <div key={u} className="bg-white border border-hampton-pink/20 rounded-xl px-4 py-3 text-sm text-hampton-navy font-medium text-center hover:border-[#c4975a]/40 transition-colors">
              {u}
            </div>
          ))}
        </div>
      </section>

      {/* ── Add-Ons ── */}
      <section className="bg-hampton-pink/10 py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <p className="section-subheading">Customize Your Party</p>
            <h2 className="section-heading">Add-Ons</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {addOns.map(a => (
              <div key={a.name} className="bg-white rounded-xl border border-hampton-pink/20 p-5 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between gap-4 mb-1">
                  <h3 className="font-semibold text-hampton-navy">{a.name}</h3>
                  <span className="shrink-0 text-[#c4975a] font-bold text-sm">{a.price}</span>
                </div>
                <p className="text-hampton-navy/60 text-sm">{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-20 max-w-3xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <p className="section-subheading">Questions?</p>
          <h2 className="section-heading">Mobile Party FAQ</h2>
        </div>
        <div className="space-y-3">
          {faqs.map(faq => (
            <details
              key={faq.q}
              className="group rounded-xl border border-hampton-pink/20 bg-white open:border-[#c4975a]/40 transition-all"
            >
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
          <h2 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-4">
            Ready to Party at Your Place?
          </h2>
          <p className="text-hampton-navy/70 text-base mb-8">
            Tell us about your event and we&apos;ll put together a custom mobile party quote. No pressure, no commitment.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/contact-us"
              className="bg-hampton-navy text-hampton-ivory font-bold px-10 py-4 rounded-full text-base hover:bg-opacity-90 transition-all shadow-xl"
            >
              Get Your Free Quote
            </Link>
            <a
              href="tel:6319989325"
              className="border-2 border-hampton-navy/40 text-hampton-navy font-semibold px-10 py-4 rounded-full text-base hover:border-[#c4975a] transition-all"
            >
              Call (631) 998-9325
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
