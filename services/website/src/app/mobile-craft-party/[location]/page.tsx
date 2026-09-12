import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { MapPin, Home, Store, Truck, Palette, ChevronDown, ArrowLeft } from 'lucide-react'
import MobilePartyForm from '@/components/MobilePartyForm'
import MobilePriceBlock from '@/components/MobilePriceBlock'
import { CRAFT_STATIONS } from '@/lib/craftStations'
import { LOCATIONS, getLocation, townMeta, TRAVEL_NOTES, type Location } from '@/lib/locations'
import { OG_DEFAULTS, businessRef } from '@/lib/seo'

const BASE = 'https://www.hosthampton.com/mobile-craft-party'

/**
 * ISR, because the prices on this page are DB rows now (migration 036).
 *
 * Without it the page is prerendered at BUILD time, where `SUPABASE_URL` is not
 * available — the Docker build only receives NEXT_PUBLIC_* build args, runtime
 * secrets arrive in the container's environment. `loadPricingCatalog()` would
 * therefore return its compiled fallback and bake it into static HTML, and a
 * price Adam edited in `pricing_items` would not appear until the next deploy.
 * With revalidate the page is regenerated on the server, where the env exists.
 *
 * An hour is the right window: mobile pricing changes a few times a year, and
 * an SEO landing page should not pay for a query per visitor.
 */
export const revalidate = 3600

export function generateStaticParams() {
  return LOCATIONS.map(l => ({ location: l.slug }))
}

export async function generateMetadata(
  { params }: { params: { location: string } },
): Promise<Metadata> {
  const loc = getLocation(params.location)
  if (!loc) return {}
  const url = `${BASE}/${loc.slug}`
  const { title, description } = townMeta(loc)
  return {
    // `absolute`, so the root layout's ' | Host Hampton' template is NOT applied.
    // These 26 titles used to run 85–96 characters with the brand appended and
    // Google cut every one of them at ~60 — the town name survived, the offer
    // did not. See townMeta() for the budget.
    title: { absolute: title },
    description,
    keywords: [
      `mobile craft party ${loc.name}`,
      `kids craft party ${loc.name}`,
      `arts and crafts party ${loc.name} NY`,
      `at home birthday party ${loc.name}`,
      `${loc.name} kids party ${loc.county} County`,
      'mobile craft party near me',
    ],
    alternates: { canonical: url },
    openGraph: { ...OG_DEFAULTS, title, description, url },
  }
}

function buildSchema(loc: Location, url: string, faqs: { q: string; a: string }[]) {
  const service = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    serviceType: 'Mobile kids craft party',
    name: `Mobile Craft Party in ${loc.name}, NY`,
    description: `Hands-on mobile arts and crafts birthday parties brought to homes in ${loc.name}, NY, by Host Hampton.`,
    // A reference to the node the root layout already publishes, not a fourth
    // copy of the address (rule 11 — a constant declared in two files is a
    // constant nothing is checking).
    provider: businessRef(),
    areaServed: { '@type': 'City', name: `${loc.name}, NY` },
    url,
  }
  const faqPage = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Mobile Craft Party', item: BASE },
      { '@type': 'ListItem', position: 2, name: loc.name, item: url },
    ],
  }
  return [service, faqPage, breadcrumb]
}

