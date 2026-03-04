import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { Check, Truck, Palette, Gift, Users, Star, ArrowRight } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Custom Canvas Bags & Trucker Hats — Party Favors',
  description:
    'Personalized canvas bags and custom trucker hats for birthday parties, school groups, sports teams, and special events. Available as party favors or on-site at your event in Speonk, NY.',
  keywords: ['custom party favors long island', 'personalized canvas bags NY', 'custom trucker hats kids party', 'party favor ideas hamptons', 'custom accessories Speonk'],
}

const bagFeatures = [
  'Natural canvas or color options',
  'Custom name, design, or logo',
  'Perfect for party favors or goody bags',
  'Great for school groups & sports teams',
  'Bulk pricing available',
]

const hatFeatures = [
  'Structured & unstructured silhouettes',
  'Iron-on, embroidered, or printed designs',
  'Custom lettering, logos, artwork',
  'Available for kids & adults',
  'On-site hat bar activation option',
]

const useCases = [
  {
    icon: Gift,
    title: 'Party Favors',
    desc: 'Send every guest home with a personalized canvas bag or custom hat they\'ll actually use. The perfect keepsake from your Host Hampton party.',
  },
  {
    icon: Users,
    title: 'Group Orders',
    desc: 'School clubs, sports teams, cheer squads, Girl Scouts — we do bulk orders with custom designs for any group.',
  },
  {
    icon: Truck,
    title: 'On-Site Activation',
    desc: 'Book our live hat or bag bar for your event. Guests pick, personalize, and take home their one-of-a-kind creation in real time.',
  },
  {
    icon: Palette,
    title: 'Fully Custom Design',
    desc: 'Bring your vision or let us design it. Names, artwork, themes, logos — we handle the design and production.',
  },
]

const gallery = [
  { img: '/images/gallery/product-pouches-1.webp', caption: 'Custom Personalized Pouches' },
  { img: '/images/gallery/product-pouches-2.webp', caption: 'Pastel Party Favor Bags' },
  { img: '/images/jewelry-weld.png', caption: 'Custom Hat Bar Activation' },
  { img: '/images/jewelry-gold.png', caption: 'Permanent Jewelry & Accessories' },
]

const reviews = [
  {
    name: 'Melissa T.',
    text: 'We ordered custom canvas bags for my daughter\'s Swiftie party — every guest was obsessed. They made the whole favor table look incredible.',
    stars: 5,
  },
  {
    name: 'Coach Sarah R.',
    text: 'Got custom trucker hats for our whole cheer team. The quality was amazing and the process was so easy. We\'ll definitely be ordering again.',
    stars: 5,
  },
]

