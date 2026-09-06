import type { Metadata } from 'next'
import Link from 'next/link'
import { Check, Zap, Music, Star, Camera, Smile, ChevronDown } from 'lucide-react'
import GlowHero from './GlowHero'
import UniversalCalendar from '@/components/UniversalCalendar'

export const metadata: Metadata = {
  title: 'Kids Glow Party — Neon Birthday Party Speonk NY',
  description:
    'The ultimate neon glow party for kids in Speonk, NY. Black lights, UV face paint, neon decor, private studio, and professional host. Starting at $950. Book your glow birthday today!',
  keywords: [
    'glow party kids Long Island',
    'neon birthday party Speonk',
    'kids glow party Hamptons',
    'UV face paint party NY',
    'blacklight birthday party kids',
    'glow in the dark party venue',
  ],
  openGraph: {
    title: 'Kids Glow Party',
    description: 'Neon face paint · Private studio · DJ vibes · Black lights — the brightest birthday ever in Speonk, NY.',
  },
}

const whatsIncluded = [
  { icon: Zap,    text: 'UV black lights & neon LED strip lighting throughout the studio' },
  { icon: Music,  text: 'High-energy DJ playlist (Bluetooth speaker + curated glow setlist)' },
  { icon: Smile,  text: 'Neon UV face paint station — professional quality, kid-safe' },
  { icon: Star,   text: 'Custom trucker hat included for every guest' },
  { icon: Star,   text: 'Glow bracelets, neon necklaces & glow accessories for every guest' },
  { icon: Camera, text: 'Neon balloon arch & glowing photo backdrop — perfect for pics' },
  { icon: Check,  text: 'Professional party host on-site for the full 2 hours' },
  { icon: Check,  text: 'Pizza or bagels + cupcakes + juice boxes & bottled water for all guests' },
  { icon: Check,  text: 'Digital EVITE invitation + full setup & cleanup — zero stress' },
]

const packages = [
  { name: 'Mini-Party',     guests: 'Up to 8',  price: 750 },
  { name: 'My Fav 10',      guests: 'Up to 10', price: 950 },
  { name: 'Dazzling Dozen', guests: 'Up to 12', price: 1195 },
  { name: 'Fab 15',         guests: 'Up to 15', price: 1445 },
  { name: 'ALL OUT',        guests: 'Up to 20', price: 1950, popular: true },
]

const addOns = [
  { name: 'Neon T-Shirt Decorating', desc: 'Each guest customizes their own shirt — goes home as a glow favor.', price: '$15/guest' },
  { name: 'Glitter Tattoo Station',  desc: 'Temporary glitter tattoos under UV light look incredible.', price: '$75 flat' },
  { name: 'Cotton Candy Machine',    desc: 'Neon-dyed cotton candy — the ultimate glow party snack.',  price: '$60 flat' },
  { name: 'Extra Hour',             desc: 'Extend your party when the glow keeps going.',              price: '$150' },
]

const faqs = [
  {
    q: 'What age range is the glow party best for?',
    a: 'Ages 6–14 are the sweet spot. Younger kids love the lights and accessories; older kids are obsessed with the face paint and dance floor energy. We can tailor the music and activities to the birthday child\'s age.',
  },
  {
    q: 'Do the clothes get ruined from UV face paint?',
    a: 'UV face paint is water-based and washes off easily. We recommend wearing white or neon-colored clothing so the paint really pops under the black lights — it looks incredible in photos!',
  },
  {
    q: 'Is everything really included in the price?',
    a: 'Yes. The price you see includes all decorations (setup & teardown), the full glow experience (lights, accessories, face paint), food, host, and cleanup. No hidden fees. The only extras are optional add-ons.',
  },
  {
    q: 'How do I book? What is the deposit?',
    a: 'Click "Book the Glow" and fill out the reservation form. A $250 deposit holds your date and is applied toward your total. The remaining balance can be paid any time before the party.',
  },
  {
    q: 'Where are you located?',
    a: '295 Montauk Highway, Suite 7, Speonk NY 11972 — right in the heart of the Hamptons, easy off Montauk Highway.',
  },
]

