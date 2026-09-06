import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { Star, CheckCircle, Clock, Users, Sparkles, Heart, Shield, Palette } from 'lucide-react'
import DynamicTypingSection from '@/components/DynamicTypingSection'
import ThemeTileGrid, { ThemeData } from '@/components/ThemeTileGrid'
import { getSupabase } from '@/lib/supabase'

const HH_URL = 'https://www.hosthampton.com'

const reviewSchema = [
  { name: 'Jessica M.', stars: 5, text: 'Absolutely incredible! My daughter and all her friends had the best time. The studio was perfectly decorated and the staff was so attentive. Worth every penny!' },
  { name: 'Sarah K.', stars: 5, text: 'Best birthday party decision I ever made. Host Hampton handled EVERYTHING. My daughter was crying tears of joy when she walked in. 10/10 would recommend!' },
  { name: 'Amanda R.', stars: 5, text: 'The girls were in heaven! Mini manicures, face masks, robes — pure magic. The owners clearly put so much love into making it special. We’ll be back!' },
].map(r => ({
  '@context': 'https://schema.org',
  '@type': 'Review',
  itemReviewed: { '@type': 'LocalBusiness', name: 'Host Hampton', url: HH_URL },
  author: { '@type': 'Person', name: r.name },
  reviewRating: { '@type': 'Rating', ratingValue: r.stars, bestRating: 5, worstRating: 1 },
  reviewBody: r.text,
}))

export const metadata: Metadata = {
  title: 'Kids Birthday Parties on Long Island & the Hamptons',
  description:
    'Upscale themed kids birthday parties on Long Island — at our private Hamptons studio in Speonk, or mobile at your house — at prices you\u2019d pay anywhere. Hands-on hosts, fully customizable, stress-free. Reserve with a $250 deposit.',
}

const themes = [
  { name: 'Glow Party',       price: 950, img: '/images/theme-glow.webp',     tag: 'Most Popular' },
  { name: 'Swiftie Party',    price: 850, img: '/images/theme-swiftie.webp',  tag: null },
  { name: 'Spa Party',        price: 850, img: '/images/theme-spa.webp',      tag: null },
  { name: 'Slime Party',      price: 900, img: '/images/theme-slime.webp',    tag: null },
  { name: 'K-Pop Party',      price: 900, img: '/images/theme-kpop.webp',     tag: null },
  { name: 'Barbie Party',     price: 850, img: '/images/theme-barbie.webp',   tag: null },
  { name: 'Sweets & Treats',  price: 800, img: '/images/theme-sweets.webp',   tag: 'Best Value' },
  { name: 'Toddler Party',    price: 850, img: '/images/theme-toddler.webp',  tag: 'Ages 2–4' },
]

const whyUs = [
  { icon: <Sparkles size={22} />, title: 'Hands-On Hosts', desc: 'We don\u2019t just set up and step back. Our hosts guide every child through every activity so parents can actually relax.' },
  { icon: <Shield size={22} />,   title: 'Upscale & Private',         desc: 'A beautifully styled Hamptons studio — exclusively yours. No shared spaces, no outside noise.' },
  { icon: <Clock size={22} />,    title: 'Fully Handled',             desc: 'We set up before you arrive and clean up after you leave. You show up, enjoy, and walk out.' },
  { icon: <Heart size={22} />,    title: 'Your Party, Your Budget',   desc: 'Add extras or keep it simple. Scale up for a blowout, scale down for something intimate. A $250 deposit locks your date.' },
]

const steps = [
  { n: '01', title: 'Pick Your Theme',    desc: 'Browse 10+ themed party packages with everything included.' },
  { n: '02', title: 'Reserve Your Date', desc: 'Pay a $250 deposit to lock in your date. No stress — details can change.' },
  { n: '03', title: 'Celebrate!',         desc: 'Arrive, enjoy, make memories. We handle everything before and after.' },
]

const reviews = [
  { name: 'Jessica M.', theme: 'Glow Party',    stars: 5, text: "Absolutely incredible! My daughter and all her friends had the best time. The studio was perfectly decorated and the staff was so attentive. Worth every penny!" },
  { name: 'Sarah K.',   theme: 'Swiftie Party', stars: 5, text: "Best birthday party decision I ever made. Host Hampton handled EVERYTHING. My daughter was crying tears of joy when she walked in. 10/10 would recommend!" },
  { name: 'Amanda R.',  theme: 'Spa Party',     stars: 5, text: "The girls were in heaven! Mini manicures, face masks, robes — pure magic. The owners clearly put so much love into making it special. We'll be back!" },
]

export const dynamic = 'force-dynamic'

