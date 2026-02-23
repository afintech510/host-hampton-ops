import type { Metadata } from 'next'
import Image from 'next/image'
import InquiryForm from './InquiryForm'

export const metadata: Metadata = {
  title: 'Atelier Brim — Bespoke Hat Bar Activations | Host Hampton',
  description:
    'Curated trucker hat bar experiences for corporate events, brand activations, and private gatherings. Bespoke headwear styling for tastemakers in NYC, the Hamptons, and beyond.',
  keywords: [
    'hat bar activation NYC',
    'trucker hat bar corporate event',
    'custom hat bar Long Island',
    'experiential marketing hat bar',
    'brand activation hat bar Hamptons',
    'bespoke headwear event NYC',
  ],
  openGraph: {
    title: 'Atelier Brim — Bespoke Hat Bar Activations',
    description:
      'Curated headwear experiences for brand activations, corporate events, and private gatherings. By Host Hampton.',
  },
}

/* ── palette tokens ── */
const c = {
  oat:      '#F5F0EB',
  cream:    '#FDFBF9',
  espresso: '#3C2A21',
  rose:     '#C9A5A5',
  roseLight:'#E8D5D5',
  roseMuted:'#D4B5B5',
  warmGray: '#8C7B72',
}

const services = [
  {
    title: 'Brand Activations',
    desc: 'Transform your next product launch, pop-up, or trade show with a bespoke hat bar featuring your logo, custom patches, and curated colorways that align with your brand identity.',
  },
  {
    title: 'Corporate Gatherings',
    desc: 'Elevate team off-sites, holiday parties, and client appreciation events. Each guest leaves with a one-of-a-kind piece — and a memory tied to your brand.',
  },
  {
    title: 'Private Events',
    desc: 'From influencer dinners to editorial shoots, our styling stations bring an interactive, Instagram-worthy element that your guests will be talking about for months.',
  },
]

const process = [
  { n: '01', title: 'Consultation',  desc: 'We learn your brand, your aesthetic, and your vision. Every activation is designed from scratch — never a template.' },
  { n: '02', title: 'Curation',      desc: 'Our team curates hat silhouettes, patch collections, colorways, and display styling tailored to your event and audience.' },
  { n: '03', title: 'Activation',    desc: 'We arrive with everything. A fully styled hat bar, trained style attendants, and a seamless guest experience from start to finish.' },
]

const brands = [
  { name: 'Amazon',           logo: null },
  { name: 'Event Eleven',     logo: null },
  { name: 'indie-consulting',  logo: null },
]