export default function GlowPartyPage() {
  return (
    <div className="bg-[#05090d] text-white">

      {/* ── Hero ── */}
      <GlowHero />

      {/* ── What's Included ── */}
      <section className="py-20 px-4 max-w-5xl mx-auto">
        <p className="text-green-400 text-sm font-black uppercase tracking-widest text-center mb-2" style={{ textShadow: '0 0 10px #39ff14' }}>
          Everything Glows
        </p>
        <h2 className="text-4xl md:text-5xl font-black text-center mb-4 uppercase tracking-tight">
          What&apos;s{' '}
          <span className="bg-gradient-to-r from-pink-500 to-purple-400 bg-clip-text text-transparent">
            Included
          </span>
        </h2>
        <p className="text-gray-400 text-center mb-12 max-w-lg mx-auto">
          Every glow party includes the full experience — zero hidden costs, zero stress. Our hosts guide each child through every station while you sit back. Scale from an intimate 8-kid glow to a 20-guest blowout.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          {whatsIncluded.map(({ icon: Icon, text }) => (
            <div
              key={text}
              className="flex items-start gap-4 p-5 rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm hover:border-pink-500/50 hover:bg-white/10 transition-all"
            >
              <div className="shrink-0 p-2 rounded-lg bg-pink-500/20 text-pink-400">
                <Icon size={18} />
              </div>
              <p className="text-sm text-gray-300 leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Packages ── */}
      <section id="packages" className="py-20 px-4 border-t border-white/10">
        <div className="max-w-4xl mx-auto">
          <p className="text-cyan-400 text-sm font-black uppercase tracking-widest text-center mb-2">
            Size Up Your Squad
          </p>
          <h2 className="text-4xl md:text-5xl font-black text-center mb-3 uppercase tracking-tight">
            Glow{' '}
            <span className="bg-gradient-to-r from-cyan-400 to-green-400 bg-clip-text text-transparent">
              Packages
            </span>
          </h2>
          <p className="text-gray-400 text-center mb-12 max-w-md mx-auto">
            All packages include 2 hours of private studio time. Choose by guest count.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-8">
            {packages.map((pkg) => (
              <div
                key={pkg.name}
                className={`relative rounded-2xl p-6 border transition-all ${
                  pkg.popular
                    ? 'border-pink-500 bg-gradient-to-b from-pink-950/60 to-purple-950/60 shadow-[0_0_30px_rgba(255,0,255,0.2)]'
                    : 'border-white/10 bg-white/5 hover:border-white/30'
                }`}
              >
                {pkg.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-pink-500 to-purple-500 text-xs font-black uppercase tracking-wider whitespace-nowrap shadow-[0_0_15px_rgba(255,0,255,0.5)]">
                    Most Popular
                  </div>
                )}
                <p className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-1">{pkg.guests}</p>
                <h3 className="text-xl font-black uppercase mb-3">{pkg.name}</h3>
                <p className="text-4xl font-black text-white mb-1">${pkg.price.toLocaleString()}</p>
                <p className="text-gray-500 text-xs mb-5">full glow package · 2 hrs</p>
                <Link
                  href={`/book?theme=glow&package=${pkg.name.toLowerCase().replace(/\s+/g, '-')}`}
                  className={`block w-full text-center py-3 rounded-xl font-bold text-sm uppercase tracking-wider transition-all ${
                    pkg.popular
                      ? 'bg-gradient-to-r from-pink-500 to-purple-600 text-white hover:shadow-[0_0_20px_rgba(255,0,255,0.4)] hover:scale-105'
                      : 'border border-white/20 text-white hover:bg-white/10'
                  }`}
                >
                  Book This Size
                </Link>
              </div>
            ))}
          </div>

          <p className="text-center text-gray-500 text-sm">
            Not sure which size?{' '}
            <Link href="/contact-us" className="text-pink-400 hover:text-pink-300 underline">
              Ask us
            </Link>{' '}
            — we&apos;ll help you pick.
          </p>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="py-20 px-4 border-t border-white/10">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-4xl font-black text-center uppercase tracking-tight mb-16">
            How It{' '}
            <span className="bg-gradient-to-r from-green-400 to-cyan-400 bg-clip-text text-transparent">
              Works
            </span>
          </h2>
          <div className="grid md:grid-cols-3 gap-8 text-center">
            {[
              { step: '01', title: 'Book Online', desc: 'Reserve with a $250 deposit. Pick your date, package size, and any add-ons.', color: 'text-pink-400' },
              { step: '02', title: 'We Set Up Everything', desc: 'Arrive to a fully transformed neon glow studio. UV lights, decor, food — all done.', color: 'text-purple-400' },
              { step: '03', title: 'Glow & Go', desc: 'Your host runs the show. You enjoy the party. We clean up. You walk out stress-free.', color: 'text-green-400' },
            ].map(({ step, title, desc, color }) => (
              <div key={step} className="flex flex-col items-center">
                <div className={`text-7xl font-black mb-4 ${color} opacity-30`}>{step}</div>
                <h3 className="text-xl font-black uppercase mb-3">{title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Add-Ons ── */}
      <section className="py-20 px-4 border-t border-white/10">
        <div className="max-w-4xl mx-auto">
          <p className="text-purple-400 text-sm font-black uppercase tracking-widest text-center mb-2">
            Level Up
          </p>
          <h2 className="text-4xl font-black text-center uppercase tracking-tight mb-12">
            Glow{' '}
            <span className="bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
              Add-Ons
            </span>
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {addOns.map((a) => (
              <div key={a.name} className="p-5 rounded-xl border border-white/10 bg-white/5 hover:border-purple-500/50 transition-all">
                <div className="flex items-start justify-between gap-4 mb-2">
                  <h3 className="font-black text-lg uppercase">{a.name}</h3>
                  <span className="shrink-0 text-purple-400 font-black text-sm">{a.price}</span>
                </div>
                <p className="text-gray-400 text-sm leading-relaxed">{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="py-20 px-4 border-t border-white/10">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-4xl font-black text-center uppercase tracking-tight mb-12">
            Glow{' '}
            <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
              FAQ
            </span>
          </h2>
          <div className="space-y-4">
            {faqs.map((faq) => (
              <details
                key={faq.q}
                className="group rounded-xl border border-white/10 bg-white/5 open:border-pink-500/40 open:bg-white/10 transition-all"
              >
                <summary className="flex items-center justify-between gap-4 p-6 cursor-pointer list-none font-bold text-white">
                  {faq.q}
                  <ChevronDown size={18} className="shrink-0 text-gray-400 group-open:rotate-180 transition-transform" />
                </summary>
                <p className="px-6 pb-6 text-gray-400 text-sm leading-relaxed">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Check Availability ── */}
      <section className="py-20 px-4 border-t border-white/10">
        <div className="max-w-2xl mx-auto">
          <UniversalCalendar
            mode="booking"
            lockedBookingType="kids-party"
            expandable={true}
            initialExpanded={false}
          />
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-24 px-4 text-center border-t border-white/10 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-pink-600/20 blur-[120px] rounded-full pointer-events-none" />
        <div className="relative z-10 max-w-2xl mx-auto">
          <p className="text-pink-400 text-sm font-black uppercase tracking-widest mb-4">
            Ready to Glow?
          </p>
          <h2 className="text-5xl md:text-7xl font-black uppercase tracking-tighter mb-6 leading-none">
            Book Your{' '}
            <span className="bg-gradient-to-r from-pink-500 via-purple-500 to-green-400 bg-clip-text text-transparent">
              Glow Party
            </span>
          </h2>
          <p className="text-gray-400 mb-10 text-lg">
            Dates fill up fast — especially weekends. Secure your spot with a $250 deposit.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/book?theme=glow"
              className="px-12 py-5 rounded-2xl bg-white text-black font-black text-xl uppercase tracking-tighter hover:scale-105 hover:bg-green-400 hover:shadow-[0_0_40px_rgba(57,255,20,0.6)] transition-all flex items-center justify-center gap-3"
            >
              Reserve Your Date
            </Link>
            <Link
              href="/contact-us"
              className="px-12 py-5 rounded-2xl border-2 border-white/20 text-white font-black text-xl uppercase tracking-tighter hover:border-white/60 transition-all"
            >
              Questions? Ask Us
            </Link>
          </div>
          <p className="text-gray-600 text-sm mt-6">
            📍 295 Montauk Hwy, Suite 7 · Speonk, NY · (631) 998-9325
          </p>
        </div>
      </section>
    </div>
  )
}
