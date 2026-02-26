'use client'

import { useState, useRef, useCallback } from 'react'
import Image from 'next/image'
import { Check, ChevronDown, X, Loader2, Star, Calendar, Clock, Users, Sparkles, UtensilsCrossed, Palette, Gift, Music, Bookmark } from 'lucide-react'
import UniversalCalendar from '@/components/UniversalCalendar'
import ImageSlider from '@/components/ImageSlider'
import type { CalendarSelection } from '@/components/UniversalCalendar/types'
import type { PricingItem } from './page'

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
  {
    name: 'Glow Party',
    price: 950,
    imgs: ['/images/theme-glow.png'],
    desc: 'Black lights, UV face paint, neon accessories, glow bracelets, and a dance party.',
    extendedDesc: 'Transform our studio into a neon wonderland! Every guest gets glow bracelets, neon necklaces, and UV face paint from our professional station. The entire studio is lit with black lights and neon LED strips. We crank up the DJ playlist, and kids dance the night away in a truly electric atmosphere. The perfect party for ages 6\u201314.',
    popular: true,
  },
  {
    name: 'Slime Party',
    price: 900,
    imgs: ['/images/theme-slime.png'],
    desc: 'Custom slime-making station with personalized containers and messy fun.',
    extendedDesc: 'Each guest creates their own custom slime with a variety of colors, glitters, scents, and mix-ins. Everyone takes home their creation in a personalized container. We handle ALL the mess \u2014 you just enjoy the fun. Includes fluffy slime, butter slime, and glitter slime stations.',
  },
  {
    name: 'K-Pop Demon Hunter',
    price: 900,
    imgs: ['/images/theme-kpop.png'],
    desc: 'K-pop karaoke, dance lesson, neon decor, and hair tinsel.',
    extendedDesc: 'For the K-pop obsessed! Features a guided K-pop dance lesson, karaoke station with all the hits, neon-themed decor, hair tinsel for every guest, and a photo booth with K-pop-inspired props. Perfect for tweens and teens who live for the aesthetic.',
  },
  {
    name: 'Trucker Hat Bar',
    price: 900,
    imgs: ['/images/theme-sweets.png'],
    desc: 'Iron-on patches, photo booth, and totally custom trucker hats as favors.',
    extendedDesc: 'The trendiest party on Long Island! Each guest designs their own custom trucker hat with iron-on patches, rhinestones, and embellishments. Includes a photo booth with fun props, and every guest walks away with their one-of-a-kind creation. A huge hit with ages 8+.',
  },
  {
    name: 'Spa Party',
    price: 850,
    imgs: ['/images/theme-spa.png'],
    desc: 'Mini manicures, hair styling, face masks, robes, and full glam experience.',
    extendedDesc: 'The ultimate pampering experience. Guests arrive to plush robes and slippers, enjoy mini manicures with kid-safe polish, hair styling or braiding, cucumber face masks, and a relaxation station. Every detail is designed to make them feel like royalty.',
  },
  {
    name: 'Swiftie Party',
    price: 850,
    imgs: ['/images/theme-swiftie.png'],
    desc: 'Karaoke, friendship bracelets, hair tinsel, glitter, and all the feels.',
    extendedDesc: 'For every era! Features Taylor Swift karaoke, a friendship bracelet-making station, hair tinsel and glitter stations, era-themed decorations, and trivia games. We play all the hits and create the ultimate Swiftie experience. Eras tour vibes, right in Speonk.',
  },
  {
    name: 'Barbie Party',
    price: 850,
    imgs: ['/images/theme-barbie.png'],
    desc: 'Life-size Barbie box photo op, fashion show, and glam styling.',
    extendedDesc: 'Step into Barbie\'s world! Includes a life-size Barbie box photo op, a fashion show runway, glam hair and makeup station, pink-themed decorations from floor to ceiling, and Barbie-inspired activities. Every guest gets the full Barbie treatment.',
  },
  {
    name: 'Unicorn Party',
    price: 850,
    imgs: ['/images/theme-glow.png'],
    desc: 'Headbands, glitter crafts, rainbow decor, and magical unicorn activities.',
    extendedDesc: 'Pure magic! Rainbow and pastel decorations transform the studio into a unicorn dreamland. Activities include unicorn headband decorating, glitter crafts, a magical obstacle course, and enchanted photo opportunities. Perfect for ages 3\u20138.',
  },
  {
    name: 'Toddler Party',
    price: 850,
    imgs: ['/images/theme-toddler.png'],
    desc: 'Soft play, ball pit, sensory activities, and themed decor for ages 2\u20134.',
    extendedDesc: 'Designed specifically for little ones! Features a soft play area, ball pit, age-appropriate sensory stations, bubble machine, and gentle music. The space is fully baby-proofed and safe. Parents can relax while the little ones explore and play. Ideal for ages 1\u20134.',
  },
  {
    name: 'Sweets & Treats',
    price: 800,
    imgs: ['/images/theme-sweets.png'],
    desc: 'Cookie and cupcake decorating, candy wall, dessert stations, and sweet fun.',
    extendedDesc: 'A sugar lover\'s dream! Guests decorate cookies and cupcakes with professional-grade supplies, enjoy a candy wall with every sweet imaginable, and visit dessert stations throughout the studio. Includes all decorating supplies, aprons, and take-home boxes for creations.',
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
  const themeSectionRef = useRef<HTMLDivElement>(null)
  const calendarRef = useRef<HTMLDivElement>(null)
  const summaryRef = useRef<HTMLDivElement>(null)

  const selectedThemeData = themes.find(t => t.name === (formData.partyTheme || selectedTheme))

  function handleThemeSelect(name: string) {
    if (selectedTheme === name) {
      setSelectedTheme(null)
      setFormData(prev => ({ ...prev, partyTheme: '' }))
    } else {
      setSelectedTheme(name)
      setFormData(prev => ({ ...prev, partyTheme: name }))
      setTimeout(() => {
        themeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }
  }

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
        }),
      })

      let data: Record<string, string> = {}
      const text = await res.text()
      try { data = JSON.parse(text) } catch { /* non-JSON response */ }

      if (!res.ok) throw new Error(data.error || 'Something went wrong \u2014 please try again')

      setSubmitting(false)
      setSubmitted(true)
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
          guestCount: formData.guestCount,
          notes: formData.notes,
          bookingTypeSlug: 'kids-party',
          partyTags: {
            theme: formData.partyTheme || selectedTheme,
            price: selectedThemeData?.price,
          },
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Checkout failed')

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

    const gc = parseInt(formData.guestCount) || 10
    const summaryLines = [
      themeName ? `Theme: ${themeName}${selectedThemeData ? ` ($${selectedThemeData.price.toLocaleString()})` : ''}` : null,
      `Guests: ${gc}`,
      formData.childName ? `Child: ${formData.childName}${formData.childAge ? `, age ${formData.childAge}` : ''}` : null,
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
          partyDate: calendarSelection?.date || null,
          partyTime: calendarSelection?.timeSlot?.start || null,
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
          Pick a theme that makes your child&apos;s heart sing, then tell us about your party.
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

      {/* ── Theme Packages ── */}
      <section ref={themeSectionRef} className="py-8 max-w-7xl mx-auto px-4 sm:px-6 scroll-mt-24">
        <h2 className="section-heading text-center mb-2">Select Your Theme</h2>
        <p className="text-center text-hampton-navy/70 mb-8">
          {selectedTheme ? 'Click the theme again to deselect, or choose a different one below.' : 'Tap a theme to see details and start your booking.'}
        </p>

        {selectedTheme && selectedThemeData ? (
          <div className="animate-[fadeIn_0.3s_ease-out]">
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
                    <span className="text-hampton-navy font-bold text-xl">from ${selectedThemeData.price.toLocaleString()}</span>
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
                    <p className="text-[10px] text-hampton-navy/50 text-center">${t.price.toLocaleString()}</p>
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
                    <span className="text-hampton-navy font-bold text-lg">from ${t.price.toLocaleString()}</span>
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
              <input type="number" min="1" max="50" placeholder="10" value={formData.guestCount}
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
                      <p className="text-sm font-semibold text-hampton-navy">{guestCount} guests + Birthday Star</p>
                    </div>
                  </div>
                </div>

                {/* Pricing breakdown */}
                <div className="border-t border-hampton-pink/15 pt-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-hampton-navy">Estimated Party Cost</span>
                    <span className="text-xl font-bold text-hampton-navy">
                      {selectedThemeData ? `from $${selectedThemeData.price.toLocaleString()}` : 'TBD'}
                    </span>
                  </div>
                  <p className="text-xs text-hampton-navy/60">
                    10 guests + Birthday Star is included. Additional guests are $35 each.
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
                      'Reserve Now — $99 Deposit'
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

      {/* ── CTA ── */}
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

/* ── Pricing Menu Component ── */

const menuSections: {
  title: string
  icon: React.ReactNode
  categories: string[]
}[] = [
  { title: 'Party Themes', icon: <Sparkles size={18} />, categories: ['party-theme'] },
  { title: 'Food & Catering', icon: <UtensilsCrossed size={18} />, categories: ['food-add-on', 'beverage-add-on', 'dessert-add-on'] },
  { title: 'Decor & Entertainment', icon: <Palette size={18} />, categories: ['decor-add-on', 'entertainment-add-on'] },
  { title: 'Party Extras', icon: <Gift size={18} />, categories: ['party-add-on', 'service-add-on'] },
  { title: 'Activities Included', icon: <Music size={18} />, categories: ['activity-premium', 'activity-standard'] },
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
        <h2 className="section-heading">Our Menu</h2>
        <p className="text-hampton-navy/70 text-sm">Full pricing for all party services and add-ons.</p>
      </div>

      <div className="bg-white rounded-3xl border border-hampton-pink/20 shadow-sm overflow-hidden divide-y divide-hampton-pink/10">
        {menuSections.map(section => {
          const sectionItems = section.categories.flatMap(cat => byCategory.get(cat) || [])
          if (sectionItems.length === 0) return null
          const isActivities = section.categories.includes('activity-premium')

          return (
            <div key={section.title} className="px-6 sm:px-8 py-6">
              <div className="flex items-center gap-2.5 mb-4">
                <span className="text-hampton-pink">{section.icon}</span>
                <h3 className="font-serif text-lg text-hampton-navy">{section.title}</h3>
              </div>

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
                <div className="space-y-0">
                  {sectionItems.map((item, i) => (
                    <div
                      key={item.id}
                      className={`flex items-baseline justify-between py-2 ${
                        i < sectionItems.length - 1 ? 'border-b border-dashed border-hampton-pink/10' : ''
                      } ${item.is_popular ? 'bg-hampton-pink/5 -mx-3 px-3 rounded-lg' : ''}`}
                    >
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-sm text-hampton-navy font-medium truncate">{item.name}</span>
                        {item.is_popular && (
                          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-hampton-pink">Popular</span>
                        )}
                        {item.description && item.description !== 'Premium activity' && item.description !== 'Standard activity' && (
                          <span className="hidden sm:inline text-xs text-hampton-navy/40 truncate">{item.description}</span>
                        )}
                      </div>
                      <span className="text-sm font-bold text-hampton-navy ml-4 shrink-0 tabular-nums">
                        {formatPriceCents(item.price_cents, item.price_label)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