export default function AtelierBrimPage() {
  return (
    <div style={{ fontFamily: 'var(--font-montserrat), sans-serif', color: c.espresso, background: c.cream }}>

      {/* ── Nav ── */}
      <nav
        className="fixed top-0 w-full z-50 backdrop-blur-xl border-b transition-all"
        style={{ background: `${c.cream}e6`, borderColor: `${c.rose}40` }}
      >
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/trucker-hat-bar" className="flex items-center gap-3">
            <span
              className="text-xl tracking-[0.25em] uppercase"
              style={{ fontFamily: 'var(--font-cormorant), serif', fontWeight: 500, color: c.espresso }}
            >
              Atelier Brim
            </span>
          </a>
          <div className="hidden md:flex items-center gap-8 text-xs tracking-[0.2em] uppercase" style={{ color: c.warmGray, fontWeight: 500 }}>
            <a href="#experience" className="hover:opacity-70 transition-opacity">The Experience</a>
            <a href="#activations" className="hover:opacity-70 transition-opacity">Activations</a>
            <a href="#process" className="hover:opacity-70 transition-opacity">Process</a>
            <a href="#inquiry" className="hover:opacity-70 transition-opacity">Inquire</a>
          </div>
          <a
            href="#inquiry"
            className="px-5 py-2 rounded-full text-xs tracking-[0.15em] uppercase transition-all hover:opacity-90"
            style={{ background: c.espresso, color: c.cream, fontWeight: 600 }}
          >
            Book a Consultation
          </a>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="min-h-screen flex items-center pt-20" style={{ background: c.oat }}>
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-0 grid md:grid-cols-2 gap-16 items-center">
          <div>
            <p
              className="text-xs tracking-[0.3em] uppercase mb-6"
              style={{ color: c.rose, fontWeight: 600 }}
            >
              Experiential Styling for Tastemakers
            </p>
            <h1
              className="text-5xl md:text-6xl lg:text-7xl leading-[1.05] mb-8"
              style={{ fontFamily: 'var(--font-cormorant), serif', fontWeight: 300 }}
            >
              Bespoke Headwear<br />
              <em className="italic" style={{ fontWeight: 500 }}>Experiences</em>
            </h1>
            <p className="text-base leading-relaxed mb-10 max-w-md" style={{ color: c.warmGray, fontWeight: 300 }}>
              We curate elevated hat bar activations for brands, agencies, and private events.
              Each experience is designed from scratch — never a template, always a conversation piece.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <a
                href="#inquiry"
                className="inline-block px-8 py-3.5 rounded-full text-sm tracking-[0.15em] uppercase transition-all hover:scale-[1.02]"
                style={{ background: c.espresso, color: c.cream, fontWeight: 600 }}
              >
                Inquire Now
              </a>
              <a
                href="#experience"
                className="inline-block px-8 py-3.5 rounded-full text-sm tracking-[0.15em] uppercase border transition-all hover:opacity-80"
                style={{ borderColor: `${c.espresso}40`, color: c.espresso, fontWeight: 500 }}
              >
                Explore
              </a>
            </div>
          </div>
          <div className="relative">
            <div
              className="aspect-[3/4] rounded-3xl overflow-hidden shadow-2xl"
              style={{ border: `1px solid ${c.roseLight}` }}
            >
              <Image
                src="/images/theme-sweets.png"
                alt="Atelier Brim — curated hat bar styling"
                fill
                className="object-cover"
                priority
              />
            </div>
            <div
              className="absolute -bottom-6 -left-6 px-6 py-4 rounded-2xl shadow-lg backdrop-blur-sm"
              style={{ background: `${c.cream}ee`, border: `1px solid ${c.roseLight}` }}
            >
              <p className="text-xs tracking-[0.2em] uppercase mb-1" style={{ color: c.rose, fontWeight: 600 }}>
                Trusted by
              </p>
              <p className="text-sm" style={{ fontWeight: 500 }}>
                500+ guests styled this season
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── As Seen With ── */}
      <section className="py-16 border-y" style={{ borderColor: `${c.rose}30` }}>
        <div className="max-w-4xl mx-auto px-6">
          <p
            className="text-center text-xs tracking-[0.3em] uppercase mb-10"
            style={{ color: c.warmGray, fontWeight: 500 }}
          >
            Brands We&apos;ve Worked With
          </p>
          <div className="flex flex-wrap items-center justify-center gap-12 md:gap-20">
            {brands.map(b => (
              <span
                key={b.name}
                className="text-xl md:text-2xl tracking-[0.1em]"
                style={{ fontFamily: 'var(--font-cormorant), serif', fontWeight: 400, color: `${c.espresso}80` }}
              >
                {b.name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── The Experience ── */}
      <section id="experience" className="py-24 md:py-32">
        <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-2 gap-16 items-center">
          <div
            className="aspect-square rounded-3xl overflow-hidden relative"
            style={{ border: `1px solid ${c.roseLight}` }}
          >
            <Image
              src="/images/theme-spa.png"
              alt="Curated hat bar experience"
              fill
              className="object-cover"
            />
          </div>
          <div>
            <p
              className="text-xs tracking-[0.3em] uppercase mb-4"
              style={{ color: c.rose, fontWeight: 600 }}
            >
              The Experience
            </p>
            <h2
              className="text-4xl md:text-5xl leading-[1.1] mb-8"
              style={{ fontFamily: 'var(--font-cormorant), serif', fontWeight: 300 }}
            >
              Not a Vendor Booth.<br />
              <em style={{ fontWeight: 500 }}>An Atelier.</em>
            </h2>
            <div className="space-y-5 text-base leading-relaxed" style={{ color: c.warmGray, fontWeight: 300 }}>
              <p>
                Atelier Brim is a fully-curated, on-site headwear styling experience.
                Guests select from premium trucker hat silhouettes, then personalize
                with curated patch collections, custom embroidery, and artisanal pins —
                all styled by our trained attendants.
              </p>
              <p>
                Every activation is designed to match your brand&apos;s aesthetic. We handle the
                display design, patch curation, color palette, signage, and staffing.
                Your guests leave with a bespoke piece they&apos;ll actually wear — and your brand
                stays top of mind long after the event.
              </p>
            </div>
            <div className="flex gap-8 mt-10">
              {[
                { n: '500+', label: 'Guests Styled' },
                { n: '50+',  label: 'Activations' },
                { n: '100%', label: 'Custom' },
              ].map(s => (
                <div key={s.label}>
                  <p className="text-2xl" style={{ fontFamily: 'var(--font-cormorant), serif', fontWeight: 600 }}>{s.n}</p>
                  <p className="text-xs tracking-[0.15em] uppercase mt-1" style={{ color: c.warmGray, fontWeight: 500 }}>{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Activations ── */}
      <section id="activations" className="py-24 md:py-32" style={{ background: c.oat }}>
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-16">
            <p
              className="text-xs tracking-[0.3em] uppercase mb-4"
              style={{ color: c.rose, fontWeight: 600 }}
            >
              Activations
            </p>
            <h2
              className="text-4xl md:text-5xl leading-[1.1]"
              style={{ fontFamily: 'var(--font-cormorant), serif', fontWeight: 300 }}
            >
              Designed for Every <em style={{ fontWeight: 500 }}>Occasion</em>
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {services.map(s => (
              <div
                key={s.title}
                className="p-8 rounded-2xl transition-shadow hover:shadow-lg"
                style={{ background: c.cream, border: `1px solid ${c.roseLight}` }}
              >
                <h3
                  className="text-2xl mb-4"
                  style={{ fontFamily: 'var(--font-cormorant), serif', fontWeight: 500 }}
                >
                  {s.title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: c.warmGray, fontWeight: 300 }}>
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── What's Included ── */}
      <section className="py-24 md:py-32">
        <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-2 gap-16 items-center">
          <div>
            <p
              className="text-xs tracking-[0.3em] uppercase mb-4"
              style={{ color: c.rose, fontWeight: 600 }}
            >
              What&apos;s Included
            </p>
            <h2
              className="text-4xl md:text-5xl leading-[1.1] mb-10"
              style={{ fontFamily: 'var(--font-cormorant), serif', fontWeight: 300 }}
            >
              Every Detail, <em style={{ fontWeight: 500 }}>Handled</em>
            </h2>
            <div className="space-y-4">
              {[
                'Premium trucker hat selection in curated colorways',
                'Custom patch collection designed to your brand',
                'On-site style attendants to guide each guest',
                'Branded signage, display design & table styling',
                'Full setup and breakdown — zero work on your end',
                'Digital lookbook of your activation (upon request)',
              ].map(item => (
                <div
                  key={item}
                  className="flex items-start gap-4 py-3 border-b"
                  style={{ borderColor: `${c.rose}25` }}
                >
                  <span className="text-sm mt-0.5" style={{ color: c.rose }}>&#10003;</span>
                  <p className="text-sm" style={{ fontWeight: 400 }}>{item}</p>
                </div>
              ))}
            </div>
          </div>
          <div
            className="aspect-[4/5] rounded-3xl overflow-hidden relative"
            style={{ border: `1px solid ${c.roseLight}` }}
          >
            <Image
              src="/images/theme-barbie.png"
              alt="Hat bar display styling"
              fill
              className="object-cover"
            />
          </div>
        </div>
      </section>

      {/* ── Process ── */}
      <section id="process" className="py-24 md:py-32" style={{ background: c.oat }}>
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-16">
            <p
              className="text-xs tracking-[0.3em] uppercase mb-4"
              style={{ color: c.rose, fontWeight: 600 }}
            >
              The Process
            </p>
            <h2
              className="text-4xl md:text-5xl leading-[1.1]"
              style={{ fontFamily: 'var(--font-cormorant), serif', fontWeight: 300 }}
            >
              From Vision to <em style={{ fontWeight: 500 }}>Activation</em>
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-10">
            {process.map(s => (
              <div key={s.n} className="text-center">
                <p
                  className="text-6xl mb-4"
                  style={{ fontFamily: 'var(--font-cormorant), serif', fontWeight: 300, color: `${c.rose}60` }}
                >
                  {s.n}
                </p>
                <h3
                  className="text-xl mb-3"
                  style={{ fontFamily: 'var(--font-cormorant), serif', fontWeight: 600 }}
                >
                  {s.title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: c.warmGray, fontWeight: 300 }}>
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Social Proof ── */}
      <section className="py-24 md:py-32">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <p
            className="text-xs tracking-[0.3em] uppercase mb-8"
            style={{ color: c.rose, fontWeight: 600 }}
          >
            What Planners Are Saying
          </p>
          <blockquote
            className="text-3xl md:text-4xl leading-[1.3] mb-8"
            style={{ fontFamily: 'var(--font-cormorant), serif', fontWeight: 300, fontStyle: 'italic' }}
          >
            &ldquo;Atelier Brim was the highlight of our activation. Every guest was obsessed — the display was stunning and the team was seamless. We&apos;ve already booked them for our next three events.&rdquo;
          </blockquote>
          <p className="text-sm" style={{ color: c.warmGray, fontWeight: 500 }}>
            — Corporate Events Director, Amazon
          </p>
        </div>
      </section>

      {/* ── Inquiry Form ── */}
      <section id="inquiry" className="py-24 md:py-32" style={{ background: c.oat }}>
        <div className="max-w-3xl mx-auto px-6">
          <div className="text-center mb-14">
            <p
              className="text-xs tracking-[0.3em] uppercase mb-4"
              style={{ color: c.rose, fontWeight: 600 }}
            >
              Start the Conversation
            </p>
            <h2
              className="text-4xl md:text-5xl leading-[1.1] mb-4"
              style={{ fontFamily: 'var(--font-cormorant), serif', fontWeight: 300 }}
            >
              Let&apos;s Create Something <em style={{ fontWeight: 500 }}>Beautiful</em>
            </h2>
            <p className="text-base" style={{ color: c.warmGray, fontWeight: 300 }}>
              Tell us about your event and we&apos;ll design a bespoke activation tailored to your brand.
            </p>
          </div>
          <InquiryForm />
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="py-12 border-t" style={{ borderColor: `${c.rose}30`, background: c.cream }}>
        <div className="max-w-5xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <p
              className="text-lg tracking-[0.25em] uppercase"
              style={{ fontFamily: 'var(--font-cormorant), serif', fontWeight: 500 }}
            >
              Atelier Brim
            </p>
            <p className="text-xs mt-1" style={{ color: c.warmGray, fontWeight: 400 }}>
              by{' '}
              <a href="/" className="underline hover:opacity-70 transition-opacity">Host Hampton</a>
              {' '}&middot; Speonk, NY
            </p>
          </div>
          <div className="flex items-center gap-6 text-xs tracking-[0.15em] uppercase" style={{ color: c.warmGray, fontWeight: 500 }}>
            <a href="https://instagram.com/hosthampton" target="_blank" rel="noopener noreferrer" className="hover:opacity-70 transition-opacity">
              Instagram
            </a>
            <a href="mailto:hosthampton295@gmail.com" className="hover:opacity-70 transition-opacity">
              Email
            </a>
            <a href="tel:6319989325" className="hover:opacity-70 transition-opacity">
              (631) 998-9325
            </a>
          </div>
        </div>
        <p className="text-center text-xs mt-8" style={{ color: `${c.warmGray}80` }}>
          &copy; {new Date().getFullYear()} Host Hampton. All rights reserved.
        </p>
      </footer>
    </div>
  )
}
