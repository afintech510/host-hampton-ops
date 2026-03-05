'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Check, ChevronDown, X, Loader2, Star, Calendar, Clock, Users, Sparkles, UtensilsCrossed, Palette, Gift, Music, Bookmark, Zap } from 'lucide-react'
import UniversalCalendar from '@/components/UniversalCalendar'
import ImageSlider from '@/components/ImageSlider'
import type { CalendarSelection } from '@/components/UniversalCalendar/types'
import type { PricingItem } from './page'
import { trackLead, trackCheckoutStart } from '@/lib/gtag'
import { captureUtm, getUtmParams } from '@/lib/utm'

const MINI_PARTY_DISCOUNT = 200
const MINI_PARTY_MAX_GUESTS = 7

/** Match a display theme name to a pricing_items row by normalised first word. */
function lookupThemePrice(displayName: string, items: PricingItem[]): number | null {
  if (!items.length) return null
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
  const key = norm(displayName).split(' ')[0]
  const match = items.find(i => i.category === 'party-theme' && norm(i.name).startsWith(key))
  return match ? match.price_cents / 100 : null
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
    imgs: ['/images/theme-glow.webp'],
    desc: 'Black lights, UV face paint, neon accessories, glow bracelets, custom trucker hat, and a dance party.',
    extendedDesc: 'Transform our studio into a neon wonderland! Every guest gets a custom trucker hat, glow bracelets, neon necklaces, and UV face paint from our professional station. The entire studio is lit with black lights and neon LED strips. We crank up the DJ playlist, and kids dance the night away in a truly electric atmosphere. The perfect party for ages 6\u201314.',
    popular: true,
  },
  {
    name: 'Slime Party',
    price: 900,
    imgs: ['/images/theme-slime.webp', '/images/slime-party-1.jpg', '/images/slime-party-2.jpg', '/images/slime-party-3.jpg', '/images/slime-party-4.jpg'],
    desc: 'Choose your slime theme! Custom slime-making station with personalized containers and messy fun.',
    extendedDesc: 'Each guest creates their own custom slime with a variety of colors, glitters, scents, and mix-ins \u2014 choose a slime theme and make it your own! Everyone takes home their creation in a personalized container. We handle ALL the mess \u2014 you just enjoy the fun.',
  },
  {
    name: 'K-Pop Demon Hunter',
    price: 900,
    imgs: ['/images/theme-kpop.webp'],
    desc: 'Hair glitter, decorate your own microphone or trucker hat, glitter tattoos, and K-pop vibes.',
    extendedDesc: 'For the K-pop obsessed! Features hair glitter, decorate your own microphone or trucker hat, glitter tattoos, karaoke station with all the hits, neon-themed decor, and a photo booth with K-pop-inspired props. We can make it neon glow if preferred. Perfect for tweens and teens who live for the aesthetic.',
  },
  {
    name: 'Trucker Hat Party',
    price: 900,
    imgs: ['/images/gallery/card-trucker-hat-bar.webp'],
    desc: 'Iron-on patches, photo booth, and totally custom trucker hats as favors.',
    extendedDesc: 'The trendiest party on Long Island! Each guest designs their own custom trucker hat with iron-on patches, rhinestones, and embellishments. Includes a photo booth with fun props, and every guest walks away with their one-of-a-kind creation. A huge hit with ages 8+.',
  },
  {
    name: 'Spa Party',
    price: 850,
    imgs: ['/images/theme-spa.webp'],
    desc: 'Mini manicures, mini facials, hair styling, face masks, robes, and full glam experience.',
    extendedDesc: 'The ultimate pampering experience. Guests arrive to robes and slippers, enjoy mini manicures with kid-safe polish, mini facials, hair styling or braiding, cucumber face masks, and a relaxation station. Every detail is designed to make them feel like royalty.',
  },
  {
    name: 'Swiftie Party',
    price: 850,
    imgs: ['/images/theme-swiftie.webp'],
    desc: 'Karaoke, friendship bracelets, decorate your own glasses, hair tinsel, glitter, and all the feels.',
    extendedDesc: 'For every era! Features Taylor Swift karaoke, a friendship bracelet-making station, decorate your own glasses, hair tinsel and glitter stations, era-themed decorations, and trivia games. We play all the hits and create the ultimate Swiftie experience. Eras tour vibes, right in Speonk.',
  },
  {
    name: 'Barbie Party',
    price: 850,
    imgs: ['/images/theme-barbie.webp'],
    desc: 'Life-size Barbie box photo op, Barbie manicure, fashion show, and glam styling.',
    extendedDesc: 'Step into Barbie\'s world! Includes a life-size Barbie box photo op, a Barbie manicure, a fashion show runway, glam hair and makeup station, pink-themed decorations from floor to ceiling, and Barbie-inspired activities. Every guest gets the full Barbie treatment.',
  },
  {
    name: 'Unicorn Party',
    price: 850,
    imgs: ['/images/theme-glow.webp'],
    desc: 'Headbands, hair tinsel, manicure, glitter crafts, and rainbow decor.',
    extendedDesc: 'Pure magic! Rainbow and pastel decorations transform the studio into a unicorn dreamland. Activities include unicorn headband decorating, hair tinsel, manicures, glitter crafts, and enchanted photo opportunities. Perfect for ages 3\u20138.',
  },
  {
    name: 'Sleep Under Party',
    price: 900,
    imgs: ['/images/theme-sleepunder.webp'],
    desc: 'Cozy styled tents, bedazzle a hairbrush, hairstyling, mini pink facials, and sleepover vibes.',
    extendedDesc: 'The ultimate sleepover experience \u2014 without the actual sleepover! Each guest gets their own cozy styled tent with air mattress setup. Activities include bedazzling their own hairbrush to take home, fun hairstyling sessions, and relaxing mini pink facials. All the sleepover magic, and you still pick them up at the end!',
  },
  {
    name: 'Toddler Party',
    price: 850,
    imgs: ['/images/theme-toddler.webp'],
    desc: 'Soft play, ball pit, sensory activities, and themed decor for ages 2\u20134.',
    extendedDesc: 'Designed specifically for little ones! Features a soft play area, ball pit, age-appropriate sensory stations, bubble machine, and gentle music. The space is fully baby-proofed and safe. Parents can relax while the little ones explore and play. Ideal for ages 1\u20134.',
  },
  {
    name: 'Sweets & Treats',
    price: 800,
    imgs: ['/images/theme-sweets.webp'],
    desc: 'Cookie, cupcake, and donut decorating \u2014 decorate your own apron to take home!',
    extendedDesc: 'A sugar lover\'s dream! Guests decorate cookies, cupcakes, or donuts with professional-grade supplies. Each guest gets to decorate their own apron to take home. Includes all decorating supplies and take-home boxes for creations. The studio is transformed into a pastel sweet paradise.',
  },
]

