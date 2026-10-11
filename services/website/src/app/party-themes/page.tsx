import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronDown, Phone } from 'lucide-react'
import { OG_DEFAULTS, SITE_URL } from '@/lib/seo'
import { loadPricingCatalog } from '@/lib/pricingCatalog'
import { loadStudioThemes } from '@/lib/partyCostFaq'
import {
  CUSTOMIZED_FOR_THEME,
  HOSTED_THEME_GROUPS,
  PARTY_THEMES_META,
  buildPartyThemesFaqs,
  loadCustomThemePriceCents,
} from '@/lib/hostedThemes'

/**
 * /party-themes — every theme we have hosted, and the plain statement that we
 * will do any other one.
 *
 * WHY. /party-packages lists the signature packages and nothing else, so a
 * parent (or an answer engine) asking for a Minecraft, Stitch or construction
 * party found no sign we had ever run one. The list lives in
 * `lib/hostedThemes.ts`, which says where each entry came from.
 *
 * Server-rendered text throughout: the crawlers behind ChatGPT and Perplexity
 * citations run no JavaScript. Per-request because it reads the signature
 * theme names and the custom-theme price — a DB read inside a try/catch would
 * otherwise prerender the fallback and cache it (the /spa-party trap).
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: PARTY_THEMES_META.title,
  description: PARTY_THEMES_META.description,
  alternates: { canonical: `${SITE_URL}/party-themes` },
  openGraph: {
    ...OG_DEFAULTS,
    title: 'Party Themes We’ve Hosted — Host Hampton',
    description: 'Any theme, made to your child’s vibe: decor, activities, take-homes and the invitation.',
    url: `${SITE_URL}/party-themes`,
  },
}

export default async function PartyThemesPage() {
  const [signature, catalog, customCents] = await Promise.all([
    loadStudioThemes(),
    loadPricingCatalog(),
    loadCustomThemePriceCents(),
  ])
  const faqs = buildPartyThemesFaqs(customCents, catalog.guestRules)

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }

  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema).replace(/</g, '\\u003c') }} />

      {/* Hero */}
      <section className="pt-16 pb-10 text-center px-4">
        <p className="section-subheading">Any Theme · Your Vibe</p>
        <h1 className="font-serif text-4xl md:text-5xl text-hampton-navy mb-5 max-w-3xl mx-auto leading-tight">
          Party Themes We&apos;ve Hosted
        </h1>
        <p className="text-hampton-navy/80 text-lg max-w-2xl mx-auto leading-relaxed">
          From Minecraft and Stitch to mermaids, cowgirls and construction crews — if your child loves it, we can
          build a party around it. Here are some of the themes we&apos;ve hosted at our private studio in Speonk and
          at homes across Long Island. Don&apos;t see yours? Ask us. We can do anything, and we&apos;ll customize it
          to your vibe.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
          <Link href="/party-packages" className="btn-primary">Plan your party</Link>
          <a href="tel:6319989325" className="btn-secondary inline-flex items-center justify-center gap-2">
            <Phone size={16} /> Call or text (631) 998-9325
          </a>
        </div>
      </section>

      {/* Hosted themes, grouped */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
        <div className="grid md:grid-cols-2 gap-6">
          {HOSTED_THEME_GROUPS.map(g => (
            <article key={g.id} className="bg-white rounded-2xl p-6 md:p-8 shadow-sm border border-hampton-pink/20">
              <h2 className="font-serif text-2xl text-hampton-navy mb-2">{g.title}</h2>
              <p className="text-hampton-navy/70 text-sm leading-relaxed mb-5">{g.blurb}</p>
              <ul className="space-y-2.5">
                {g.themes.map(t => (
                  <li key={t.name} className="text-hampton-navy text-sm leading-snug">
                    {t.href ? (
                      <Link href={t.href} className="font-semibold underline underline-offset-2 decoration-hampton-pink/60 hover:text-hampton-blue">
                        {t.name}
                      </Link>
                    ) : (
                      <span className="font-semibold">{t.name}</span>
                    )}
                    {t.tagline && <span className="text-hampton-navy/60"> — &ldquo;{t.tagline}&rdquo;</span>}
                    {t.note && <span className="text-hampton-navy/60"> — {t.note}</span>}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {/* What we customize */}
      <section className="bg-hampton-pink/10 py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <p className="section-subheading">Made For Your Child</p>
            <h2 className="section-heading">How We Make a Theme Yours</h2>
            <p className="text-hampton-navy/70 max-w-2xl mx-auto">
              Tell us the theme, their favorite colors, the characters, the thing they&apos;d do all day if you let
              them. We design the party around it.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {CUSTOMIZED_FOR_THEME.map(c => (
              <div key={c.title} className="bg-white border border-hampton-pink/20 rounded-2xl p-6 text-center">
                <h3 className="font-semibold text-hampton-navy text-base mb-2">{c.title}</h3>
                <p className="text-hampton-navy/70 text-sm leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Signature packages — names read from party_themes, the homepage tiles' source */}
      {signature.length > 0 && (
        <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <p className="section-subheading">Ready-Made Packages</p>
          <h2 className="section-heading">Our Signature Themes</h2>
          <p className="text-hampton-navy/70 max-w-2xl mx-auto mb-8">
            Prefer a theme that&apos;s already planned down to the last detail? These are on our packages page with
            everything included.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {signature.map(t => (
              <Link
                key={t.slug}
                href="/party-packages"
                className="bg-white border border-hampton-pink/20 rounded-full px-5 py-2.5 text-sm font-medium text-hampton-navy hover:border-[#c4975a]/50 hover:text-hampton-blue transition-colors"
              >
                {t.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* FAQ */}
      <section className="bg-hampton-pink/10 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <p className="section-subheading">Good to Know</p>
            <h2 className="section-heading">Custom Theme FAQ</h2>
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

      {/* CTA */}
      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto bg-gradient-to-b from-[#BCCDEB]/40 to-[#F7F2E8]/10 rounded-3xl px-8 py-12 text-center border border-[#A1B5C8]/30">
          <h2 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-4">Got a Theme in Mind?</h2>
          <p className="text-hampton-navy/70 text-base max-w-xl mx-auto mb-8 leading-relaxed">
            Choose &ldquo;Custom Party Theme&rdquo; in the party planner, or type your idea into the theme box on our
            packages page. We&apos;ll come back with a plan — at our studio or at your house.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/kids-party-menu" className="btn-primary">Design your party</Link>
            <Link href="/mobile-party" className="btn-secondary">Have it at your house</Link>
          </div>
        </div>
      </section>
    </div>
  )
}