export default function CustomAccessoriesPage() {
  return (
    <>
      {/* ── HERO ── */}
      <section className="py-20 md:py-28 px-4 text-center max-w-4xl mx-auto">
        <p className="text-hampton-pink text-sm font-semibold tracking-widest uppercase mb-4">
          Party Favors · Group Orders · Live Activations
        </p>
        <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl text-hampton-navy leading-tight mb-6">
          Custom Canvas Bags<br />& Trucker Hats
        </h1>
        <p className="text-hampton-navy/70 text-lg md:text-xl leading-relaxed mb-8 max-w-2xl mx-auto">
          Personalized accessories that make every guest feel special. Perfect party favors, group orders, and on-site activations for birthdays, teams, and special events.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/contact-us"
            className="bg-hampton-navy text-white font-bold px-8 py-4 rounded-full text-base hover:bg-hampton-navy/90 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5"
          >
            Get a Quote
          </Link>
          <Link
            href="/book"
            className="border-2 border-hampton-navy/40 text-hampton-navy font-semibold px-8 py-4 rounded-full text-base hover:border-hampton-pink transition-all"
          >
            Add to My Party
          </Link>
        </div>
        <div className="flex items-center gap-6 mt-8 justify-center">
          <div className="flex">
            {[...Array(5)].map((_, i) => <Star key={i} size={16} className="text-yellow-400 fill-yellow-400" />)}
          </div>
          <span className="text-hampton-navy/60 text-sm">Loved by Long Island families & teams</span>
        </div>
      </section>

      {/* ── PRODUCTS ── */}
      <section className="py-16 max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid md:grid-cols-2 gap-8">

          {/* Canvas Bags */}
          <div className="bg-white rounded-3xl border border-hampton-pink/20 shadow-sm overflow-hidden">
            <div className="relative aspect-video">
              <Image
                src="/images/theme-sweets.png"
                alt="Custom canvas party bags at Host Hampton"
                fill
                className="object-cover"
              />
              <div className="absolute inset-0 bg-hampton-navy/40 flex items-end p-6">
                <h2 className="font-serif text-3xl text-white font-bold">Canvas Bags</h2>
              </div>
            </div>
            <div className="p-6">
              <p className="text-hampton-navy/70 text-sm leading-relaxed mb-4">
                Natural canvas tote bags personalized with names, artwork, or custom designs. Perfect as party favor bags, goody bags, or keepsakes. We handle the design and print — you just pick them up.
              </p>
              <ul className="space-y-2">
                {bagFeatures.map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-hampton-navy">
                    <Check size={14} className="text-hampton-pink shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Trucker Hats */}
          <div className="bg-white rounded-3xl border border-hampton-pink/20 shadow-sm overflow-hidden">
            <div className="relative aspect-video">
              <Image
                src="/images/jewelry-weld.png"
                alt="Custom trucker hats at Host Hampton"
                fill
                className="object-cover"
              />
              <div className="absolute inset-0 bg-hampton-navy/40 flex items-end p-6">
                <h2 className="font-serif text-3xl text-white font-bold">Trucker Hats</h2>
              </div>
            </div>
            <div className="p-6">
              <p className="text-hampton-navy/70 text-sm leading-relaxed mb-4">
                Customized trucker hats with embroidery, iron-on designs, or printed artwork. Available for kids and adults. Book our live hat bar activation and guests personalize their own hat on the spot.
              </p>
              <ul className="space-y-2">
                {hatFeatures.map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm text-hampton-navy">
                    <Check size={14} className="text-hampton-pink shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── USE CASES ── */}
      <section className="py-16 bg-hampton-pink/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <p className="section-subheading">Perfect For</p>
            <h2 className="section-heading">Every Occasion</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {useCases.map(u => (
              <div key={u.title} className="bg-white rounded-2xl p-6 shadow-sm border border-hampton-pink/20 text-center">
                <div className="w-12 h-12 bg-hampton-pink/20 rounded-full flex items-center justify-center mx-auto mb-4 text-hampton-mauve">
                  <u.icon size={22} />
                </div>
                <h3 className="font-semibold text-hampton-navy text-base mb-2">{u.title}</h3>
                <p className="text-hampton-navy/70 text-sm leading-relaxed">{u.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="py-16 max-w-4xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <p className="section-subheading">Simple Process</p>
          <h2 className="section-heading">How It Works</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            { n: '01', title: 'Tell Us Your Vision', desc: 'Fill out our inquiry form with your event details, quantity, and design ideas (or let us create one for you).' },
            { n: '02', title: 'Approve the Design', desc: 'We send you a digital proof. You approve, tweak, or change it — we don\'t start production until you love it.' },
            { n: '03', title: 'Pick Up or Host On-Site', desc: 'Pick up your finished accessories before your event, or book us to activate our live bar at your party.' },
          ].map(s => (
            <div key={s.n} className="text-center">
              <div className="text-5xl font-serif text-hampton-pink/30 mb-3">{s.n}</div>
              <h3 className="font-semibold text-hampton-navy text-lg mb-2">{s.title}</h3>
              <p className="text-hampton-navy/60 text-sm leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── REVIEWS ── */}
      <section className="py-16 bg-hampton-pink/10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <h2 className="section-heading">What Customers Say</h2>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {reviews.map(r => (
              <div key={r.name} className="bg-white rounded-2xl p-6 shadow-sm border border-hampton-pink/20">
                <div className="flex mb-3">
                  {[...Array(r.stars)].map((_, i) => <Star key={i} size={14} className="text-yellow-400 fill-yellow-400" />)}
                </div>
                <p className="text-hampton-navy text-sm leading-relaxed mb-4 italic">&ldquo;{r.text}&rdquo;</p>
                <p className="font-semibold text-hampton-navy text-sm">{r.name}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-16 max-w-3xl mx-auto px-4 text-center">
        <h2 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-4">
          Ready to Create Something Memorable?
        </h2>
        <p className="text-hampton-navy/70 text-base mb-8">
          Send us your event details and we&apos;ll put together a custom quote. We typically respond within 24 hours.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/contact-us"
            className="bg-hampton-navy text-white font-bold px-8 py-4 rounded-full text-base hover:bg-hampton-navy/90 transition-all shadow-lg hover:-translate-y-0.5"
          >
            Get a Custom Quote <ArrowRight size={16} className="inline ml-1" />
          </Link>
          <Link
            href="/trucker-hat-bar"
            className="border-2 border-hampton-navy/40 text-hampton-navy font-semibold px-8 py-4 rounded-full text-base hover:border-hampton-pink transition-all"
          >
            Corporate Hat Bar Activations
          </Link>
        </div>
      </section>
    </>
  )
}
