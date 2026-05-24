'use client'

import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { X, Check, Star, Users, Clock } from 'lucide-react'
import ImageSlider from '@/components/ImageSlider'

const MINI_PARTY_DISCOUNT = 200

export interface ThemeData {
  name: string
  slug: string
  price_cents: number
  tag: string | null
  description: string
  extended_description: string
  images: string[]
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

/* Hardcoded fallback — used only if no DB themes are passed */
const fallbackThemes: ThemeData[] = [
  {
    name: 'Glow Party', slug: 'glow-party', price_cents: 95000, tag: 'Most Popular',
    description: 'Black lights, UV face paint, neon accessories, glow bracelets, custom trucker hat, and a dance party.',
    extended_description: 'Transform our studio into a neon wonderland! Every guest gets a custom trucker hat, glow bracelets, neon necklaces, and UV face paint from our professional station. The entire studio is lit with black lights and neon LED strips. We crank up the DJ playlist, and kids dance the night away in a truly electric atmosphere. The perfect party for ages 6–14.',
    images: ['/images/theme-glow.webp', '/images/gallery/glow-accessories.webp'],
  },
  {
    name: 'Swiftie Party', slug: 'swiftie-party', price_cents: 85000, tag: null,
    description: 'Eras Tour-inspired decor, friendship bracelets, decorate your own glasses, and all the Taylor Swift anthems.',
    extended_description: 'Welcome to the Eras Tour — right in our studio! Guests make their own friendship bracelets, decorate their own glasses, sing along to curated Taylor Swift playlists, and pose in front of our Swiftie photo backdrop. The space is decked out in all of Taylor\'s signature colors and aesthetic. Perfect for the Swifties ages 6–14.',
    images: ['/images/theme-swiftie.webp'],
  },
  {
    name: 'Spa Party', slug: 'spa-party', price_cents: 85000, tag: null,
    description: 'Mini manicures, mini facials, face masks, robes, cucumbers, and full spa-day vibes.',
    extended_description: 'Roll out the red carpet — our studio becomes a luxury spa! Every guest gets a robe, cucumber eye pads, mini facials, a DIY face mask, and a mini manicure. We pipe in relaxing music and set up the full spa aesthetic. Totally kid-safe products, totally unforgettable. Ideal for ages 6–12.',
    images: ['/images/theme-spa.webp', '/images/gallery/spa-party-1.webp', '/images/gallery/spa-party-2.webp'],
  },
  {
    name: 'Slime Party', slug: 'slime-party', price_cents: 90000, tag: null,
    description: 'Choose your slime theme! Custom slime-making station with personalized containers and messy fun.',
    extended_description: 'Get ready for the ultimate slime lab! Choose a slime theme and each guest creates their own custom slime — picking colors, glitter, and add-ins at our slime-making station. They take home their creation in personalized containers. The studio is transformed with slime-themed decor and activities. Perfect for ages 5–12.',
    images: ['/images/theme-slime.webp', '/images/slime-party-1.jpg', '/images/slime-party-2.jpg', '/images/slime-party-3.jpg', '/images/slime-party-4.jpg'],
  },
  {
    name: 'K-Pop Party', slug: 'kpop-party', price_cents: 90000, tag: null,
    description: 'Hair glitter, decorate your own microphone or trucker hat, glitter tattoos, and all the K-pop vibes.',
    extended_description: 'Your favorite K-pop stars come to life! Guests get hair glitter, decorate their own microphone or trucker hat, enjoy glitter tattoos, and strike poses at our photo wall. The studio is lit with stage lighting and filled with K-pop energy. We can make it neon glow if preferred. Awesome for fans ages 7–14.',
    images: ['/images/theme-kpop.webp', '/images/gallery/kpop-setup.webp'],
  },
  {
    name: 'Barbie Party', slug: 'barbie-party', price_cents: 85000, tag: null,
    description: 'Pink everything, Barbie manicure, fashion design station, and Barbie World brought to life.',
    extended_description: 'Welcome to Barbie World! The studio is fully pink and glamorous. Guests enjoy a Barbie manicure, design their own Barbie outfits at our fashion station, walk the runway, and strike their best Barbie poses at the photo wall. We\'ve got all the iconic accessories and Barbie-worthy activities. For ages 4–12.',
    images: ['/images/theme-barbie.webp', '/images/gallery/barbie-photo-booth.webp', '/images/gallery/barbie-setup.webp', '/images/gallery/card-barbie-collage.webp'],
  },
  {
    name: 'Sweets & Treats', slug: 'sweets-treats', price_cents: 80000, tag: 'Best Value',
    description: 'Cookie, cupcake, and donut decorating — plus decorate your own apron to take home!',
    extended_description: 'A party as sweet as the birthday star! Guests decorate their own cookies, cupcakes, or donuts and get to decorate their own aprons to take home. The studio is transformed into a pastel dreamland with sweet-themed decor. Perfect for ages 3–10 who love all things sweet.',
    images: ['/images/theme-sweets.webp', '/images/gallery/donut-decorating.webp'],
  },
  {
    name: 'Sleep Under Party', slug: 'sleep-under-party', price_cents: 90000, tag: 'New',
    description: 'Cozy styled tents, bedazzle a hairbrush, hairstyling, mini pink facials, and sleepover vibes.',
    extended_description: 'The ultimate sleepover experience — without the actual sleepover! Each guest gets their own cozy styled tent with air mattress setup. Activities include bedazzling their own hairbrush to take home, fun hairstyling sessions, and relaxing mini pink facials. All the sleepover magic, and you still pick them up at the end!',
    images: ['/images/theme-sleepunder.webp', '/images/gallery/spa-party-1.webp'],
  },
  {
    name: 'Toddler Party', slug: 'toddler-party', price_cents: 85000, tag: 'Ages 2–4',
    description: 'Safe, sensory-friendly activities perfectly designed for little ones.',
    extended_description: 'The sweetest little celebration! Designed specifically for toddlers ages 2–4, this party features age-appropriate sensory activities, soft play elements, and a magical setup that\'s perfect for the birthday star and their little friends. Safe, fun, and oh-so-adorable.',
    images: ['/images/theme-toddler.webp', '/images/gallery/toddler-sensory.webp'],
  },
]

export default function ThemeTileGrid({ themes: dbThemes }: { themes?: ThemeData[] }) {
  const themes = dbThemes && dbThemes.length > 0 ? dbThemes : fallbackThemes
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
          const regularPrice = t.price_cents / 100
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
              <div className="relative aspect-[4/5] overflow-hidden">
                <Image
                  src={t.images[0]}
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
        const regularPrice = selected.price_cents / 100
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
                  images={selected.images}
                  alt={selected.name}
                  aspectRatio="aspect-[3/4]"
                  autoPlayMs={3500}
                />
                <div className="p-6">
                  <p className="text-hampton-navy/60 text-xs font-semibold tracking-widest uppercase mb-3">About This Party</p>
                  <p className="text-hampton-navy leading-relaxed text-sm mb-5">{selected.extended_description}</p>

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
                Lock your date with a <strong>25% deposit</strong> — change theme or details any time.
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
                  Reserve Date
                </Link>
              </div>
            </div>
          </div>
        )
      })()}
    </>
  )
}
