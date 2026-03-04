import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { Star, CheckCircle, Clock, Users, Sparkles, Heart, Shield } from 'lucide-react'
import DynamicTypingSection from '@/components/DynamicTypingSection'
import ThemeTileGrid from '@/components/ThemeTileGrid'
import { getSupabase } from '@/lib/supabase'

export const metadata: Metadata = {
  title: 'Birthday Party Venue in the Hamptons, NY',
  description:
    'Magical themed birthday parties, permanent jewelry, and room rentals in Speonk, NY. Stress-free celebrations for ages 3–12. Reserve your date with a $99 deposit.',
}

const themes = [
  { name: 'Glow Party',       price: 950, img: '/images/theme-glow.png',     tag: 'Most Popular' },
  { name: 'Swiftie Party',    price: 850, img: '/images/theme-swiftie.png',  tag: null },
  { name: 'Spa Party',        price: 850, img: '/images/theme-spa.png',      tag: null },
  { name: 'Slime Party',      price: 900, img: '/images/theme-slime.png',    tag: null },
  { name: 'K-Pop Party',      price: 900, img: '/images/theme-kpop.png',     tag: null },
  { name: 'Barbie Party',     price: 850, img: '/images/theme-barbie.png',   tag: null },
  { name: 'Sweets & Treats',  price: 800, img: '/images/theme-sweets.png',   tag: 'Best Value' },
  { name: 'Toddler Party',    price: 850, img: '/images/theme-toddler.png',  tag: 'Ages 2–4' },
]

const whyUs = [
  { icon: <Sparkles size={22} />, title: 'Fully Themed Experiences', desc: 'Every detail handled — decor, activities, entertainment, food. You just show up.' },
  { icon: <Shield size={22} />,   title: 'Private Studio',            desc: 'Your party, your space. Never share the studio with another event.' },
  { icon: <Clock size={22} />,    title: '2-Hour Celebration',        desc: 'Full setup before you arrive, complete cleanup after. Zero stress for parents.' },
  { icon: <Heart size={22} />,    title: 'Flexible to the End',       desc: 'Lock your date with just $99. Finalize every detail up to 1 week before the party.' },
]

const steps = [
  { n: '01', title: 'Pick Your Theme',    desc: 'Browse 10+ themed party packages with everything included.' },
  { n: '02', title: 'Reserve Your Date', desc: 'Pay a $99 deposit to lock in your date. No stress — details can change.' },
  { n: '03', title: 'Celebrate!',         desc: 'Arrive, enjoy, make memories. We handle everything before and after.' },
]

const reviews = [
  { name: 'Jessica M.', theme: 'Glow Party',    stars: 5, text: "Absolutely incredible! My daughter and all her friends had the best time. The studio was perfectly decorated and the staff was so attentive. Worth every penny!" },
  { name: 'Sarah K.',   theme: 'Swiftie Party', stars: 5, text: "Best birthday party decision I ever made. Host Hampton handled EVERYTHING. My daughter was crying tears of joy when she walked in. 10/10 would recommend!" },
  { name: 'Amanda R.',  theme: 'Spa Party',     stars: 5, text: "The girls were in heaven! Mini manicures, face masks, robes — pure magic. The owners clearly put so much love into making it special. We'll be back!" },
]

export const dynamic = 'force-dynamic'