export default async function Home() {
  let themes: ThemeData[] = []
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('party_themes')
      .select('name, slug, price_cents, tag, description, extended_description, images')
      .eq('is_active', true)
      .order('sort_order')
    themes = (data || []) as ThemeData[]
  } catch {
    // fall back to hardcoded themes in ThemeTileGrid
  }
  return (
    <>
      {reviewSchema.map((node, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(node) }} />
      ))}
      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-20 md:py-28 flex flex-col md:flex-row items-center gap-12">
          <div className="flex-1 text-center md:text-left">
            <p className="text-hampton-pink text-sm font-semibold tracking-widest uppercase mb-4">
              Long Island &amp; the Hamptons • Speonk, NY
            </p>
            <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-hampton-navy leading-tight mb-6">
              Kids Birthday Parties on Long Island — <span className="italic text-hampton-blue">at Our Studio or Your House</span>
            </h1>
            <p className="text-hampton-navy text-lg md:text-xl leading-relaxed mb-8 max-w-lg">
              Hands-on hosts guide every child through every activity — at our private Hamptons studio in Speonk, or we bring the whole party to your home. Upscale experience, at prices you&apos;d pay anywhere.
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
            {['/images/theme-glow.webp', '/images/theme-barbie.webp', '/images/theme-spa.webp', '/images/theme-sweets.webp'].map((src, i) => (
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
          {['✨ Hamptons Vibe, Honest Pricing', '🎉 Private Studio — All Yours', '⏱ 2 Hours, Fully Hosted', '💳 $250 Locks Your Date', '🔄 Customize Everything'].map(t => (
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
            Every theme is 2 private hours — decor, hands-on activities, food, and a dedicated host who keeps the energy going from start to finish.
          </p>
        </div>
        <ThemeTileGrid themes={themes} />
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
            Pick your theme, add extras or keep it simple, and see your price in real time. Customize everything to fit your vision and your budget.
          </p>
          <Link
            href="/kids-party-menu"
            className="inline-block bg-hampton-navy text-hampton-ivory font-bold px-10 py-4 rounded-full text-base hover:bg-hampton-navy/90 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
          >
            Design Your Party
          </Link>
          <p className="text-hampton-navy/40 text-xs mt-4">Reserve with a simple $250 deposit · Change details anytime</p>
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
            <p className="text-hampton-navy/70 text-xs mt-3">Change your theme, date, or details any time. Your $250 deposit is fully applied to your balance.</p>
          </div>
        </div>
      </section>

      {/* ── WHY HOST HAMPTON ─────────────────────────────────── */}
      <section className="py-20 max-w-7xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <p className="section-subheading">Why Families Choose Us</p>
          <h2 className="section-heading">Elevated Parties. Honest Prices.</h2>
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

      {/* ── MOBILE CRAFT PARTY BAND ──────────────────────────── */}
      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto bg-hampton-navy rounded-3xl overflow-hidden">
          <div className="grid md:grid-cols-2 items-center">
            <div className="p-8 md:p-12">
              <p className="text-hampton-pink text-sm font-semibold tracking-widest uppercase mb-3 flex items-center gap-2">
                <Palette size={16} /> Can’t Come to Us?
              </p>
              <h2 className="font-serif text-3xl md:text-4xl text-white leading-tight mb-4">
                We Bring the Craft Party <span className="italic text-hampton-pink">to You</span>
              </h2>
              <p className="text-white/70 text-base leading-relaxed mb-6 max-w-md">
                Canvas painting, sand art, drip-paint balloon dogs, slime and more — at your home anywhere
                on Long Island, from East Hampton to Nassau County. Same crafts, same hosts, your place or ours.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link href="/mobile-craft-party" className="bg-hampton-pink text-hampton-navy font-bold px-7 py-3.5 rounded-full text-sm hover:bg-opacity-90 transition-all shadow-lg text-center">
                  Explore Mobile Craft Parties
                </Link>
                <Link href="/mobile-party" className="border-2 border-white/30 text-white font-semibold px-7 py-3.5 rounded-full text-sm hover:border-hampton-pink transition-all text-center">
                  See the Full Menu
                </Link>
              </div>
            </div>
            <div className="relative h-64 md:h-full min-h-[280px]">
              <Image src="/images/gallery/venue-craft-station.webp" alt="Mobile craft party — canvas painting and crafts" fill className="object-cover" />
            </div>
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
            { href: '/party-room-rental',    title: 'Room Rental',           desc: 'DIY your event in our beautiful private studio. Starting at $475 for 3 hours.',                    img: '/images/gallery/venue-party-setup-5.webp' },
            { href: '/permanent-jewelry',    title: 'Permanent Jewelry',     desc: 'Custom-welded bracelets, anklets, and necklaces. Perfect for moms & daughter pairs.',              img: '/images/jewelry-gold.png' },
            { href: '/events',               title: 'Events & Classes',      desc: 'Moms in the Morning, Girls Night Out, craft workshops, and more.',                                 img: '/images/gallery/venue-painting-workshop.webp' },
            { href: '/custom-accessories',   title: 'Custom Accessories',    desc: 'Personalized canvas bags & trucker hats — perfect party favors or on-site at your event.',        img: '/images/gallery/product-pouches-1.webp' },
          ].map(s => (
            <Link href={s.href} key={s.href} className="card group">
              <div className="relative aspect-[3/4] overflow-hidden">
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
            Your Kid Deserves the Good Party
          </h2>
          <p className="text-hampton-navy/70 text-base mb-8">
            Lock in your date with a $250 deposit. Pick your theme, tweak the details later — we make it easy.
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
