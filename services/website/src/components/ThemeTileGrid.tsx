'use client'

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { X, Check, Star, Users, Clock } from 'lucide-react'
import ImageSlider from '@/components/ImageSlider'

const MINI_PARTY_DISCOUNT = 200

interface ThemePrice {
  name: string
  price_cents: number
}

function lookupPrice(displayName: string, prices: ThemePrice[], fallback: number): number {
  if (!prices.length) return fallback
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
  const key = norm(displayName).split(' ')[0]
  const match = prices.find(p => norm(p.name).startsWith(key))
  return match ? match.price_cents / 100 : fallback
}

const included = [
  '2 hours of exclusive private studio time',
  'Professional party host on-site',
  'Full themed decorations (setup included)',
  'Theme-matched activities & entertainment',
  'Pizza or bagels for all guests',
  'Cupcakes for all guests',
  'Juice boxes and bottled water for all guests',
  'Treat cart',
  'Digital EVITE invitation',
  'Full cleanup — you walk out the door stress-free',
]

const themes = [
  {
    name: 'Glow Party',
    price: 950,
    imgs: ['/images/theme-glow.png'],
    tag: 'Most Popular',
    desc: 'Black lights, UV face paint, neon accessories, glow bracelets, custom trucker hat, and a dance party.',
    extendedDesc: 'Transform our studio into a neon wonderland! Every guest gets a custom trucker hat, glow bracelets, neon necklaces, and UV face paint from our professional station. The entire studio is lit with black lights and neon LED strips. We crank up the DJ playlist, and kids dance the night away in a truly electric atmosphere. The perfect party for ages 6–14.',
  },
  {
    name: 'Swiftie Party',
    price: 850,
    imgs: ['/images/theme-swiftie.png'],
    tag: null,
    desc: 'Eras Tour-inspired decor, friendship bracelets, decorate your own glasses, and all the Taylor Swift anthems.',
    extendedDesc: 'Welcome to the Eras Tour — right in our studio! Guests make their own friendship bracelets, decorate their own glasses, sing along to curated Taylor Swift playlists, and pose in front of our Swiftie photo backdrop. The space is decked out in all of Taylor\'s signature colors and aesthetic. Perfect for the Swifties ages 6–14.',
  },
  {
    name: 'Spa Party',
    price: 850,
    imgs: ['/images/theme-spa.png'],
    tag: null,
    desc: 'Mini manicures, mini facials, face masks, robes, cucumbers, and full spa-day vibes.',
    extendedDesc: 'Roll out the red carpet — our studio becomes a luxury spa! Every guest gets a robe, cucumber eye pads, mini facials, a DIY face mask, and a mini manicure. We pipe in relaxing music and set up the full spa aesthetic. Totally kid-safe products, totally unforgettable. Ideal for ages 6–12.',
  },
  {
    name: 'Slime Party',
    price: 900,
    imgs: ['/images/theme-slime.png', '/images/slime-party-1.jpg', '/images/slime-party-2.jpg', '/images/slime-party-3.jpg', '/images/slime-party-4.jpg'],
    tag: null,
    desc: 'Choose your slime theme! Custom slime-making station with personalized containers and messy fun.',
    extendedDesc: 'Get ready for the ultimate slime lab! Choose a slime theme and each guest creates their own custom slime — picking colors, glitter, and add-ins at our slime-making station. They take home their creation in personalized containers. The studio is transformed with slime-themed decor and activities. Perfect for ages 5–12.',
  },
  {
    name: 'K-Pop Party',
    price: 900,
    imgs: ['/images/theme-kpop.png'],
    tag: null,
    desc: 'Hair glitter, decorate your own microphone or trucker hat, glitter tattoos, and all the K-pop vibes.',
    extendedDesc: 'Your favorite K-pop stars come to life! Guests get hair glitter, decorate their own microphone or trucker hat, enjoy glitter tattoos, and strike poses at our photo wall. The studio is lit with stage lighting and filled with K-pop energy. We can make it neon glow if preferred. Awesome for fans ages 7–14.',
  },
  {
    name: 'Barbie Party',
    price: 850,
    imgs: ['/images/theme-barbie.png'],
    tag: null,
    desc: 'Pink everything, Barbie manicure, fashion design station, and Barbie World brought to life.',
    extendedDesc: 'Welcome to Barbie World! The studio is fully pink and glamorous. Guests enjoy a Barbie manicure, design their own Barbie outfits at our fashion station, walk the runway, and strike their best Barbie poses at the photo wall. We\'ve got all the iconic accessories and Barbie-worthy activities. For ages 4–12.',
  },
  {
    name: 'Sweets & Treats',
    price: 800,
    imgs: ['/images/theme-sweets.png'],
    tag: 'Best Value',
    desc: 'Cookie, cupcake, and donut decorating — plus decorate your own apron to take home!',
    extendedDesc: 'A party as sweet as the birthday star! Guests decorate their own cookies, cupcakes, or donuts and get to decorate their own aprons to take home. The studio is transformed into a pastel dreamland with sweet-themed decor. Perfect for ages 3–10 who love all things sweet.',
  },
  {
    name: 'Sleep Under Party',
    price: 900,
    imgs: ['/images/theme-spa.png'],
    tag: 'New',
    desc: 'Cozy styled tents, bedazzle a hairbrush, hairstyling, mini pink facials, and sleepover vibes.',
    extendedDesc: 'The ultimate sleepover experience — without the actual sleepover! Each guest gets their own cozy styled tent with air mattress setup. Activities include bedazzling their own hairbrush to take home, fun hairstyling sessions, and relaxing mini pink facials. All the sleepover magic, and you still pick them up at the end!',
  },
  {
    name: 'Toddler Party',
    price: 850,
    imgs: ['/images/theme-toddler.png'],
    tag: 'Ages 2–4',
    desc: 'Safe, sensory-friendly activities perfectly designed for little ones.',
    extendedDesc: 'The sweetest little celebration! Designed specifically for toddlers ages 2–4, this party features age-appropriate sensory activities, soft play elements, and a magical setup that\'s perfect for the birthday star and their little friends. Safe, fun, and oh-so-adorable.',
  },
]

