import type { Metadata } from 'next'
import Link from 'next/link'
import { Check } from 'lucide-react'
import FundraiserForm from './FundraiserForm'

export const metadata: Metadata = {
  title: 'Trucker Hat & Canvas Gear Fundraiser | Host Hampton, Long Island',
  description:
    'A fun, easy way to raise money for your school, team, or class. Custom branded trucker hats, canvas totes & pouches. No upfront cost — keep 100% of the profit. Speonk, NY.',
  keywords: [
    'trucker hat fundraiser Long Island',
    'school fundraiser merchandise',
    'PTA fundraiser ideas',
    'custom hat fundraiser',
    'canvas bag fundraiser',
    'no cost fundraiser',
    'team fundraiser Long Island',
    'custom merchandise fundraiser',
  ],
  openGraph: {
    title: 'Trucker Hat + Canvas Gear Fundraiser | Host Hampton',
    description:
      'Custom branded items your fans actually want to represent your organization. No upfront cost, no inventory, keep 100% of the profit.',
    url: 'https://www.hosthampton.com/fundraiser',
    siteName: 'Host Hampton',
    locale: 'en_US',
    type: 'website',
  },
}

const fundraiserServiceSchema = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: 'Trucker Hat & Canvas Gear Fundraiser',
  description:
    'A fun, easy way to raise money for your school, team, or class. Custom branded trucker hats, canvas tote bags, and zipper pouches. No upfront cost — your organization keeps 100% of the profit.',
  provider: {
    '@type': 'LocalBusiness',
    name: 'Host Hampton',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '295 Montauk Hwy, Suite 7',
      addressLocality: 'Speonk',
      addressRegion: 'NY',
      postalCode: '11972',
    },
    telephone: '+16319989325',
    url: 'https://www.hosthampton.com',
  },
  areaServed: [
    'Long Island',
    'Hamptons',
    'Suffolk County',
    'Nassau County',
    'New York',
  ],
  serviceType: 'Fundraising',
  offers: {
    '@type': 'Offer',
    description:
      'Custom merchandise fundraising — no upfront cost. Organizations keep 100% of the profit. Minimum 20% of total sales guaranteed.',
    priceCurrency: 'USD',
  },
}

const faqItems = [
  {
    q: 'Is there any upfront cost or financial risk?',
    a: 'No. There is no upfront cost or financial risk. No inventory to manage or store. Your organization pays nothing — supporters pay directly when they order.',
  },
  {
    q: 'How much does our organization keep?',
    a: 'You keep 20% minimum of total sales. Your organization keeps 100% of the profit above our base cost. On 50 hats at $35 each, that could be $250–$750 in profit.',
  },
  {
    q: 'What products are available for fundraising?',
    a: 'We offer custom trucker hats ($25–$45 in standard and premium styles, 20+ color combos), canvas tote bags ($40), and canvas zipper pouches ($25) — all with your custom logo or patch.',
  },
  {
    q: 'How do supporters pay?',
    a: 'Supporters pay you directly via Venmo, PayPal, Zelle, or cash. We also provide a professional ordering page and printable order forms for manual orders.',
  },
  {
    q: 'How long does delivery take?',
    a: 'Production and delivery takes just 2–3 weeks. We handle simple bulk distribution to your school or team location.',
  },
  {
    q: 'What does Host Hampton provide?',
    a: 'We provide custom logo design & high-res mockups, a premium product catalog, digital marketing materials & PDF flyers, a sample ordering page, and bulk delivery to your location.',
  },
  {
    q: 'What do we need to provide?',
    a: 'Just your logo image! We handle design, mockups, production, and delivery. We also offer free design assistance to make your logo pop on merchandise.',
  },
]

const fundraiserFaqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqItems.map(f => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
}