export default async function Home() {
  let themePrices: Array<{ name: string; price_cents: number }> = []
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('pricing_items')
      .select('name, price_cents')
      .eq('category', 'party-theme')
      .eq('is_active', true)
    themePrices = data || []
  } catch {
    // fall back to hardcoded prices in ThemeTileGrid
  }
  return (
    <>
      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-20 md:py-28 flex flex-col md:flex-row items-center gap-12">
          <div className="flex-1 text-center md:text-left">
            <p className="text-hampton-pink text-sm font-semibold tracking-widest uppercase mb-4">
              Speonk, NY • The Hamptons
            </p>
            <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-hampton-navy leading-tight mb-6">
              Create Magical Memories for Your Child's Special Day
            </h1>
            <p className="text-hampton-navy text-lg md:text-xl leading-relaxed mb-8 max-w-lg">
              Full-service themed birthday parties for ages 3–12. Private studio. Zero stress. Just pure celebration.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
              <Link href="/book"
                    className="bg-hampton-pink text-hampton-navy font-bold px-8 py-4 rounded-full text-base hover:bg-opacity-90 transition-all shadow-lg hover:shadow-xl">
                Reserve Your Date
              </Link>
              <Link href="/party-packages"
                    className="border-2 border-hampton-navy/40 text-hampton-navy font-semibold px-8 py-4 rounded-full text-base hover:border-hampton-pink transition-all">
                See Party Packages
              </Link>
            </div>
            <div className="flex items-center gap-6 mt-8 justify-center md:justify-start">
              <div className="flex">
                {[...Array(5)].map((_, i) => <Star key={i} size={16} className="text-yellow-400 fill-yellow-400" />)}
              </div>
              <span className="text-hampton-navy text-sm">Loved by 200+ Long Island families</span>
            </div>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-3 max-w-md w-full">
            {['/images/theme-glow.png', '/images/theme-swiftie.png', '/images/theme-spa.png', '/images/theme-slime.png'].map((src, i) => (
              <div key={i} className={`relative rounded-2xl overflow-hidden aspect-square shadow-xl ${i === 0 ? 'ring-2 ring-hampton-pink' : ''}`}>
                <Image src={src} alt="Party theme" fill className="object-cover" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TRUST BAR ────────────────────────────────────────── */}
      <section className="bg-hampton-pink/20 border-y border-hampton-pink/30 py-4">
        <div className="max-w-7xl mx-auto px-4 flex flex-wrap justify-center gap-6 md:gap-12 text-sm text-hampton-navy font-medium">
          {['✨ 10+ Themed Party Packages', '🎉 Private Studio, No Shared Spaces', '⏱ 2-Hour Full-Service Experience', '💳 $99 Locks Your Date', '🔄 Change Details Anytime'].map(t => (
            <span key={t}>{t}</span>
          ))}
        </div>
      </section>

      {/* ── DYNAMIC TYPING ─────────────────────────────────── */}
      <DynamicTypingSection />

      {/* ── THEMES ───────────────────────────────────────────── */}
      <section className="py-20 max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <p className="section-subheading">Choose Your Celebration</p>
          <h2 className="section-heading">10+ Themed Party Experiences</h2>
          <p className="text-hampton-navy text-base max-w-xl mx-auto">
            Tap any theme to see what&apos;s included. Each party is 2 private hours — decor, activities, pizza, cupcakes, and memories that last forever.
          </p>
        </div>
        <ThemeTileGrid themePrices={themePrices} />
        <div className="text-center mt-8">
          <Link href="/party-packages" className="btn-secondary">View All Packages & Pricing</Link>
        </div>
      </section>

      {/* ── DESIGN YOUR PARTY CTA ─────────────────────────── */}
      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto bg-gradient-to-b from-[#BCCDEB]/40 to-[#F7F2E8]/10 rounded-3xl px-8 py-12 text-center border border-[#A1B5C8]/30">
          <p className="text-hampton-navy text-sm font-semibold tracking-widest uppercase mb-3">Build It Your Way</p>
          <h2 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-4">Design Your Perfect Party</h2>
          <p className="text-hampton-navy/70 text-base max-w-xl mx-auto mb-8 leading-relaxed">
            Browse our full menu, pick your theme, choose add-ons, and see your real-time price — all before you commit to anything.
          </p>
          <Link
            href="/kids-party-menu"
            className="inline-block bg-hampton-navy text-hampton-ivory font-bold px-10 py-4 rounded-full text-base hover:bg-hampton-navy/90 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
          >
            Design Your Party
          </Link>
          <p className="text-hampton-navy/40 text-xs mt-4">Reserve with just $99 · Change details anytime</p>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────── */}
      <section className="bg-gradient-to-r from-hampton-pink to-hampton-pink/30 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <p className="text-hampton-navy text-sm font-semibold tracking-widest uppercase mb-2">Simple & Stress-Free</p>
            <h2 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-4">How It Works</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {steps.map(s => (
              <div key={s.n} className="text-center">
                <div className="text-5xl font-serif text-hampton-navy/20 mb-3">{s.n}</div>
                <h3 className="font-semibold text-hampton-navy text-lg mb-2">{s.title}</h3>
                <p className="text-hampton-navy/70 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-12">
            <Link href="/book"
                  className="bg-hampton-pink text-hampton-navy font-bold px-8 py-4 rounded-full text-base hover:bg-opacity-90 transition-all shadow-lg">
              Reserve Your Date
            </Link>
            <p className="text-hampton-navy/70 text-xs mt-3">Change your theme, date, or details any time. Your $99 deposit is fully applied to your balance.</p>
          </div>
        </div>
      </section>

      {/* ── WHY HOST HAMPTON ─────────────────────────────────── */}
      <section className="py-20 max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <p className="section-subheading">Why Families Love Us</p>
          <h2 className="section-heading">One Space. Endless Celebrations.</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {whyUs.map(w => (
            <div key={w.title} className="bg-white border border-hampton-pink/20 rounded-2xl p-6 text-center hover:shadow-md transition-shadow">
              <div className="w-12 h-12 bg-hampton-pink/20 rounded-full flex items-center justify-center mx-auto mb-4 text-hampton-navy">
                {w.icon}
              </div>
              <h3 className="font-semibold text-hampton-navy text-base mb-2">{w.title}</h3>
              <p className="text-hampton-navy text-sm leading-relaxed">{w.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── REVIEWS ──────────────────────────────────────────── */}
      <section className="bg-hampton-pink/10 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <p className="section-subheading">Real Stories</p>
            <h2 className="section-heading">What Parents Are Saying</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {reviews.map(r => (
              <div key={r.name} className="bg-white rounded-2xl p-6 shadow-sm border border-hampton-pink/20">
                <div className="flex mb-3">
                  {[...Array(r.stars)].map((_, i) => <Star key={i} size={14} className="text-yellow-400 fill-yellow-400" />)}
                </div>
                <p className="text-hampton-navy text-sm leading-relaxed mb-4 italic">"{r.text}"</p>
                <div>
                  <p className="font-semibold text-hampton-navy text-sm">{r.name}</p>
                  <p className="text-hampton-navy text-xs">{r.theme}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── OTHER SERVICES ───────────────────────────────────── */}
      <section className="py-20 max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <p className="section-subheading">More at Host Hampton</p>
          <h2 className="section-heading">Not Just Parties</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { href: '/party-room-rental',    title: 'Room Rental',           desc: 'DIY your event in our beautiful private studio. Starting at $450 for 3 hours.',                    img: '/images/theme-sweets.png' },
            { href: '/permanent-jewelry',    title: 'Permanent Jewelry',     desc: 'Custom-welded bracelets, anklets, and necklaces. Perfect for moms & daughter pairs.',              img: '/images/jewelry-gold.png' },
            { href: '/events',               title: 'Events & Classes',      desc: 'Moms in the Morning, Girls Night Out, craft workshops, and more.',                                 img: '/images/theme-spa.png' },
            { href: '/custom-accessories',   title: 'Custom Accessories',    desc: 'Personalized canvas bags & trucker hats — perfect party favors or on-site at your event.',        img: '/images/jewelry-weld.png' },
          ].map(s => (
            <Link href={s.href} key={s.href} className="card group">
              <div className="relative aspect-video overflow-hidden">
                <Image src={s.img} alt={s.title} fill className="object-cover group-hover:scale-105 transition-transform duration-300" />
              </div>
              <div className="p-5">
                <h3 className="font-semibold text-hampton-navy text-base mb-1">{s.title}</h3>
                <p className="text-hampton-navy text-sm leading-relaxed">{s.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── CTA BANNER ───────────────────────────────────────── */}
      <section className="bg-gradient-to-r from-hampton-pink to-hampton-mauve py-16">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-4">
            Ready to Start Planning?
          </h2>
          <p className="text-hampton-navy/70 text-base mb-8">
            Pick a date. Select your theme, decide the details later — no pressure, no stress.
          </p>
          <Link href="/book"
                className="bg-hampton-navy text-hampton-ivory font-bold px-10 py-4 rounded-full text-base hover:bg-opacity-90 transition-all shadow-xl">
            Reserve Your Date Now
          </Link>
        </div>
      </section>
    </>
  )
}
