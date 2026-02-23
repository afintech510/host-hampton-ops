'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import { Check, ChevronDown, X, Loader2 } from 'lucide-react'
import UniversalCalendar from '@/components/UniversalCalendar'

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
    img: '/images/theme-glow.png',
    desc: 'Black lights, UV face paint, neon accessories, glow bracelets, and a dance party.',
    extendedDesc: 'Transform our studio into a neon wonderland! Every guest gets glow bracelets, neon necklaces, and UV face paint from our professional station. The entire studio is lit with black lights and neon LED strips. We crank up the DJ playlist, and kids dance the night away in a truly electric atmosphere. The perfect party for ages 6\u201314.',
    popular: true,
  },
  {
    name: 'Slime Party',
    price: 900,
    img: '/images/theme-slime.png',
    desc: 'Custom slime-making station with personalized containers and messy fun.',
    extendedDesc: 'Each guest creates their own custom slime with a variety of colors, glitters, scents, and mix-ins. Everyone takes home their creation in a personalized container. We handle ALL the mess \u2014 you just enjoy the fun. Includes fluffy slime, butter slime, and glitter slime stations.',
  },
  {
    name: 'K-Pop Demon Hunter',
    price: 900,
    img: '/images/theme-kpop.png',
    desc: 'K-pop karaoke, dance lesson, neon decor, and hair tinsel.',
    extendedDesc: 'For the K-pop obsessed! Features a guided K-pop dance lesson, karaoke station with all the hits, neon-themed decor, hair tinsel for every guest, and a photo booth with K-pop-inspired props. Perfect for tweens and teens who live for the aesthetic.',
  },
  {
    name: 'Trucker Hat Bar',
    price: 900,
    img: '/images/theme-sweets.png',
    desc: 'Iron-on patches, photo booth, and totally custom trucker hats as favors.',
    extendedDesc: 'The trendiest party on Long Island! Each guest designs their own custom trucker hat with iron-on patches, rhinestones, and embellishments. Includes a photo booth with fun props, and every guest walks away with their one-of-a-kind creation. A huge hit with ages 8+.',
  },
  {
    name: 'Spa Party',
    price: 850,
    img: '/images/theme-spa.png',
    desc: 'Mini manicures, hair styling, face masks, robes, and full glam experience.',
    extendedDesc: 'The ultimate pampering experience. Guests arrive to plush robes and slippers, enjoy mini manicures with kid-safe polish, hair styling or braiding, cucumber face masks, and a relaxation station. Every detail is designed to make them feel like royalty.',
  },
  {
    name: 'Swiftie Party',
    price: 850,
    img: '/images/theme-swiftie.png',
    desc: 'Karaoke, friendship bracelets, hair tinsel, glitter, and all the feels.',
    extendedDesc: 'For every era! Features Taylor Swift karaoke, a friendship bracelet-making station, hair tinsel and glitter stations, era-themed decorations, and trivia games. We play all the hits and create the ultimate Swiftie experience. Eras tour vibes, right in Speonk.',
  },
  {
    name: 'Barbie Party',
    price: 850,
    img: '/images/theme-barbie.png',
    desc: 'Life-size Barbie box photo op, fashion show, and glam styling.',
    extendedDesc: 'Step into Barbie\'s world! Includes a life-size Barbie box photo op, a fashion show runway, glam hair and makeup station, pink-themed decorations from floor to ceiling, and Barbie-inspired activities. Every guest gets the full Barbie treatment.',
  },
  {
    name: 'Unicorn Party',
    price: 850,
    img: '/images/theme-glow.png',
    desc: 'Headbands, glitter crafts, rainbow decor, and magical unicorn activities.',
    extendedDesc: 'Pure magic! Rainbow and pastel decorations transform the studio into a unicorn dreamland. Activities include unicorn headband decorating, glitter crafts, a magical obstacle course, and enchanted photo opportunities. Perfect for ages 3\u20138.',
  },
  {
    name: 'Toddler Party',
    price: 850,
    img: '/images/theme-toddler.png',
    desc: 'Soft play, ball pit, sensory activities, and themed decor for ages 2\u20134.',
    extendedDesc: 'Designed specifically for little ones! Features a soft play area, ball pit, age-appropriate sensory stations, bubble machine, and gentle music. The space is fully baby-proofed and safe. Parents can relax while the little ones explore and play. Ideal for ages 1\u20134.',
  },
  {
    name: 'Sweets & Treats',
    price: 800,
    img: '/images/theme-sweets.png',
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

export default function PartyPackagesContent() {
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    eventType: 'Kids Birthday Party',
    fullName: '',
    email: '',
    phone: '',
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
  const themeSectionRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLDivElement>(null)
  const calendarRef = useRef<HTMLDivElement>(null)

  function handleThemeSelect(name: string) {
    if (selectedTheme === name) {
      setSelectedTheme(null)
      setFormData(prev => ({ ...prev, partyTheme: '' }))
    } else {
      setSelectedTheme(name)
      setFormData(prev => ({ ...prev, partyTheme: name }))
      // Smooth scroll: snap selected theme to top of viewport, then scroll form into view
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

      setSubmitted(true)
      setTimeout(() => {
        calendarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 400)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-hampton-ivory">
      {/* ── Hero ── */}
      <section className="bg-gradient-to-b from-hampton-mauve to-transparent py-20 text-center px-4">
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

      {/* ── What's Included — Glass Card + Glowing Checks ── */}
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

      {/* ── Theme Packages — Single Selectable ── */}
      <section ref={themeSectionRef} className="py-16 max-w-7xl mx-auto px-4 sm:px-6 scroll-mt-4">
        <h2 className="section-heading text-center mb-2">Select Your Theme</h2>
        <p className="text-center text-hampton-navy/70 mb-10">
          {selectedTheme ? 'Click the theme again to deselect, or choose a different one.' : 'Tap a theme to see details and start your booking.'}
        </p>

        <div className={`grid gap-6 transition-all duration-700 ease-in-out ${
          selectedTheme ? 'sm:grid-cols-1 max-w-3xl mx-auto' : 'sm:grid-cols-2 lg:grid-cols-3'
        }`}>
          {themes.map(t => {
            const isSelected = selectedTheme === t.name
            const isHidden = selectedTheme && !isSelected

            return (
              <div
                key={t.name}
                onClick={() => !isHidden && handleThemeSelect(t.name)}
                style={{
                  gridTemplateRows: isHidden ? '0fr' : '1fr',
                  display: 'grid',
                }}
                className={`transition-all ease-in-out ${
                  isHidden
                    ? 'duration-500 opacity-0 scale-95 max-h-0 overflow-hidden pointer-events-none -my-3'
                    : 'duration-700 opacity-100 scale-100 max-h-[800px]'
                }`}
              >
                <div className={`min-h-0 rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 ${
                  isSelected
                    ? 'ring-2 ring-hampton-pink shadow-md bg-white'
                    : t.popular
                      ? 'ring-2 ring-hampton-pink bg-white hover:shadow-lg hover:-translate-y-1'
                      : 'bg-white border border-hampton-pink/20 shadow-sm hover:shadow-lg hover:-translate-y-1'
                }`}>
                  {t.popular && !isSelected && (
                    <div className="bg-gradient-to-r from-hampton-pink to-hampton-pink/80 text-white text-xs font-bold text-center py-1.5 tracking-wide uppercase">
                      Most Popular
                    </div>
                  )}

                  <div className={`relative overflow-hidden transition-all duration-700 ease-in-out ${isSelected ? 'aspect-[21/9]' : 'aspect-video'}`}>
                    <Image src={t.img} alt={t.name} fill className="object-cover transition-transform duration-500 hover:scale-105" />
                    {isSelected && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleThemeSelect(t.name) }}
                        className="absolute top-3 right-3 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center hover:bg-white transition-colors shadow-md z-10"
                      >
                        <X size={16} className="text-hampton-navy" />
                      </button>
                    )}
                  </div>

                  <div className="p-5">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-semibold text-hampton-navy text-lg">{t.name}</h3>
                      <span className="text-hampton-navy font-bold text-lg">from ${t.price.toLocaleString()}</span>
                    </div>

                    <p className={`text-sm leading-relaxed transition-all duration-500 ${isSelected ? 'text-hampton-navy/80' : 'text-hampton-navy/70'}`}>
                      {isSelected ? t.extendedDesc : t.desc}
                    </p>

                    {isSelected && (
                      <div className="flex items-center gap-2 text-hampton-pink text-sm font-semibold pt-3 animate-[fadeIn_0.5s_ease-in]">
                        <div className="w-5 h-5 rounded-full bg-hampton-pink flex items-center justify-center">
                          <Check size={12} strokeWidth={3} className="text-white" />
                        </div>
                        <span>Theme selected — fill out the form below to check availability</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Lead Capture Form — Glass Style ── */}
      <div ref={formRef}>
        <section className="py-16 max-w-2xl mx-auto px-4 sm:px-6">
          <h2 className="section-heading text-center mb-2">Tell Us About Your Party</h2>
          <p className="text-center text-hampton-navy/70 mb-8">
            Fill out the details below and we&apos;ll check availability for you.
          </p>

          <form onSubmit={handleSubmit} className="bg-white rounded-3xl border border-hampton-pink/20 shadow-sm p-8 space-y-5">
            {/* Event Type — Pill Dropdown */}
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

            {/* Child Age & Guest Count */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Child&apos;s Age</label>
                <input type="number" min="1" max="18" placeholder="7" value={formData.childAge}
                  onChange={e => update('childAge', e.target.value)} className="form-input" />
              </div>
              <div>
                <label className="form-label">Guest Count</label>
                <input type="number" min="1" max="50" placeholder="10" value={formData.guestCount}
                  onChange={e => update('guestCount', e.target.value)} className="form-input" />
              </div>
            </div>

            {/* Party Theme */}
            <div>
              <label className="form-label">Party Theme</label>
              <input type="text" placeholder="e.g. Glow Party, Slime Party..." value={formData.partyTheme}
                onChange={e => update('partyTheme', e.target.value)} className="form-input" />
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

            {/* Error */}
            {error && (
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
                <><Loader2 size={18} className="animate-spin" /> Checking...</>
              ) : submitted ? (
                <><Check size={18} /> Info Saved — Pick Your Date Below</>
              ) : (
                'Check Availability'
              )}
            </button>
          </form>
        </section>
      </div>

      {/* ── Calendar — appears after form submit ── */}
      {submitted && (
        <div ref={calendarRef}>
          <section className="py-8 pb-20 max-w-2xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-6">
              <h2 className="section-heading mb-2">Pick Your Date & Time</h2>
              <p className="text-hampton-navy/70 text-sm">
                Select an available date and time below. We&apos;ll confirm within 24 hours.
              </p>
            </div>
            <UniversalCalendar
              mode="booking"
              lockedBookingType="kids-party"
              expandable={false}
              initialExpanded={true}
              defaultDate={formData.preferredDate || undefined}
            />
          </section>
        </div>
      )}

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