export default function Fundraiser() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(fundraiserServiceSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(fundraiserFaqSchema) }}
      />

      {/* 1. Hero */}
      <section className="bg-gradient-to-br from-hampton-navy to-[#2d3f6b] py-20 text-center px-4">
        <h1 className="font-serif text-4xl md:text-5xl text-white mb-5 max-w-3xl mx-auto leading-tight">
          Trucker Hat + Canvas Gear Fundraiser
        </h1>
        <p className="text-hampton-blue/80 text-xl max-w-2xl mx-auto mb-3">
          A fun, easy way to raise money for your school, team, or class.
        </p>
        <p className="text-hampton-mauve text-base max-w-xl mx-auto mb-8">
          Custom branded items your fans actually want to represent your organization.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-6">
          <a
            href="#inquiry-form"
            className="bg-hampton-pink text-hampton-navy font-bold px-8 py-4 rounded-full text-base hover:bg-opacity-90 transition-all shadow-lg"
          >
            Request a Mockup
          </a>
          <a
            href="https://www.hosthampton.com/li-high"
            target="_blank"
            rel="noopener noreferrer"
            className="border-2 border-white/30 text-white font-bold px-8 py-4 rounded-full text-base hover:bg-white/10 transition-all"
          >
            See Sample Ordering Page
          </a>
        </div>
      </section>

      {/* 2. How It Works */}
      <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <h2 className="section-heading">How It Works</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          <div className="text-center">
            <p className="font-serif text-5xl text-hampton-pink mb-3">01</p>
            <h3 className="font-semibold text-hampton-navy text-lg mb-3 uppercase tracking-wider">
              Design
            </h3>
            <ul className="text-hampton-mauve text-sm leading-relaxed space-y-2 text-left max-w-xs mx-auto">
              <li>Send us your logo image!</li>
              <li>Get custom mockups for hats, totes, & pouches.</li>
              <li><strong className="text-hampton-navy">Free design assistance</strong> to make your logo pop.</li>
            </ul>
          </div>
          <div className="text-center">
            <p className="font-serif text-5xl text-hampton-pink mb-3">02</p>
            <h3 className="font-semibold text-hampton-navy text-lg mb-3 uppercase tracking-wider">
              Sell
            </h3>
            <ul className="text-hampton-mauve text-sm leading-relaxed space-y-2 text-left max-w-xs mx-auto">
              <li>Share digital flyer & ordering link with your community.</li>
              <li>Printable order forms for manual orders + physical samples.</li>
              <li>Supporters pay you <strong className="text-hampton-navy">directly</strong> (Venmo, PayPal, Zelle, Cash).</li>
            </ul>
          </div>
          <div className="text-center">
            <p className="font-serif text-5xl text-hampton-pink mb-3">03</p>
            <h3 className="font-semibold text-hampton-navy text-lg mb-3 uppercase tracking-wider">
              Deliver
            </h3>
            <ul className="text-hampton-mauve text-sm leading-relaxed space-y-2 text-left max-w-xs mx-auto">
              <li>Production + delivery in just 2–3 weeks.</li>
              <li>Simple bulk distribution to your school or team.</li>
              <li><strong className="text-hampton-navy">Your organization keeps 100% of the profit!</strong></li>
            </ul>
          </div>
        </div>
      </section>

      {/* 3. Volunteer Friendly */}
      <section className="bg-hampton-pink/10 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="section-heading text-center mb-8">Volunteer Friendly</h2>
          <div className="bg-white rounded-2xl border border-hampton-pink/20 p-8">
            <ul className="space-y-4">
              {[
                'No upfront cost or financial risk',
                'No inventory to manage or store',
                'Multiple price-point options for all budgets',
                'Professional fundraiser page provided',
                'High-quality gear kids and parents love',
              ].map(item => (
                <li key={item} className="flex items-start gap-3">
                  <Check size={18} className="text-green-500 shrink-0 mt-0.5" />
                  <span className="text-hampton-navy text-base">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 4. Pricing at a Glance */}
      <section className="py-16 max-w-4xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-8">
          <h2 className="section-heading">Pricing at a Glance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-hampton-navy text-white">
                <th className="text-left py-3 px-4 rounded-tl-lg">Item</th>
                <th className="text-right py-3 px-4">Sell Price</th>
                <th className="text-right py-3 px-4 rounded-tr-lg">Your Profit</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-white">
                <td className="py-3 px-4 font-semibold text-hampton-navy">Hats</td>
                <td className="py-3 px-4 text-right text-hampton-navy">$25 – $45</td>
                <td className="py-3 px-4 text-right text-green-600 font-semibold">$5 – $15</td>
              </tr>
              <tr className="bg-hampton-pink/5">
                <td className="py-3 px-4 font-semibold text-hampton-navy">Tote Bags</td>
                <td className="py-3 px-4 text-right text-hampton-navy">$40</td>
                <td className="py-3 px-4 text-right text-green-600 font-semibold">$10</td>
              </tr>
              <tr className="bg-white">
                <td className="py-3 px-4 font-semibold text-hampton-navy">Pouches</td>
                <td className="py-3 px-4 text-right text-hampton-navy">$25</td>
                <td className="py-3 px-4 text-right text-green-600 font-semibold">$5</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-center mt-4 text-hampton-navy font-bold text-sm uppercase tracking-wide">
          You keep 20% minimum of total sales — maximize your impact!
        </p>
      </section>

      {/* 5. Request a Mockup CTA */}
      <section className="bg-hampton-navy py-14 text-center px-4">
        <h2 className="font-serif text-3xl text-white mb-3">Request a Mockup</h2>
        <p className="text-hampton-blue/80 text-base max-w-lg mx-auto mb-6">
          Get your free design in 24 hours.
        </p>
        <a
          href="#inquiry-form"
          className="inline-block bg-hampton-pink text-hampton-navy font-bold px-8 py-4 rounded-full text-base hover:bg-opacity-90 transition-all shadow-lg"
        >
          Request a Mockup
        </a>
      </section>

      {/* 6. The Merchandise */}
      <section className="py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <p className="section-subheading mb-2">The Merchandise</p>
            <h2 className="section-heading">Custom Branded Products</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-white border border-hampton-pink/20 rounded-2xl p-6 text-center">
              <div className="bg-hampton-mauve/10 rounded-xl h-48 flex items-center justify-center mb-4">
                <span className="text-hampton-navy/30 text-sm font-medium">Product Photo</span>
              </div>
              <h3 className="font-serif text-hampton-navy text-lg font-bold mb-2">Custom Trucker Hats</h3>
              <p className="text-hampton-mauve text-sm leading-relaxed">
                A classic fan favorite. Available in 20+ color combos with premium patch application. Standard and Premium styles.
              </p>
            </div>
            <div className="bg-white border border-hampton-pink/20 rounded-2xl p-6 text-center">
              <div className="bg-hampton-mauve/10 rounded-xl h-48 flex items-center justify-center mb-4">
                <span className="text-hampton-navy/30 text-sm font-medium">Product Photo</span>
              </div>
              <h3 className="font-serif text-hampton-navy text-lg font-bold mb-2">Trendy Canvas Totes</h3>
              <p className="text-hampton-mauve text-sm leading-relaxed">
                High-utility tote bags perfect for school or sports. High-quality cotton canvas with contrast webbing handles.
              </p>
            </div>
            <div className="bg-white border border-hampton-pink/20 rounded-2xl p-6 text-center">
              <div className="bg-hampton-mauve/10 rounded-xl h-48 flex items-center justify-center mb-4">
                <span className="text-hampton-navy/30 text-sm font-medium">Product Photo</span>
              </div>
              <h3 className="font-serif text-hampton-navy text-lg font-bold mb-2">Canvas Zipper Pouches</h3>
              <p className="text-hampton-mauve text-sm leading-relaxed">
                Perfect for school supplies, makeup, or organizing gear. A trendy, accessible option for everyone!
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Sample Ordering Page Link */}
      <section className="bg-hampton-pink/10 py-10 text-center px-4">
        <a
          href="https://www.hosthampton.com/li-high"
          target="_blank"
          rel="noopener noreferrer"
          className="text-hampton-navy font-bold text-base hover:text-hampton-blue transition-colors uppercase tracking-wider"
        >
          See Sample Ordering Page for Your Supporters &rarr;
        </a>
      </section>

      {/* 8. Profit Projections */}
      <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-8">
          <h2 className="section-heading">Fundraiser Details + Profit Examples</h2>
        </div>

        <h3 className="font-serif text-xl text-hampton-navy mb-6 text-center">Profit Projections</h3>
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          {/* Hats */}
          <div className="bg-white border border-hampton-pink/20 rounded-2xl p-6">
            <h4 className="font-semibold text-hampton-navy text-base mb-4 text-center">Hats (~$5–$15 Profit)</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between"><span className="text-hampton-mauve">25 Sold</span><span className="text-green-600 font-semibold">$125 – $375</span></li>
              <li className="flex justify-between"><span className="text-hampton-mauve">50 Sold</span><span className="text-green-600 font-semibold">$250 – $750</span></li>
              <li className="flex justify-between"><span className="text-hampton-mauve">100 Sold</span><span className="text-green-600 font-semibold">$500 – $1,500</span></li>
            </ul>
          </div>
          {/* Totes */}
          <div className="bg-white border border-hampton-pink/20 rounded-2xl p-6">
            <h4 className="font-semibold text-hampton-navy text-base mb-4 text-center">Totes ($10 Profit)</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between"><span className="text-hampton-mauve">25 Sold</span><span className="text-green-600 font-semibold">$250</span></li>
              <li className="flex justify-between"><span className="text-hampton-mauve">50 Sold</span><span className="text-green-600 font-semibold">$500</span></li>
              <li className="flex justify-between"><span className="text-hampton-mauve">100 Sold</span><span className="text-green-600 font-semibold">$1,000</span></li>
            </ul>
          </div>
          {/* Pouches */}
          <div className="bg-white border border-hampton-pink/20 rounded-2xl p-6">
            <h4 className="font-semibold text-hampton-navy text-base mb-4 text-center">Pouches ($5 Profit)</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between"><span className="text-hampton-mauve">25 Sold</span><span className="text-green-600 font-semibold">$125</span></li>
              <li className="flex justify-between"><span className="text-hampton-mauve">50 Sold</span><span className="text-green-600 font-semibold">$250</span></li>
              <li className="flex justify-between"><span className="text-hampton-mauve">100 Sold</span><span className="text-green-600 font-semibold">$500</span></li>
            </ul>
          </div>
        </div>
      </section>

      {/* 9. What Host Hampton Provides */}
      <section className="bg-hampton-pink/10 py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="section-heading text-center mb-8">Host Hampton Provides</h2>
          <div className="bg-white rounded-2xl border border-hampton-pink/20 p-8">
            <ul className="space-y-4">
              {[
                'Custom logo design & high-res mockups',
                'Premium product catalog (Hats, Totes, Pouches)',
                'Digital marketing materials & PDF flyers',
                'Bulk delivery to your location',
              ].map(item => (
                <li key={item} className="flex items-start gap-3">
                  <Check size={18} className="text-green-500 shrink-0 mt-0.5" />
                  <span className="text-hampton-navy text-base">{item}</span>
                </li>
              ))}
              <li className="flex items-start gap-3">
                <Check size={18} className="text-green-500 shrink-0 mt-0.5" />
                <span className="text-hampton-navy text-base">
                  Sample ordering page:{' '}
                  <a
                    href="https://www.hosthampton.com/li-high"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-hampton-blue underline hover:text-hampton-navy transition-colors"
                  >
                    hosthampton.com/li-high
                  </a>
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* 10. Lead Capture Form */}
      <section id="inquiry-form" className="py-20 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="section-heading">Request a Mockup</h2>
            <p className="text-hampton-mauve text-base max-w-lg mx-auto">
              Get your free design in 24 hours. Tell us about your organization and we'll send a custom mockup — no cost, no commitment.
            </p>
          </div>
          <FundraiserForm />
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-6 text-xs text-hampton-mauve">
            <span>No cost, no obligation</span>
            <span>·</span>
            <span>Free design in 24 hours</span>
            <span>·</span>
            <span>Call / Text Allie @ 631-998-9325</span>
          </div>
        </div>
      </section>

      {/* 11. FAQ */}
      <section className="bg-hampton-navy py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl text-white text-center mb-8">
            Fundraiser FAQ
          </h2>
          <div className="space-y-4">
            {faqItems.map(f => (
              <div key={f.q} className="bg-white/10 rounded-xl p-5">
                <h3 className="text-hampton-pink font-semibold text-base mb-1">{f.q}</h3>
                <p className="text-hampton-blue/80 text-sm leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
          <p className="text-center mt-8 text-hampton-blue/50 text-sm">
            More questions?{' '}
            <Link href="/contact-us" className="text-hampton-pink underline hover:text-white transition-colors">
              Contact us directly
            </Link>
          </p>
        </div>
      </section>

      {/* 12. Bottom CTA */}
      <section className="py-14 text-center px-4 bg-gradient-to-r from-hampton-pink to-hampton-mauve">
        <p className="text-hampton-navy/60 text-sm mb-4 font-medium">
          Thank You for Supporting a Local Long Island Small Woman-Owned Business
        </p>
        <h2 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-4">
          Ready to Start Your Fundraiser?
        </h2>
        <p className="text-hampton-navy/70 text-base mb-8 max-w-md mx-auto">
          Call / Text Allie @ 631-998-9325 or request your free mockup below.
        </p>
        <a
          href="#inquiry-form"
          className="bg-hampton-navy text-hampton-ivory font-bold px-10 py-4 rounded-full text-base hover:bg-opacity-90 shadow-lg"
        >
          Request a Mockup — It's Free
        </a>
      </section>
    </>
  )
}
