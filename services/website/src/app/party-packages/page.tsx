import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { Check } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Party Packages & Pricing | Host Hampton',
  description: 'View all themed birthday party packages at Host Hampton. Glow, Swiftie, Spa, Slime, K-Pop, Barbie and more. Starting at $800. Reserve with a $250 deposit.',
}

const sizePackages = [
  { name: 'Mini-Party',      guests: 'Up to 8',  price: 650,   hours: 2 },
  { name: 'My Fav 10',       guests: 'Up to 10', price: 800,   hours: 2 },
  { name: 'Dazzling Dozen',  guests: 'Up to 12', price: 1045,  hours: 2 },
  { name: 'Fab 15',          guests: 'Up to 15', price: 1295,  hours: 2 },
  { name: 'ALL OUT',         guests: 'Up to 20', price: 1850,  hours: 2, popular: true },
]

const included = [
  '2 hours of exclusive private studio time',
  'Professional party host on-site',
  'Full themed decorations (setup included)',
  'Theme-matched activities & entertainment',
  'Pizza or bagels for all guests',
  'Cupcakes & birthday cake',
  'Treat cart',
  'Digital EVITE invitation',
  'Full cleanup — you walk out the door stress-free',
]

const themes = [
  { name: 'Glow Party',          price: 950,  img: '/images/theme-glow.png',     desc: 'Black lights, UV face paint, neon accessories, glow bracelets, and a dance party.',   popular: true },
  { name: 'Slime Party',         price: 900,  img: '/images/theme-slime.png',     desc: 'Custom slime-making station with personalized containers and messy fun.' },
  { name: 'K-Pop Demon Hunter',  price: 900,  img: '/images/theme-kpop.png',      desc: 'K-pop karaoke, dance lesson, neon decor, and hair tinsel.' },
  { name: 'Trucker Hat Bar',     price: 900,  img: '/images/theme-sweets.png',    desc: 'Iron-on patches, photo booth, and totally custom trucker hats as favors.' },
  { name: 'Spa Party',           price: 850,  img: '/images/theme-spa.png',       desc: 'Mini manicures, hair styling, face masks, robes, and full glam experience.' },
  { name: 'Swiftie Party',       price: 850,  img: '/images/theme-swiftie.png',   desc: 'Karaoke, friendship bracelets, hair tinsel, glitter, and all the feels.' },
  { name: 'Barbie Party',        price: 850,  img: '/images/theme-barbie.png',    desc: 'Life-size Barbie box photo op, fashion show, and glam styling.' },
  { name: 'Unicorn Party',       price: 850,  img: '/images/theme-glow.png',      desc: 'Headbands, glitter crafts, rainbow decor, and magical unicorn activities.' },
  { name: 'Toddler Party',       price: 850,  img: '/images/theme-toddler.png',   desc: 'Soft play, ball pit, sensory activities, and themed decor for ages 2–4.' },
  { name: 'Sweets & Treats',     price: 800,  img: '/images/theme-sweets.png',    desc: 'Cookie and cupcake decorating, candy wall, dessert stations, and sweet fun.' },
]

export default function PartyPackages() {
  return (
    <div className="bg-hampton-ivory">
      {/* Header */}
      <section className="bg-hampton-navy py-16 text-center">
        <p className="text-hampton-pink text-sm font-semibold tracking-widest uppercase mb-3">Everything Included</p>
        <h1 className="font-serif text-4xl md:text-5xl text-white mb-4">Party Packages & Pricing</h1>
        <p className="text-hampton-blue/80 text-lg max-w-xl mx-auto">
          Choose your guest count, then pick the theme that makes your child's heart sing.
        </p>
      </section>

      {/* What's Included */}
      <section className="py-16 max-w-4xl mx-auto px-4 sm:px-6">
        <h2 className="section-heading text-center mb-2">Every Party Includes</h2>
        <p className="text-center text-hampton-mauve mb-8">No hidden costs. No upcharges. Everything below is included.</p>
        <div className="bg-white rounded-2xl border border-hampton-pink/20 p-8 grid sm:grid-cols-2 gap-3">
          {included.map(item => (
            <div key={item} className="flex items-start gap-2">
              <Check size={16} className="text-hampton-mauve shrink-0 mt-0.5" />
              <span className="text-hampton-navy text-sm">{item}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Size Packages */}
      <section className="py-8 max-w-4xl mx-auto px-4 sm:px-6">
        <h2 className="section-heading text-center mb-2">Choose Your Party Size</h2>
        <p className="text-center text-hampton-mauve mb-8">Base price by guest count. Then add your theme below.</p>
        <div className="grid sm:grid-cols-3 md:grid-cols-5 gap-4">
          {sizePackages.map(p => (
            <div key={p.name}
                 className={`rounded-2xl p-5 text-center border-2 ${p.popular ? 'border-hampton-pink bg-hampton-pink/10' : 'border-hampton-pink/20 bg-white'}`}>
              {p.popular && <p className="text-hampton-mauve text-xs font-bold mb-1 uppercase tracking-wide">Most Popular</p>}
              <h3 className="font-serif text-hampton-navy text-base font-bold mb-1">{p.name}</h3>
              <p className="text-hampton-mauve text-xs mb-3">{p.guests} guests</p>
              <p className="text-2xl font-bold text-hampton-navy">${p.price.toLocaleString()}</p>
              <p className="text-hampton-mauve text-xs mt-1">{p.hours} hours</p>
            </div>
          ))}
        </div>
      </section>

      {/* Theme Packages */}
      <section className="py-16 max-w-7xl mx-auto px-4 sm:px-6">
        <h2 className="section-heading text-center mb-2">Choose Your Theme</h2>
        <p className="text-center text-hampton-mauve mb-10">Prices shown for up to 10 guests. Select your size above to adjust.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {themes.map(t => (
            <div key={t.name} className={`card group ${t.popular ? 'ring-2 ring-hampton-pink' : ''}`}>
              {t.popular && (
                <div className="bg-hampton-pink text-hampton-navy text-xs font-bold text-center py-1.5 tracking-wide uppercase">
                  ⭐ Most Popular
                </div>
              )}
              <div className="relative aspect-video overflow-hidden">
                <Image src={t.img} alt={t.name} fill className="object-cover group-hover:scale-105 transition-transform duration-300" />
              </div>
              <div className="p-5">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-semibold text-hampton-navy text-base">{t.name}</h3>
                  <span className="text-hampton-navy font-bold text-lg">${t.price.toLocaleString()}</span>
                </div>
                <p className="text-hampton-mauve text-sm leading-relaxed mb-4">{t.desc}</p>
                <Link href={`/book?package=${encodeURIComponent(t.name)}`}
                      className="block w-full text-center bg-hampton-navy text-hampton-ivory text-sm font-semibold py-2.5 rounded-full hover:bg-opacity-90 transition-all">
                  Reserve This Party
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-hampton-pink/20 py-14 text-center px-4">
        <h2 className="section-heading mb-3">Ready to Book?</h2>
        <p className="text-hampton-mauve text-base mb-7 max-w-md mx-auto">
          Pay the $250 deposit to lock your date. Finalize theme, guest count, and add-ons up to 1 week before the party.
        </p>
        <Link href="/book" className="btn-primary text-base px-10 py-4">
          Reserve Your Date — $250 Deposit
        </Link>
      </section>
    </div>
  )
}
