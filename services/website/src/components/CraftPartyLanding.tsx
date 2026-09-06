import Link from 'next/link'
import Image from 'next/image'
import { MapPin, Home, Store, Truck, Phone, ChevronDown, ArrowRight } from 'lucide-react'
import MobilePartyForm from '@/components/MobilePartyForm'
import { LOCATIONS } from '@/lib/locations'
import { type CraftParty, craftDisplayName } from '@/lib/craftParties'

const BASE = 'https://www.hosthampton.com'

// A curated marquee of towns for the "where we go" strip (one per area).
const MARQUEE_SLUGS = ['east-hampton', 'southampton', 'montauk', 'riverhead', 'patchogue', 'huntington', 'garden-city', 'manhattan']

function relatedHref(slug: string): string {
  return `/${slug}` // craft pages + /glow-party all live at top-level slugs
}

export default function CraftPartyLanding({ data }: { data: CraftParty }) {
  const url = `${BASE}/${data.slug}`
  const mobile = data.venue === 'both' || data.venue === 'mobile'

  // Render the H1 with the accent word(s) emphasized IN PLACE (preserving order).
  const accentIdx = data.h1Accent ? data.name.indexOf(data.h1Accent) : -1
  const h1 = data.h1Accent && accentIdx !== -1
    ? {
        before: data.name.slice(0, accentIdx),
        accent: data.h1Accent,
        after: data.name.slice(accentIdx + data.h1Accent.length),
      }
    : null

  const serviceSchema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    serviceType: data.serviceType,
    name: `${data.name} — Host Hampton`,
    description: data.metaDescription,
    provider: {
      '@type': 'LocalBusiness',
      name: 'Host Hampton',
      telephone: '+1-631-998-9325',
      url: BASE,
      address: {
        '@type': 'PostalAddress',
        streetAddress: '295 Montauk Highway, Suite 7',
        addressLocality: 'Speonk',
        addressRegion: 'NY',
        postalCode: '11972',
        addressCountry: 'US',
      },
    },
    areaServed: mobile ? { '@type': 'AdministrativeArea', name: 'Long Island, NY' } : { '@type': 'City', name: 'Speonk, NY' },
    url,
  }
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: data.faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }

  // A-8: breadcrumbs on every craft landing page (one edit covers all of them).
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: BASE },
      { '@type': 'ListItem', position: 2, name: data.name, item: url },
    ],
  }

  const prefill = `Interested in: ${data.name}\nParty location (town): \nDate / guest count: `
  const marquee = MARQUEE_SLUGS.map(s => LOCATIONS.find(l => l.slug === s)).filter(Boolean) as typeof LOCATIONS

  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceSchema).replace(/</g, '\\u003c') }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema).replace(/</g, '\\u003c') }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema).replace(/</g, '\\u003c') }} />

      {/* ── Hero ── */}
      <section className="relative py-20 md:py-28 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center gap-12">
          <div className="flex-1 text-center md:text-left">
            <p className="text-[#c4975a] text-sm font-semibold tracking-widest uppercase mb-4">{data.eyebrow}</p>
            <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-hampton-navy leading-tight mb-6">
              {h1 ? (
                <>
                  {h1.before}
                  <span className="italic text-hampton-blue">{h1.accent}</span>
                  {h1.after}
                </>
              ) : (
                data.name
              )}
            </h1>
            <p className="text-hampton-navy/80 text-lg md:text-xl leading-relaxed mb-6 max-w-lg">{data.intro}</p>
            <span className="inline-block bg-hampton-pink/20 text-hampton-navy text-xs font-semibold px-4 py-1.5 rounded-full mb-8">
              {data.audience}
            </span>
            <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
              <a href="#book" className="bg-hampton-navy text-white font-bold px-8 py-4 rounded-full text-base hover:bg-hampton-navy/90 transition-all shadow-lg hover:shadow-xl">
                Get a Quote
              </a>
              <a href="tel:6319989325" className="border-2 border-hampton-navy/40 text-hampton-navy font-semibold px-8 py-4 rounded-full text-base hover:border-[#c4975a] transition-all inline-flex items-center justify-center gap-2">
                <Phone size={16} /> (631) 998-9325
              </a>
            </div>
            {mobile && (
              <div className="flex items-center gap-2 mt-6 justify-center md:justify-start text-hampton-navy/60 text-sm">
                <MapPin size={14} />
                <span>At your home across Long Island — or our Speonk studio</span>
              </div>
            )}
          </div>
          <div className="flex-1 grid grid-cols-2 gap-3 max-w-md w-full">
            {data.heroImages.slice(0, 4).map((src, i) => (
              <div key={i} className={`relative rounded-2xl overflow-hidden aspect-square shadow-xl ${i === 0 ? 'ring-2 ring-[#c4975a]' : ''}`}>
                <Image src={src} alt={`${data.name} at Host Hampton`} fill className="object-cover" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Highlights ── */}
      <section className="bg-hampton-pink/10 py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <p className="section-subheading">The Details</p>
            <h2 className="section-heading">{data.highlightsTitle}</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {data.highlights.map(h => (
              <div key={h.title} className="bg-white border border-hampton-pink/20 rounded-2xl p-6 text-center hover:shadow-md transition-shadow">
                <div className="text-3xl mb-3" role="img" aria-label={h.title}>{h.emoji}</div>
                <h3 className="font-semibold text-hampton-navy text-base mb-2">{h.title}</h3>
                <p className="text-hampton-navy/70 text-sm leading-relaxed">{h.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Venue band ── */}
      <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6">
        <div className="bg-gradient-to-br from-hampton-blue/10 to-hampton-pink/10 rounded-3xl border border-hampton-blue/20 p-8 md:p-10">
          {data.venue === 'both' && (
            <div className="text-center">
              <p className="section-subheading">You Pick the Place</p>
              <h2 className="font-serif text-2xl md:text-3xl text-hampton-navy mb-3">At Your House — or Our Studio</h2>
              <p className="text-hampton-navy/70 text-sm md:text-base max-w-2xl mx-auto mb-6 leading-relaxed">
                We bring the full {data.name.toLowerCase()} to your home anywhere on Long Island — from East Hampton to Nassau County, and into Manhattan for larger events — or you can host it at our private celebration studio in Speonk.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link href="/mobile-craft-party" className="bg-hampton-navy text-white font-bold px-7 py-3.5 rounded-full text-sm hover:bg-hampton-navy/90 transition-all shadow-lg inline-flex items-center justify-center gap-2">
                  Find Your Town <ArrowRight size={15} />
                </Link>
                <Link href="/party-room-rental" className="border-2 border-hampton-navy/30 text-hampton-navy font-semibold px-7 py-3.5 rounded-full text-sm hover:border-[#c4975a] transition-all inline-flex items-center justify-center gap-2">
                  <Store size={15} /> Host at Our Studio
                </Link>
              </div>
            </div>
          )}
          {data.venue === 'studio' && (
            <div className="text-center">
              <p className="section-subheading">In the Heart of the Hamptons</p>
              <h2 className="font-serif text-2xl md:text-3xl text-hampton-navy mb-3">Hosted at Our Speonk Studio</h2>
              <p className="text-hampton-navy/70 text-sm md:text-base max-w-2xl mx-auto mb-6 leading-relaxed">
                Your private, styled space on the East End at 295 Montauk Highway, Speonk. Prefer to keep it at home? We can bring the crafts to you, too.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link href="/book" className="bg-hampton-navy text-white font-bold px-7 py-3.5 rounded-full text-sm hover:bg-hampton-navy/90 transition-all shadow-lg">
                  Check Available Dates
                </Link>
                <Link href="/mobile-craft-party" className="border-2 border-hampton-navy/30 text-hampton-navy font-semibold px-7 py-3.5 rounded-full text-sm hover:border-[#c4975a] transition-all inline-flex items-center justify-center gap-2">
                  <Home size={15} /> Bring It to Us Instead
                </Link>
              </div>
            </div>
          )}
          {data.venue === 'mobile' && (
            <div className="text-center">
              <p className="section-subheading">We Come to You</p>
              <h2 className="font-serif text-2xl md:text-3xl text-hampton-navy mb-3">On-Site, Anywhere in NY &amp; Long Island</h2>
              <p className="text-hampton-navy/70 text-sm md:text-base max-w-2xl mx-auto mb-6 leading-relaxed">
                We bring the full station and staff to your venue — offices, storefronts, event spaces, and pop-ups across Long Island and into the city.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <a href="#book" className="bg-hampton-navy text-white font-bold px-7 py-3.5 rounded-full text-sm hover:bg-hampton-navy/90 transition-all shadow-lg">
                  Request Availability
                </a>
                <Link href="/mobile-craft-party" className="border-2 border-hampton-navy/30 text-hampton-navy font-semibold px-7 py-3.5 rounded-full text-sm hover:border-[#c4975a] transition-all inline-flex items-center justify-center gap-2">
                  <Truck size={15} /> See Where We Go
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Where we go (mobile-capable only) ── */}
      {mobile && (
        <section className="pb-8 max-w-5xl mx-auto px-4 sm:px-6">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-hampton-navy/40 mb-4">
            {data.name} · Serving Long Island
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {marquee.map(loc => (
              <Link key={loc.slug} href={`/mobile-craft-party/${loc.slug}`} className="bg-white border border-hampton-pink/20 rounded-full px-4 py-2 text-xs font-medium text-hampton-navy hover:border-[#c4975a]/50 hover:text-hampton-blue transition-colors inline-flex items-center gap-1.5">
                <MapPin size={11} className="text-hampton-navy/30" /> {loc.name}
              </Link>
            ))}
            <Link href="/mobile-craft-party" className="bg-hampton-navy text-white rounded-full px-4 py-2 text-xs font-semibold hover:bg-hampton-navy/90 transition-colors inline-flex items-center gap-1.5">
              All towns <ArrowRight size={12} />
            </Link>
          </div>
        </section>
      )}

      {/* ── Contact Form ── */}
      <section id="book" className="bg-gradient-to-r from-hampton-pink/20 to-hampton-ivory py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <p className="section-subheading">Let’s Make It Happen</p>
            <h2 className="section-heading">Request Your {data.name}</h2>
            <p className="text-hampton-navy/70 max-w-lg mx-auto">
              Tell us your date, town, and group size — we’ll send a custom quote, usually within 24 hours.
            </p>
          </div>
          <div className="max-w-2xl mx-auto">
            <MobilePartyForm prefillDetails={prefill} />
          </div>
        </div>
      </section>

      {/* ── Related crafts ── */}
      {data.relatedSlugs.length > 0 && (
        <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-8">
            <p className="section-subheading">More Ways to Celebrate</p>
            <h2 className="section-heading">You Might Also Love</h2>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {data.relatedSlugs.map(slug => (
              <Link key={slug} href={relatedHref(slug)} className="bg-white border border-hampton-pink/20 rounded-full px-5 py-2.5 text-sm font-medium text-hampton-navy hover:border-[#c4975a]/50 hover:text-hampton-blue transition-colors">
                {craftDisplayName(slug)} →
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── FAQ ── */}
      <section className="bg-hampton-pink/10 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <p className="section-subheading">Good to Know</p>
            <h2 className="section-heading">{data.name} FAQ</h2>
          </div>
          <div className="space-y-3">
            {data.faqs.map(faq => (
              <details key={faq.q} className="group rounded-xl border border-hampton-pink/20 bg-white open:border-[#c4975a]/40 transition-all">
                <summary className="flex items-center justify-between gap-4 p-5 cursor-pointer list-none font-semibold text-hampton-navy text-sm">
                  {faq.q}
                  <ChevronDown size={16} className="shrink-0 text-hampton-navy/40 group-open:rotate-180 transition-transform" />
                </summary>
                <p className="px-5 pb-5 text-hampton-navy/70 text-sm leading-relaxed">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="bg-gradient-to-r from-hampton-pink to-hampton-mauve py-16">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-4">{data.ctaHeading}</h2>
          <p className="text-hampton-navy/70 text-base mb-8">
            Fill out the form above or call us directly — we’d love to help you plan something memorable.
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