const eventTypes = [
  'Kids Birthday Party',
  'Studio Rental',
  'Mobile Services',
  'Permanent Jewelry',
  'Retail & Custom Merchandise',
]

const timeOptions = ['Morning', 'Afternoon', 'Evening']

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

function formatDate(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const date = new Date(y, mo - 1, d)
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export default function PartyPackagesContent({ pricingItems = [] }: { pricingItems?: PricingItem[] }) {
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    eventType: 'Kids Birthday Party',
    fullName: '',
    email: '',
    phone: '',
    childName: '',
    childAge: '',
    guestCount: '',
    partyTheme: '',
    preferredDate: '',
    timeOfDay: [] as string[],
    notes: '',
  })
  const [eventDropdownOpen, setEventDropdownOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [calendarSelection, setCalendarSelection] = useState<CalendarSelection | null>(null)
  const [reserving, setReserving] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [isMiniParty, setIsMiniParty] = useState(false)
  const themeSectionRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const calendarRef = useRef<HTMLDivElement>(null)
  const summaryRef = useRef<HTMLDivElement>(null)

  const selectedThemeData = themes.find(t => t.name === (formData.partyTheme || selectedTheme))
  const selectedThemePrice = selectedThemeData
    ? (lookupThemePrice(selectedThemeData.name, pricingItems) ?? selectedThemeData.price)
    : null

  function handleThemeSelect(name: string) {
    if (selectedTheme === name) {
      setSelectedTheme(null)
      setFormData(prev => ({ ...prev, partyTheme: '' }))
      setIsMiniParty(false)
    } else {
      setSelectedTheme(name)
      setFormData(prev => ({ ...prev, partyTheme: name }))
    }
  }

  useEffect(() => { captureUtm() }, [])

  // Scroll the card image to the top of the viewport when a theme is selected
  useEffect(() => {
    if (!selectedTheme) return
    const t = setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => clearTimeout(t)
  }, [selectedTheme])

  function update(field: string, value: string) {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  function toggleTimeOfDay(value: string) {
    setFormData(prev => {
      const current = prev.timeOfDay
      const next = current.includes(value)
        ? current.filter(t => t !== value)
        : [...current, value]
      return { ...prev, timeOfDay: next }
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          timeOfDay: formData.timeOfDay.join(', '),
          sourcePage: 'party-packages',
          utm: getUtmParams(),
        }),
      })

      let data: Record<string, string> = {}
      const text = await res.text()
      try { data = JSON.parse(text) } catch { /* non-JSON response */ }

      if (!res.ok) throw new Error(data.error || 'Something went wrong \u2014 please try again')

      setSubmitting(false)
      setSubmitted(true)
      trackLead('party-packages', formData.email)
      setTimeout(() => {
        calendarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 300)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  const handleCalendarSelect = useCallback((selection: CalendarSelection) => {
    setCalendarSelection(selection)
    if (selection.timeSlot) {
      setTimeout(() => {
        summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 200)
    }
  }, [])

  async function handleReserveNow() {
    if (!calendarSelection?.date || !calendarSelection?.timeSlot) return
    setReserving(true)

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageName: formData.partyTheme || selectedTheme || 'Kids Birthday Party',
          partyDate: calendarSelection.date,
          partyTime: calendarSelection.timeSlot.start,
          eventType: formData.eventType || 'Kids Birthday Party',
          contactName: formData.fullName,
          contactEmail: formData.email,
          contactPhone: formData.phone,
          childName: formData.childName,
          childAge: formData.childAge,
          guestCount: isMiniParty ? String(Math.min(parseInt(formData.guestCount) || 10, MINI_PARTY_MAX_GUESTS)) : formData.guestCount,
          notes: isMiniParty ? `Mini Party (−$200, max 7 guests, 1.5hr)${formData.notes ? '. ' + formData.notes : ''}` : formData.notes,
          bookingTypeSlug: 'kids-party',
          partyTags: {
            theme: formData.partyTheme || selectedTheme,
            price: selectedThemePrice != null ? selectedThemePrice - (isMiniParty ? MINI_PARTY_DISCOUNT : 0) : undefined,
            miniParty: isMiniParty || undefined,
          },
          utm: getUtmParams(),
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Checkout failed')

      // Fire checkout tracking before redirect
      trackCheckoutStart(formData.partyTheme || selectedTheme || 'Kids Birthday Party', selectedThemePrice || 99)

      // Redirect to Stripe
      window.location.href = data.url
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
      setReserving(false)
    }
  }

  async function handleSaveForLater() {
    if (!formData.email) return
    setSaving(true)
    setSaveSuccess(false)

    // Find matching pricing item ID for the theme
    const themeName = formData.partyTheme || selectedTheme || null
    const themeItem = themeName
      ? pricingItems.find(i => i.category === 'party-theme' && i.name === themeName)
      : null

    const gc = isMiniParty ? Math.min(parseInt(formData.guestCount) || 10, MINI_PARTY_MAX_GUESTS) : parseInt(formData.guestCount) || 10
    const summaryLines = [
      themeName ? `Theme: ${themeName}${selectedThemePrice != null ? ` ($${(selectedThemePrice - (isMiniParty ? MINI_PARTY_DISCOUNT : 0)).toLocaleString()})` : ''}` : null,
      `Guests: ${gc}${isMiniParty ? ' (Mini Party)' : ''}`,
      formData.childName ? `Child: ${formData.childName}${formData.childAge ? `, age ${formData.childAge}` : ''}` : null,
      isMiniParty ? 'Mini Party: −$200 discount applied, max 7 guests, 1.5hr duration' : null,
      formData.notes ? `Notes: ${formData.notes}` : null,
    ].filter(Boolean).join('\n')

    const quoteData = {
      theme: themeItem?.id || null,
      themeName,
      guestCount: gc,
      foodChoice: null,
      cupcakeFlavor: null,
      activities: [],
      food: [],
      desserts: [],
      decor: [],
      entertainment: [],
      beverages: [],
      extras: [],
      contactName: formData.fullName,
      contactEmail: formData.email,
      contactPhone: formData.phone,
    }

    try {
      await fetch('/api/quote/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.fullName,
          email: formData.email,
          phone: formData.phone,
          quoteData,
          summary: summaryLines,
          partyDate: calendarSelection?.date || formData.preferredDate || null,
          partyTime: calendarSelection?.timeSlot?.start || null,
          sourcePage: 'party-packages',
        }),
      })
      setSaveSuccess(true)
    } catch { /* silent */ }
    setSaving(false)
  }

  const partyTitle = formData.childName
    ? `${formData.childName}'s ${formData.childAge ? ordinal(parseInt(formData.childAge)) + ' ' : ''}Birthday`
    : formData.childAge
      ? `${ordinal(parseInt(formData.childAge))} Birthday Party`
      : 'Birthday Party'

  const guestCount = parseInt(formData.guestCount) || 10
  const effectiveGuestCount = isMiniParty ? Math.min(guestCount, MINI_PARTY_MAX_GUESTS) : guestCount

  return (
    <div>
      {/* ── Hero ── */}
      <section className="py-20 text-center px-4">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/40 mb-6 text-hampton-pink text-sm font-bold tracking-widest uppercase border border-white/60 shadow-sm">
          Everything Included
        </div>
        <h1 className="font-serif text-4xl md:text-6xl text-hampton-navy mb-4">
          Party Packages & Pricing
        </h1>
        <p className="text-hampton-navy/80 text-lg max-w-xl mx-auto font-medium">
          An upscale Hamptons party — at prices you&apos;d pay anywhere else.
        </p>
        <p className="text-hampton-navy/50 text-sm max-w-lg mx-auto mt-3">
          Our hosts guide every child through every activity. Fully customizable — scale up or keep it simple, whatever fits your budget.
        </p>
      </section>

      {/* ── What's Included ── */}
      <section className="py-16 max-w-4xl mx-auto px-4 sm:px-6 -mt-6">
        <div className="text-center mb-10">
          <h2 className="section-heading">Every Party Includes</h2>
          <p className="text-hampton-navy/70">No hidden costs. No upcharges. Everything below is included.</p>
        </div>
        <div className="bg-white rounded-3xl p-8 md:p-12 border border-hampton-pink/20 shadow-sm">
          <div className="grid md:grid-cols-2 gap-y-4 gap-x-10">
            {included.map(item => (
              <div key={item} className="flex items-center gap-3 p-3 rounded-lg border border-hampton-pink/10 hover:border-hampton-mauve/50 transition-colors">
                <div className="w-6 h-6 rounded-full bg-hampton-mauve flex items-center justify-center text-white shrink-0">
                  <Check size={14} strokeWidth={3} />
                </div>
                <span className="text-hampton-navy text-sm font-medium">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Design Your Party CTA (top) ── */}
      <section className="pb-12 px-4">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center gap-5 bg-white rounded-2xl px-8 py-6 border border-hampton-pink/20 shadow-sm">
          <div className="flex-1 text-center sm:text-left">
            <h3 className="font-serif text-xl text-hampton-navy font-bold mb-1">Want to customize everything?</h3>
            <p className="text-hampton-navy/60 text-sm">Browse our full menu, pick add-ons, and see your price in real time.</p>
          </div>
          <Link
            href="/kids-party-menu"
            className="shrink-0 bg-hampton-navy text-hampton-ivory font-bold px-8 py-3 rounded-full text-sm hover:bg-hampton-navy/90 transition-all shadow-sm hover:shadow-md"
          >
            Design Your Party
          </Link>
        </div>
      </section>

      {/* ── Theme Packages ── */}
      <section ref={themeSectionRef} className="py-8 max-w-7xl mx-auto px-4 sm:px-6 scroll-mt-24">
        <h2 className="section-heading text-center mb-2">Select Your Theme</h2>
        <p className="text-center text-hampton-navy/70 mb-8">
          {selectedTheme ? 'Click the theme again to deselect, or choose a different one below.' : 'Tap a theme to see details and start your booking.'}
        </p>

        {selectedTheme && selectedThemeData ? (
          <div ref={cardRef} className="animate-[fadeIn_0.3s_ease-out] scroll-mt-20">
            {/* Hero Card */}
            <div className="max-w-3xl mx-auto">
              <div className="rounded-2xl overflow-hidden ring-2 ring-hampton-pink shadow-md bg-white">
                <div className="relative">
                  <ImageSlider
                    images={selectedThemeData.imgs}
                    alt={selectedThemeData.name}
                    aspectRatio="aspect-[3/2]"
                  />
                  <button
                    onClick={() => handleThemeSelect(selectedTheme)}
                    className="absolute top-3 right-3 w-9 h-9 bg-white/90 rounded-full flex items-center justify-center hover:bg-white transition-colors shadow-md z-20"
                  >
                    <X size={18} className="text-hampton-navy" />
                  </button>
                </div>
                <div className="p-6">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-hampton-navy text-xl">{selectedThemeData.name}</h3>
                    <span className="text-hampton-navy font-bold text-xl">from ${(selectedThemePrice ?? selectedThemeData.price).toLocaleString()}</span>
                  </div>
                  <p className="text-sm leading-relaxed text-hampton-navy/80">
                    {selectedThemeData.extendedDesc}
                  </p>
                  <div className="flex items-center gap-2 text-hampton-pink text-sm font-semibold pt-4 animate-[fadeIn_0.5s_ease-in]">
                    <div className="w-5 h-5 rounded-full bg-hampton-pink flex items-center justify-center">
                      <Check size={12} strokeWidth={3} className="text-white" />
                    </div>
                    <span>Theme selected — fill out the form below to check availability</span>
                  </div>

                  {/* Mini Party Toggle */}
                  <div className="border-t border-hampton-pink/15 pt-4 mt-3">
                    <button
                      type="button"
                      onClick={() => setIsMiniParty(!isMiniParty)}
                      className={`w-full flex items-center justify-between gap-3 px-5 py-4 rounded-2xl border-2 transition-all ${
                        isMiniParty
                          ? 'border-hampton-navy bg-hampton-navy text-white'
                          : 'border-hampton-pink/30 bg-hampton-pink/5 text-hampton-navy hover:border-hampton-pink/60'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Zap size={18} className={isMiniParty ? 'text-yellow-300' : 'text-hampton-pink'} />
                        <div className="text-left">
                          <p className="font-bold text-sm">Mini Party — $200 Off</p>
                          <p className={`text-xs ${isMiniParty ? 'text-white/70' : 'text-hampton-navy/60'}`}>
                            Max 7 guests + birthday child · 1.5 hr duration
                          </p>
                        </div>
                      </div>
                      <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                        isMiniParty ? 'bg-yellow-300 text-hampton-navy' : 'bg-hampton-pink/20 text-hampton-navy'
                      }`}>
                        {isMiniParty ? 'Active ✓' : '− $200'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Thumbnail Strip */}
            <div className="max-w-3xl mx-auto mt-6">
              <p className="text-sm text-hampton-navy/60 mb-3 font-medium">Or choose a different theme:</p>
              <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide">
                {themes.filter(t => t.name !== selectedTheme).map(t => (
                  <button
                    key={t.name}
                    onClick={() => handleThemeSelect(t.name)}
                    className="shrink-0 w-[100px] snap-start group text-left"
                  >
                    <div className="relative aspect-square rounded-xl overflow-hidden border-2 border-transparent group-hover:border-hampton-pink transition-colors">
                      <Image src={t.imgs[0]} alt={t.name} fill className="object-cover" />
                    </div>
                    <p className="text-xs text-hampton-navy mt-1.5 font-medium text-center truncate">{t.name}</p>
                    <p className="text-[10px] text-hampton-navy/50 text-center">${(lookupThemePrice(t.name, pricingItems) ?? t.price).toLocaleString()}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {themes.map(t => (
              <div
                key={t.name}
                onClick={() => handleThemeSelect(t.name)}
                className={`rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 ${
                  t.popular
                    ? 'ring-2 ring-hampton-pink bg-white hover:shadow-lg hover:-translate-y-1'
                    : 'bg-white border border-hampton-pink/20 shadow-sm hover:shadow-lg hover:-translate-y-1'
                }`}
              >
                {t.popular && (
                  <div className="bg-gradient-to-r from-hampton-pink to-hampton-pink/80 text-white text-xs font-bold text-center py-1.5 tracking-wide uppercase">
                    Most Popular
                  </div>
                )}
                <div className="relative aspect-video overflow-hidden">
                  <Image src={t.imgs[0]} alt={t.name} fill className="object-cover transition-transform duration-500 hover:scale-105" />
                </div>
                <div className="p-5">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-hampton-navy text-lg">{t.name}</h3>
                    <span className="text-hampton-navy font-bold text-lg">from ${(lookupThemePrice(t.name, pricingItems) ?? t.price).toLocaleString()}</span>
                  </div>
                  <p className="text-sm leading-relaxed text-hampton-navy/70">{t.desc}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Lead Capture Form ── */}
      <section className="py-8 max-w-2xl mx-auto px-4 sm:px-6 scroll-mt-24">
        <h2 className="section-heading text-center mb-2">Tell Us About Your Party</h2>
        <p className="text-center text-hampton-navy/70 mb-8">
          Fill out the details below and we&apos;ll check availability for you.
        </p>

        <form onSubmit={handleSubmit} className="bg-white rounded-3xl border border-hampton-pink/20 shadow-sm p-8 space-y-5">
          {/* Event Type */}
          <div>
            <label className="form-label text-hampton-navy text-sm font-semibold mb-2 block">Select Event</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setEventDropdownOpen(!eventDropdownOpen)}
                className="w-full flex items-center justify-between gap-2 px-5 py-3 rounded-full border-2 border-hampton-pink/30 bg-white/80 text-hampton-navy font-semibold text-sm hover:border-hampton-pink transition-colors"
              >
                <span>{formData.eventType}</span>
                <ChevronDown size={16} className={`transition-transform ${eventDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {eventDropdownOpen && (
                <div className="absolute z-20 top-full mt-2 w-full bg-white rounded-2xl border border-hampton-pink/20 shadow-lg overflow-hidden">
                  {eventTypes.map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => { update('eventType', type); setEventDropdownOpen(false) }}
                      className={`w-full text-left px-5 py-3 text-sm hover:bg-hampton-pink/10 transition-colors ${
                        formData.eventType === type ? 'bg-hampton-pink/20 font-semibold text-hampton-navy' : 'text-hampton-navy'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Name & Email */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Full Name *</label>
              <input type="text" required placeholder="Jane Smith" value={formData.fullName}
                onChange={e => update('fullName', e.target.value)} className="form-input" />
            </div>
            <div>
              <label className="form-label">Email *</label>
              <input type="email" required placeholder="jane@email.com" value={formData.email}
                onChange={e => update('email', e.target.value)} className="form-input" />
            </div>
          </div>

          {/* Phone */}
          <div>
            <label className="form-label">Phone *</label>
            <input type="tel" required placeholder="(631) 555-1234" value={formData.phone}
              onChange={e => update('phone', e.target.value)} className="form-input" />
          </div>

          {/* Child Name & Age */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Child&apos;s Name</label>
              <input type="text" placeholder="Emma" value={formData.childName}
                onChange={e => update('childName', e.target.value)} className="form-input" />
            </div>
            <div>
              <label className="form-label">Child&apos;s Age</label>
              <input type="number" min="1" max="18" placeholder="7" value={formData.childAge}
                onChange={e => update('childAge', e.target.value)} className="form-input" />
            </div>
          </div>

          {/* Guest Count & Theme */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Guest Count</label>
              <input type="number" min="1" max={isMiniParty ? MINI_PARTY_MAX_GUESTS : 50} placeholder="10" value={formData.guestCount}
                onChange={e => update('guestCount', e.target.value)} className="form-input" />
            </div>
            <div>
              <label className="form-label">Party Theme</label>
              <input type="text" placeholder="e.g. Glow Party, Slime Party..." value={formData.partyTheme}
                onChange={e => update('partyTheme', e.target.value)} className="form-input" />
            </div>
          </div>

          {/* Preferred Date & Time of Day */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Preferred Date</label>
              <input type="date" value={formData.preferredDate}
                onChange={e => update('preferredDate', e.target.value)} className="form-input" />
            </div>
            <div>
              <label className="form-label">Time of Day</label>
              <div className="flex gap-2">
                {timeOptions.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTimeOfDay(t)}
                    className={`flex-1 py-2.5 rounded-full text-sm font-semibold border-2 transition-all ${
                      formData.timeOfDay.includes(t)
                        ? 'border-hampton-pink bg-hampton-pink/20 text-hampton-navy'
                        : 'border-hampton-mauve/30 text-hampton-navy hover:border-hampton-pink/40'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="form-label">Special Requests or Notes</label>
            <textarea rows={3} placeholder="Dietary needs, theme preferences, special requests..."
              value={formData.notes} onChange={e => update('notes', e.target.value)}
              className="form-input resize-none" />
          </div>

          {error && !calendarSelection && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || submitted}
            className="w-full bg-hampton-navy text-hampton-ivory font-semibold py-4 px-8 rounded-full hover:bg-opacity-90 hover:shadow-[0_8px_25px_rgba(47,52,59,0.3)] transition-all disabled:opacity-60 flex items-center justify-center gap-2 text-base"
          >
            {submitting ? (
              <><Loader2 size={18} className="animate-spin" /> Submitting...</>
            ) : submitted ? (
              <>Thank You, Select Time Below ↴</>
            ) : (
              'Check Availability'
            )}
          </button>
        </form>
      </section>

      {/* ── Calendar — smooth fade-in after form submit ── */}
      <div
        ref={calendarRef}
        className={`scroll-mt-24 transition-all duration-700 ease-out ${
          submitted
            ? 'opacity-100 translate-y-0 max-h-[2000px]'
            : 'opacity-0 translate-y-8 max-h-0 overflow-hidden'
        }`}
      >
        <section className="py-8 max-w-2xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-6">
            <h2 className="section-heading mb-2">Pick Your Date & Time</h2>
            <p className="text-hampton-navy/70 text-sm">
              Select an available date and time slot below.
            </p>
          </div>
          {submitted && (
            <UniversalCalendar
              mode="booking"
              lockedBookingType="kids-party"
              expandable={false}
              initialExpanded={true}
              showSummary={false}
              defaultDate={formData.preferredDate || undefined}
              onSelect={handleCalendarSelect}
            />
          )}
        </section>
      </div>

      {/* ── Party Summary — appears after time slot selection ── */}
      <div
        ref={summaryRef}
        className={`scroll-mt-24 transition-all duration-500 ease-out ${
          calendarSelection?.timeSlot
            ? 'opacity-100 translate-y-0 max-h-[2000px]'
            : 'opacity-0 translate-y-4 max-h-0 overflow-hidden pointer-events-none'
        }`}
      >
        {calendarSelection?.timeSlot && (
          <section className="pb-20 max-w-2xl mx-auto px-4 sm:px-6">
            <div className="bg-white rounded-3xl border-2 border-hampton-pink/30 shadow-lg overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-r from-hampton-pink to-hampton-mauve px-6 py-5">
                <div className="flex items-center gap-3">
                  <Sparkles size={20} className="text-white" />
                  <h3 className="font-serif text-xl text-white">{partyTitle}</h3>
                </div>
              </div>

              <div className="p-6 space-y-5">
                {/* Details grid */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-hampton-pink/15 rounded-full flex items-center justify-center shrink-0">
                      <Star size={14} className="text-hampton-pink" />
                    </div>
                    <div>
                      <p className="text-xs text-hampton-navy/50 font-medium uppercase tracking-wide">Theme</p>
                      <p className="text-sm font-semibold text-hampton-navy">{formData.partyTheme || selectedTheme || 'TBD'}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-hampton-pink/15 rounded-full flex items-center justify-center shrink-0">
                      <Calendar size={14} className="text-hampton-pink" />
                    </div>
                    <div>
                      <p className="text-xs text-hampton-navy/50 font-medium uppercase tracking-wide">Date</p>
                      <p className="text-sm font-semibold text-hampton-navy">{formatDate(calendarSelection.date)}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-hampton-pink/15 rounded-full flex items-center justify-center shrink-0">
                      <Clock size={14} className="text-hampton-pink" />
                    </div>
                    <div>
                      <p className="text-xs text-hampton-navy/50 font-medium uppercase tracking-wide">Time</p>
                      <p className="text-sm font-semibold text-hampton-navy">
                        {formatTime(calendarSelection.timeSlot.start)} – {formatTime(calendarSelection.timeSlot.end)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-hampton-pink/15 rounded-full flex items-center justify-center shrink-0">
                      <Users size={14} className="text-hampton-pink" />
                    </div>
                    <div>
                      <p className="text-xs text-hampton-navy/50 font-medium uppercase tracking-wide">Guests</p>
                      <p className="text-sm font-semibold text-hampton-navy">{effectiveGuestCount} guests + Birthday Star</p>
                    </div>
                  </div>
                </div>

                {/* Pricing breakdown */}
                <div className="border-t border-hampton-pink/15 pt-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-hampton-navy">Estimated Party Cost</span>
                    <div className="text-right">
                      {isMiniParty && selectedThemePrice != null && (
                        <p className="text-xs line-through text-hampton-navy/40">${selectedThemePrice.toLocaleString()}</p>
                      )}
                      <span className="text-xl font-bold text-hampton-navy">
                        {selectedThemePrice != null
                          ? `from $${(selectedThemePrice - (isMiniParty ? MINI_PARTY_DISCOUNT : 0)).toLocaleString()}`
                          : 'TBD'}
                      </span>
                    </div>
                  </div>
                  {isMiniParty && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <Zap size={12} className="text-hampton-pink" />
                      <p className="text-xs text-hampton-pink font-semibold">Mini Party: −$200 applied</p>
                    </div>
                  )}
                  <p className="text-xs text-hampton-navy/60">
                    {isMiniParty
                      ? `Up to ${MINI_PARTY_MAX_GUESTS} guests + Birthday Star · 1.5 hr duration`
                      : '10 guests + Birthday Star is included. Additional guests are $35 each.'}
                  </p>
                </div>

                {/* Deposit info */}
                <div className="bg-hampton-pink/10 rounded-xl px-5 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-hampton-navy">Deposit to Reserve</span>
                    <span className="text-lg font-bold text-hampton-navy">$99</span>
                  </div>
                  <p className="text-xs text-hampton-navy/60 leading-relaxed">
                    Your $99 deposit is fully applied toward your party balance. All party details — theme, date, guest count — can be modified up to 1 week before your event.
                  </p>
                </div>

                {/* What's Next */}
                <div className="border-t border-hampton-pink/15 pt-5">
                  <h4 className="font-serif text-lg text-hampton-navy mb-2">What&apos;s Next?</h4>
                  <p className="text-sm text-hampton-navy/70 leading-relaxed">
                    Once you reserve your date, Allie will reach out within 24 hours to confirm all the details. Together we&apos;ll finalize your food, cupcake, and activity selections. We also offer a full menu of <a href="/party-add-ons" className="text-hampton-pink font-semibold hover:underline">party add-ons</a>, extra decor, and catering upgrades — so you can make your celebration as elaborate or as effortless as you&apos;d like.
                  </p>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}

                {saveSuccess && (
                  <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700 flex items-center gap-2">
                    <Check size={16} /> Saved! Check your email for a link to pick up where you left off.
                  </div>
                )}

                {/* Action buttons */}
                <div className="grid sm:grid-cols-2 gap-3">
                  <button
                    onClick={handleSaveForLater}
                    disabled={saving || !formData.email}
                    className="w-full border-2 border-hampton-navy text-hampton-navy font-bold py-4 px-6 rounded-full text-base hover:bg-hampton-navy/5 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {saving ? (
                      <><Loader2 size={18} className="animate-spin" /> Saving...</>
                    ) : (
                      <><Bookmark size={18} /> Save for Later</>
                    )}
                  </button>
                  <button
                    onClick={handleReserveNow}
                    disabled={reserving}
                    className="w-full bg-hampton-navy text-white font-bold py-4 px-6 rounded-full text-base hover:bg-opacity-90 hover:shadow-[0_8px_25px_rgba(47,52,59,0.3)] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {reserving ? (
                      <><Loader2 size={18} className="animate-spin" /> Redirecting...</>
                    ) : (
                      'Secure Reservation — $99 Deposit'
                    )}
                  </button>
                </div>

                <p className="text-center text-xs text-hampton-navy/40">
                  Secure checkout via Stripe. Your deposit is fully refundable.
                </p>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* ── Pricing Menu ── */}
      {pricingItems.length > 0 && <PricingMenu items={pricingItems} />}

      {/* ── Customer Reviews ── */}
      <CustomerReviews />

      {/* ── Design Your Party CTA ── */}
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

      {/* ── Questions CTA ── */}
      <section className="bg-hampton-pink/20 py-14 text-center px-4">
        <h2 className="section-heading mb-3">Questions?</h2>
        <p className="text-hampton-navy text-base mb-7 max-w-md mx-auto">
          Not sure which package is right? We&apos;re happy to help you plan the perfect celebration.
        </p>
        <p className="text-hampton-navy text-sm">
          Call or text us: <a href="tel:6319989325" className="font-semibold">(631) 998-9325</a>
        </p>
      </section>
    </div>
  )
}

/* ── Pricing Menu Component (CategoryModule style) ── */

const menuSections: {
  title: string
  subtitle: string
  headerBg: string
  categories: string[]
}[] = [
  { title: 'Party Themes', subtitle: 'Choose your experience', headerBg: 'bg-gradient-to-r from-hampton-pink to-hampton-pink/80', categories: ['party-theme'] },
  { title: 'Food & Catering', subtitle: 'Included & upgrades', headerBg: 'bg-gradient-to-r from-hampton-navy to-hampton-navy/90', categories: ['food-add-on', 'beverage-add-on', 'dessert-add-on'] },
  { title: 'Decor & Entertainment', subtitle: 'Make it unforgettable', headerBg: 'bg-gradient-to-r from-hampton-mauve to-hampton-mauve/80', categories: ['decor-add-on', 'entertainment-add-on'] },
  { title: 'Party Extras', subtitle: 'The finishing touches', headerBg: 'bg-gradient-to-r from-hampton-blue to-hampton-blue/80', categories: ['party-add-on', 'service-add-on'] },
  { title: 'Activities', subtitle: 'Included & premium', headerBg: 'bg-gradient-to-r from-hampton-pink to-hampton-mauve', categories: ['activity-premium', 'activity-standard'] },
]

function formatPriceCents(cents: number, label?: string | null): string {
  if (label) return label
  if (cents === 0) return 'Included'
  const dollars = cents / 100
  return dollars % 1 === 0 ? `$${dollars.toLocaleString()}` : `$${dollars.toFixed(2)}`
}

function PricingMenu({ items }: { items: PricingItem[] }) {
  const byCategory = new Map<string, PricingItem[]>()
  for (const item of items) {
    const list = byCategory.get(item.category) || []
    list.push(item)
    byCategory.set(item.category, list)
  }

  return (
    <section className="py-16 max-w-4xl mx-auto px-4 sm:px-6">
      <div className="text-center mb-10">
        <h2 className="section-heading">Kids Party Menu</h2>
        <p className="text-hampton-navy/70 text-sm">Full pricing for all party services and add-ons.</p>
      </div>

      <div className="space-y-8">
        {menuSections.map(section => {
          const sectionItems = section.categories.flatMap(cat => byCategory.get(cat) || [])
          if (sectionItems.length === 0) return null
          const isActivities = section.categories.includes('activity-premium')

          return (
            <div key={section.title} className="bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
              <div className={`${section.headerBg} px-8 py-5 text-center`}>
                <h3 className="font-serif text-2xl font-black text-white tracking-tight">{section.title}</h3>
                <p className="text-white/60 text-xs font-semibold tracking-[0.2em] uppercase mt-1">{section.subtitle}</p>
              </div>
              <div className="p-6 sm:p-8">
                {isActivities ? (
                  <div className="flex flex-wrap gap-2">
                    {sectionItems.map(item => (
                      <span
                        key={item.id}
                        className="px-3 py-1.5 rounded-full bg-hampton-pink/10 text-xs font-medium text-hampton-navy"
                      >
                        {item.name}
                        {item.price_cents > 0 && (
                          <span className="ml-1 text-hampton-navy/60">+{formatPriceCents(item.price_cents, item.price_label)}</span>
                        )}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-3">
                    {sectionItems.map(item => (
                      <div
                        key={item.id}
                        className="flex items-start justify-between gap-3 p-4 rounded-xl border border-hampton-mauve/15 bg-hampton-ivory/30"
                      >
                        <div>
                          <p className="font-semibold text-hampton-navy text-sm">{item.name}</p>
                          {item.description && item.description !== 'Premium activity' && item.description !== 'Standard activity' && (
                            <p className="text-hampton-navy/50 text-xs mt-0.5">{item.description}</p>
                          )}
                          {item.is_popular && (
                            <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wider text-hampton-pink">Popular</span>
                          )}
                        </div>
                        <span className="shrink-0 font-bold text-hampton-navy text-sm">
                          {formatPriceCents(item.price_cents, item.price_label)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ── Customer Reviews ── */

const reviews = [
  {
    name: 'Jessica M.',
    event: 'Glow Party',
    text: 'My daughter had the BEST birthday ever! The glow party was incredible \u2014 the kids are still talking about it. Allie handled everything so I could actually enjoy the party. Worth every penny.',
    stars: 5,
  },
  {
    name: 'Sarah K.',
    event: 'Slime Party',
    text: 'We booked the slime party for my son\u2019s 8th birthday and it was amazing. The kids had so much fun making their own slime. Best part? We didn\u2019t have to clean up any of the mess!',
    stars: 5,
  },
  {
    name: 'Maria L.',
    event: 'Spa Party',
    text: 'The spa party was perfect for my tween. Every girl felt so special with the robes, manicures, and face masks. The studio was beautifully decorated. Highly recommend!',
    stars: 5,
  },
  {
    name: 'Ashley R.',
    event: 'Swiftie Party',
    text: 'A+ experience from start to finish. The Swiftie theme was spot-on \u2014 friendship bracelets, karaoke, and the cutest decorations. My daughter said it was the best day of her life!',
    stars: 5,
  },
]

function CustomerReviews() {
  return (
    <section className="py-16 max-w-4xl mx-auto px-4 sm:px-6">
      <div className="text-center mb-10">
        <h2 className="section-heading">What Parents Are Saying</h2>
        <p className="text-hampton-navy/70 text-sm">Real reviews from real Host Hampton families.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-5">
        {reviews.map(review => (
          <div key={review.name} className="bg-white rounded-2xl border border-hampton-pink/20 shadow-sm p-6">
            <div className="flex items-center gap-1 mb-3">
              {Array.from({ length: review.stars }).map((_, i) => (
                <Star key={i} size={14} className="text-amber-400 fill-amber-400" />
              ))}
            </div>
            <p className="text-sm text-hampton-navy/80 leading-relaxed mb-4 italic">
              &ldquo;{review.text}&rdquo;
            </p>
            <div>
              <p className="text-sm font-semibold text-hampton-navy">{review.name}</p>
              <p className="text-xs text-hampton-navy/50">{review.event}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