export default function ThemeTileGrid({ themePrices = [] }: { themePrices?: ThemePrice[] }) {
  const [activeTheme, setActiveTheme] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const selected = themes.find(t => t.name === activeTheme)

  // Scroll the expanded panel into view when a theme is selected
  useEffect(() => {
    if (!activeTheme) return
    const t = setTimeout(() => {
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => clearTimeout(t)
  }, [activeTheme])

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {themes.map(t => {
          const regularPrice = lookupPrice(t.name, themePrices, t.price)
          const miniPrice = regularPrice - MINI_PARTY_DISCOUNT
          return (
            <button
              key={t.name}
              type="button"
              onClick={() => setActiveTheme(activeTheme === t.name ? null : t.name)}
              className={`card group cursor-pointer text-left transition-all duration-200 ${
                activeTheme === t.name ? 'ring-2 ring-hampton-navy shadow-lg' : 'hover:shadow-md'
              }`}
            >
              <div className="relative aspect-[4/3] overflow-hidden">
                <Image
                  src={t.imgs[0]}
                  alt={t.name}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-300"
                />
                {t.tag && (
                  <span className="absolute top-2 left-2 bg-hampton-pink text-hampton-navy text-xs font-bold px-2 py-0.5 rounded-full">
                    {t.tag}
                  </span>
                )}
                {activeTheme === t.name && (
                  <div className="absolute inset-0 bg-hampton-navy/20 flex items-center justify-center">
                    <span className="bg-hampton-navy text-white text-xs font-bold px-3 py-1 rounded-full">Selected</span>
                  </div>
                )}
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-hampton-navy text-sm tracking-wide mb-1">{t.name}</h3>
                <p className="text-hampton-navy text-xs">Starting at ${miniPrice.toLocaleString()}</p>
              </div>
            </button>
          )
        })}
      </div>

      {/* ── Expanded Detail Panel ── */}
      {selected && (() => {
        const regularPrice = lookupPrice(selected.name, themePrices, selected.price)
        const miniPrice = regularPrice - MINI_PARTY_DISCOUNT
        return (
          <div
            ref={panelRef}
            className="mt-6 bg-white border-2 border-hampton-navy rounded-3xl overflow-hidden shadow-xl animate-in fade-in slide-in-from-top-2 duration-300 scroll-mt-24"
          >
            <div className="flex items-center justify-between px-6 py-4 bg-hampton-navy">
              <div className="flex items-center gap-2">
                {selected.tag && (
                  <span className="bg-hampton-pink text-hampton-navy text-xs font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1">
                    <Star size={10} /> {selected.tag}
                  </span>
                )}
                <h3 className="font-serif text-xl font-bold text-white">{selected.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveTheme(null)}
                className="text-white/60 hover:text-white transition-colors p-1"
                aria-label="Close details"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-hampton-pink/20">
              {/* Left: photo gallery + description + pricing tiers */}
              <div>
                <ImageSlider
                  images={selected.imgs}
                  alt={selected.name}
                  aspectRatio="aspect-[16/9]"
                  autoPlayMs={3500}
                />
                <div className="p-6">
                  <p className="text-hampton-navy/60 text-xs font-semibold tracking-widest uppercase mb-3">About This Party</p>
                  <p className="text-hampton-navy leading-relaxed text-sm mb-5">{selected.extendedDesc}</p>

                  {/* Pricing tiers */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-hampton-pink/15 rounded-2xl p-4">
                      <p className="text-hampton-navy text-xs font-bold uppercase tracking-wide mb-2">Mini Party</p>
                      <div className="flex items-center gap-1 text-hampton-navy/70 text-xs mb-1">
                        <Users size={11} /> <span>Up to 7 guests</span>
                      </div>
                      <div className="flex items-center gap-1 text-hampton-navy/70 text-xs mb-3">
                        <Clock size={11} /> <span>1.5 hrs</span>
                      </div>
                      <p className="font-bold text-hampton-navy text-base">${miniPrice.toLocaleString()}</p>
                    </div>
                    <div className="bg-hampton-navy/5 rounded-2xl p-4">
                      <p className="text-hampton-navy text-xs font-bold uppercase tracking-wide mb-2">Classic Party</p>
                      <div className="flex items-center gap-1 text-hampton-navy/70 text-xs mb-1">
                        <Users size={11} /> <span>10 guests</span>
                      </div>
                      <div className="flex items-center gap-1 text-hampton-navy/70 text-xs mb-3">
                        <Clock size={11} /> <span>2 hrs</span>
                      </div>
                      <p className="font-bold text-hampton-navy text-base">${regularPrice.toLocaleString()}</p>
                    </div>
                  </div>
                  <p className="text-hampton-navy/40 text-xs mt-2">+$35 per additional guest</p>
                </div>
              </div>

              {/* Right: included items */}
              <div className="p-6">
                <p className="text-hampton-navy/60 text-xs font-semibold tracking-widest uppercase mb-3">Every Party Includes</p>
                <ul className="space-y-2">
                  {included.map(item => (
                    <li key={item} className="flex items-start gap-2 text-sm text-hampton-navy">
                      <Check size={14} className="text-hampton-pink shrink-0 mt-0.5" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="px-6 py-4 bg-hampton-pink/10 border-t border-hampton-pink/20 flex flex-col sm:flex-row gap-3 items-center justify-between">
              <p className="text-hampton-navy/70 text-xs text-center sm:text-left">
                Lock your date with a <strong>$99 deposit</strong> — change theme or details any time.
              </p>
              <div className="flex gap-3 shrink-0">
                <Link
                  href="/kids-party-menu"
                  className="border-2 border-hampton-navy text-hampton-navy font-semibold px-5 py-2 rounded-full text-sm hover:bg-hampton-navy hover:text-white transition-all"
                >
                  Customize & Price
                </Link>
                <Link
                  href={`/book?package=${encodeURIComponent(selected.name)}`}
                  className="bg-hampton-navy text-white font-bold px-6 py-2 rounded-full text-sm hover:bg-hampton-navy/90 transition-all shadow-sm"
                >
                  Reserve Date — $99
                </Link>
              </div>
            </div>
          </div>
        )
      })()}
    </>
  )
}