export default function LocationPage({ params }: { params: { location: string } }) {
  const loc = getLocation(params.location)
  if (!loc) notFound()

  const url = `${BASE}/${loc.slug}`
  const travelNote = TRAVEL_NOTES[loc.travelTier]

  const faqs = [
    {
      q: `Do you bring mobile craft parties to ${loc.name}?`,
      a: `Yes. Host Hampton regularly brings mobile craft parties to ${loc.name} and the surrounding ${loc.region} area. We arrive with every supply, set up your chosen craft stations, run the activities with the kids, and pack it all up afterward. ${travelNote}`,
    },
    {
      q: `Can we host at your studio instead of in ${loc.name}?`,
      a: `Absolutely. If you’d rather not host at home, you can book the exact same craft party at our private studio in Speonk — an easy drive from ${loc.name} — with decor, hosting, and cleanup included.`,
    },
    {
      q: `What craft stations can ${loc.name} parties choose from?`,
      a: `Any mix you like — canvas painting, sand art, our signature drip-paint balloon dogs, slime, seashell decorating, bracelet making, and more. Every craft is a take-home keepsake that doubles as the party favor.`,
    },
    {
      q: `How far in advance should we book a ${loc.name} craft party?`,
      a: `We recommend 2–4 weeks ahead, especially for weekends. Reach out early and we’ll lock in your date for ${loc.name}.`,
    },
  ]

  const schema = buildSchema(loc, url, faqs)
  const prefill = `Party location: ${loc.name}, NY (${loc.county} County)\nCrafts we're interested in: `

  const nearbyLinks = LOCATIONS.filter(
    l => l.slug !== loc.slug && (loc.nearby.includes(l.name) || l.region === loc.region),
  ).slice(0, 6)

  return (
    <div>
      {schema.map((node, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(node).replace(/</g, '\\u003c') }} />
      ))}

      {/* ── Hero ── */}
      <section className="relative py-20 md:py-24 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <Link href="/mobile-craft-party" className="inline-flex items-center gap-1.5 text-hampton-navy/50 hover:text-hampton-navy text-sm font-medium mb-6 transition-colors">
            <ArrowLeft size={14} /> All Long Island craft parties
          </Link>
          <div className="flex flex-col md:flex-row items-center gap-12">
            <div className="flex-1 text-center md:text-left">
              <p className="text-[#c4975a] text-sm font-semibold tracking-widest uppercase mb-4">
                {loc.region} · {loc.county} County
              </p>
              <h1 className="font-serif text-4xl md:text-5xl text-hampton-navy leading-tight mb-6">
                Mobile Craft Party in <span className="italic text-hampton-blue">{loc.name}</span>
              </h1>
              <p className="text-hampton-navy/80 text-lg leading-relaxed mb-4 max-w-lg">
                {loc.context} We bring hands-on arts &amp; crafts — canvas painting, sand art, drip-paint balloon dogs, slime and more — right to your door in {loc.name}. Every craft is a keepsake the kids take home.
              </p>
              <p className="text-hampton-navy/60 text-sm max-w-lg mb-8 flex items-start gap-2">
                <Truck size={16} className="shrink-0 mt-0.5 text-hampton-navy/40" />
                <span>{travelNote}</span>
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
                <a href="#book" className="bg-hampton-navy text-white font-bold px-8 py-4 rounded-full text-base hover:bg-hampton-navy/90 transition-all shadow-lg hover:shadow-xl">
                  Get a {loc.name} Quote
                </a>
                <a href="tel:6319989325" className="border-2 border-hampton-navy/40 text-hampton-navy font-semibold px-8 py-4 rounded-full text-base hover:border-[#c4975a] transition-all">
                  Call (631) 998-9325
                </a>
              </div>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-3 max-w-md w-full">
              {['/images/gallery/venue-painting-workshop.webp', '/images/theme-slime.webp', '/images/theme-spa.webp', '/images/gallery/outdoor-party-setup.webp'].map((src, i) => (
                <div key={i} className={`relative rounded-2xl overflow-hidden aspect-square shadow-xl ${i === 0 ? 'ring-2 ring-[#c4975a]' : ''}`}>
                  <Image src={src} alt={`Kids craft party in ${loc.name}`} fill sizes="(max-width: 768px) 45vw, 240px" className="object-cover" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Two Ways ── */}
      <section className="bg-hampton-pink/10 py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <p className="section-subheading">Two Ways to Celebrate</p>
            <h2 className="section-heading">In {loc.name}, or at Our Studio</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-6">
            <div className="bg-white border border-hampton-pink/20 rounded-2xl p-8 text-center">
              <div className="w-14 h-14 bg-hampton-pink/20 rounded-full flex items-center justify-center mx-auto mb-5 text-hampton-navy"><Home size={26} /></div>
              <h3 className="font-semibold text-hampton-navy text-xl mb-2">At Your {loc.name} Home</h3>
              <p className="text-hampton-navy/70 text-sm leading-relaxed">We come to your home, backyard, or rental in {loc.name}, set up every station, run the crafts, and clean up. You just enjoy the party.</p>
            </div>
            <div className="bg-white border border-hampton-pink/20 rounded-2xl p-8 text-center">
              <div className="w-14 h-14 bg-hampton-pink/20 rounded-full flex items-center justify-center mx-auto mb-5 text-hampton-navy"><Store size={26} /></div>
              <h3 className="font-semibold text-hampton-navy text-xl mb-2">At Our Speonk Studio</h3>
              <p className="text-hampton-navy/70 text-sm leading-relaxed">Rather leave the mess with us? Book the same party in our private Hamptons studio — a short drive from {loc.name}.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Crafts ── */}
      <section className="py-16 max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <p className="section-subheading">Hands-On &amp; Take-Home</p>
          <h2 className="section-heading">Craft Stations for Your {loc.name} Party</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CRAFT_STATIONS.map(c => (
            <div key={c.name} className="bg-white border border-hampton-pink/20 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl" role="img" aria-label={c.name}>{c.emoji}</span>
                <h3 className="font-semibold text-hampton-navy text-base">{c.name}</h3>
              </div>
              <p className="text-hampton-navy/70 text-sm leading-relaxed">{c.blurb}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Link href="/mobile-party" className="text-hampton-blue font-semibold underline underline-offset-2 text-sm">
            See the full mobile party menu →
          </Link>
        </div>
      </section>

      {/* ── Pricing ── */}
      <MobilePriceBlock
        heading={`Craft Party Pricing in ${loc.name}`}
        subheading="We bring everything to your door. What we quote is what you pay — no mandatory gratuity, ever."
      />

      {/* ── Contact Form ── */}
      <section id="book" className="bg-gradient-to-r from-hampton-pink/20 to-hampton-ivory py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <p className="section-subheading">Let’s Make It Happen</p>
            <h2 className="section-heading">Request a Craft Party in {loc.name}</h2>
            <p className="text-hampton-navy/70 max-w-lg mx-auto">
              Tell us your date and which crafts you love — we’ll send a custom quote for {loc.name}, usually within 24 hours.
            </p>
          </div>
          <div className="max-w-2xl mx-auto">
            <MobilePartyForm prefillDetails={prefill} />
          </div>
        </div>
      </section>

      {/* ── Nearby ── */}
      {nearbyLinks.length > 0 && (
        <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-8">
            <p className="section-subheading">We Also Serve</p>
            <h2 className="section-heading">Craft Parties Near {loc.name}</h2>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {nearbyLinks.map(n => (
              <Link key={n.slug} href={`/mobile-craft-party/${n.slug}`} className="bg-white border border-hampton-pink/20 rounded-full px-5 py-2.5 text-sm font-medium text-hampton-navy hover:border-[#c4975a]/50 hover:text-hampton-blue transition-colors flex items-center gap-1.5">
                <MapPin size={12} className="text-hampton-navy/30" /> {n.name}
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
            <h2 className="section-heading">{loc.name} Craft Party FAQ</h2>
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
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="bg-gradient-to-r from-hampton-pink to-hampton-mauve py-16">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-4 flex items-center justify-center gap-3">
            <Palette size={30} /> Bring the Party to {loc.name}
          </h2>
          <p className="text-hampton-navy/70 text-base mb-8">
            Book a mobile craft party at your place in {loc.name} — or ours. Fill out the form above or call us directly.
          </p>
          <a href="#book" className="bg-hampton-navy text-hampton-ivory font-bold px-10 py-4 rounded-full text-base hover:bg-opacity-90 transition-all shadow-xl">
            Get Your Free Quote
          </a>
        </div>
      </section>
    </div>
  )
}
