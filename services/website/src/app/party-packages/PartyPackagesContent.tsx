'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { Check, ChevronDown, X, Loader2, Sparkles } from 'lucide-react'
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

/* Sparkle particle data — generated once, stable across renders */
const sparkles = Array.from({ length: 40 }, (_, i) => ({
  id: i,
  top: `${(i * 17 + 7) % 100}%`,
  left: `${(i * 23 + 13) % 100}%`,
  size: (i % 3) + 1.5,
  delay: `${(i * 0.13) % 5}s`,
  duration: `${(i % 3) + 2.5}s`,
  isGold: i % 5 === 0,
}))

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
  const [mounted, setMounted] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)
  const calendarRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  function handleThemeSelect(name: string) {
    if (selectedTheme === name) {
      setSelectedTheme(null)
      setFormData(prev => ({ ...prev, partyTheme: '' }))
    } else {
      setSelectedTheme(name)
      setFormData(prev => ({ ...prev, partyTheme: name }))
      setTimeout(() => {
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 300)
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
    <div className="bg-hampton-ivory relative overflow-hidden selection:bg-hampton-mauve selection:text-hampton-navy">
      {/* ── Inline Styles for Animations ── */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes glisten {
          0%, 100% { opacity: 0; transform: scale(0.5); }
          50% { opacity: 0.7; transform: scale(1.4); }
        }
        .sparkle-particle {
          position: absolute;
          border-radius: 50%;
          animation: glisten infinite ease-in-out;
          pointer-events: none;
        }
        .sparkle-silver {
          background: #AEB6C2;
          box-shadow: 0 0 8px 2px rgba(174,182,194,0.5), 0 0 16px 4px rgba(255,255,255,0.6);
        }
        .sparkle-gold {
          background: #C7A36B;
          box-shadow: 0 0 8px 2px rgba(199,163,107,0.5), 0 0 16px 4px rgba(255,255,255,0.6);
        }
        @keyframes gentle-float {
          0% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(20px, -30px) scale(1.05); }
          66% { transform: translate(-15px, 15px) scale(0.95); }
          100% { transform: translate(0, 0) scale(1); }
        }
        .animate-float-1 { animation: gentle-float 18s infinite ease-in-out; }
        .animate-float-2 { animation: gentle-float 22s infinite ease-in-out reverse; }
        .glass-card {
          background: rgba(255, 255, 255, 0.65);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.8);
          box-shadow: 0 10px 40px rgba(0,0,0,0.04);
        }
        .hover-float {
          transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        .hover-float:hover {
          transform: translateY(-6px);
          box-shadow: 0 16px 40px rgba(174,182,194,0.35);
        }
        @keyframes shimmer-sweep {
          0% { transform: translateX(-150%) skewX(-15deg); }
          50% { transform: translateX(150%) skewX(-15deg); }
          100% { transform: translateX(150%) skewX(-15deg); }
        }
        .shimmer-on-hover {
          position: relative;
          overflow: hidden;
        }
        .shimmer-on-hover::before {
          content: '';
          position: absolute;
          top: 0; left: 0; width: 50%; height: 100%;
          background: linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.7) 50%, rgba(255,255,255,0) 100%);
          transform: translateX(-150%) skewX(-15deg);
          z-index: 1;
          pointer-events: none;
        }
        .shimmer-on-hover:hover::before {
          animation: shimmer-sweep 1.5s ease-in-out;
        }
        .glow-check {
          box-shadow: 0 0 10px rgba(174,182,194,0.7), 0 0 20px rgba(174,182,194,0.3);
        }
      `}} />

      {/* ── Background Sparkle Particles ── */}
      {mounted && (
        <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden" style={{ mixBlendMode: 'multiply' }}>
          {sparkles.map(s => (
            <div
              key={s.id}
              className={`sparkle-particle ${s.isGold ? 'sparkle-gold' : 'sparkle-silver'}`}
              style={{
                top: s.top,
                left: s.left,
                width: `${s.size}px`,
                height: `${s.size}px`,
                animationDelay: s.delay,
                animationDuration: s.duration,
              }}
            />
          ))}
        </div>
      )}

      {/* ── Floating Blobs (Aurora) ── */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[15%] left-[5%] w-[400px] h-[400px] rounded-full bg-hampton-mauve/30 blur-[100px] animate-float-1" />
        <div className="absolute top-[40%] right-[0%] w-[350px] h-[350px] rounded-full bg-hampton-pink/20 blur-[100px] animate-float-2" />
      </div>

      {/* ── Hero — Gradient blending into background ── */}
      <section className="relative z-10 bg-gradient-to-b from-hampton-mauve to-transparent py-20 text-center px-4">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/40 mb-6 text-hampton-pink text-sm font-bold tracking-widest uppercase border border-white/60 shadow-sm">
          <Sparkles size={14} /> Everything Included
        </div>
        <h1 className="font-serif text-4xl md:text-6xl text-hampton-navy mb-4">
          Party Packages & Pricing
        </h1>
        <p className="text-hampton-navy/80 text-lg max-w-xl mx-auto font-medium">
          Pick a theme that makes your child&apos;s heart sing, then tell us about your party.
        </p>
      </section>

      {/* ── What's Included — Glass Card + Glowing Checks ── */}
      <section className="relative z-10 py-16 max-w-4xl mx-auto px-4 sm:px-6 -mt-6">
        <div className="text-center mb-10">
          <h2 className="section-heading">Every Party Includes</h2>
          <p className="text-hampton-navy/70">No hidden costs. No upcharges. Everything below is included.</p>
        </div>
        <div className="glass-card rounded-3xl p-8 md:p-12 hover-float">
          <div className="grid md:grid-cols-2 gap-y-4 gap-x-10">
            {included.map(item => (
              <div key={item} className="flex items-center gap-3 bg-white/50 backdrop-blur-sm p-3 rounded-lg border border-white hover:border-hampton-mauve/50 transition-colors">
                <div className="w-6 h-6 rounded-full bg-hampton-mauve flex items-center justify-center text-white shrink-0 glow-check">
                  <Check size={14} strokeWidth={3} />
                </div>
                <span className="text-hampton-navy text-sm font-medium">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Theme Packages — Single Selectable with Shimmer ── */}
      <section className="relative z-10 py-16 max-w-7xl mx-auto px-4 sm:px-6">
        <h2 className="section-heading text-center mb-2">Select Your Theme</h2>
        <p className="text-center text-hampton-navy/70 mb-10">
          {selectedTheme ? 'Click the theme again to deselect, or choose a different one.' : 'Tap a theme to see details and start your booking.'}
        </p>

        <div className={`grid gap-6 transition-all duration-500 ${
          selectedTheme ? 'sm:grid-cols-1 max-w-3xl mx-auto' : 'sm:grid-cols-2 lg:grid-cols-3'
        }`}>
          {themes.map(t => {
            const isSelected = selectedTheme === t.name
            const isHidden = selectedTheme && !isSelected

            if (isHidden) return null

            return (
              <div
                key={t.name}
                onClick={() => handleThemeSelect(t.name)}
                className={`shimmer-on-hover rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 hover-float ${
                  isSelected
                    ? 'ring-2 ring-hampton-pink shadow-[0_10px_30px_rgba(199,163,107,0.2)] bg-white'
                    : t.popular
                      ? 'ring-2 ring-hampton-pink bg-white/90 backdrop-blur-sm'
                      : 'bg-white/90 backdrop-blur-sm border border-white shadow-sm'
                }`}
              >
                {t.popular && !isSelected && (
                  <div className="bg-gradient-to-r from-hampton-pink to-hampton-pink/80 text-white text-xs font-bold text-center py-1.5 tracking-wide uppercase">
                    Most Popular
                  </div>
                )}

                <div className={`relative overflow-hidden ${isSelected ? 'aspect-[21/9]' : 'aspect-video'}`}>
                  <Image src={t.img} alt={t.name} fill className="object-cover group-hover:scale-105 transition-transform duration-500" />
                  {isSelected && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleThemeSelect(t.name) }}
                      className="absolute top-3 right-3 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center hover:bg-white transition-colors shadow-md z-10"
                    >
                      <X size={16} className="text-hampton-navy" />
                    </button>
                  )}
                </div>

                <div className="p-5 relative z-10">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-hampton-navy text-lg">{t.name}</h3>
                    <span className="text-hampton-navy font-bold text-lg">from ${t.price.toLocaleString()}</span>
                  </div>

                  {isSelected ? (
                    <div className="space-y-3">
                      <p className="text-hampton-navy/80 text-sm leading-relaxed">{t.extendedDesc}</p>
                      <div className="flex items-center gap-2 text-hampton-pink text-sm font-semibold pt-1">
                        <div className="w-5 h-5 rounded-full bg-hampton-pink flex items-center justify-center glow-check" style={{ boxShadow: '0 0 10px rgba(199,163,107,0.7)' }}>
                          <Check size={12} strokeWidth={3} className="text-white" />
                        </div>
                        <span>Theme selected — fill out the form below to check availability</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-hampton-navy/70 text-sm leading-relaxed">{t.desc}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Lead Capture Form — Glass Style ── */}
      <div ref={formRef} className="relative z-10">
        <section className="py-16 max-w-2xl mx-auto px-4 sm:px-6">
          <h2 className="section-heading text-center mb-2">Tell Us About Your Party</h2>
          <p className="text-center text-hampton-navy/70 mb-8">
            Fill out the details below and we&apos;ll check availability for you.
          </p>

          <form onSubmit={handleSubmit} className="glass-card rounded-3xl p-8 space-y-5">
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
                          ? 'border-hampton-pink bg-hampton-pink/20 text-hampton-navy shadow-[0_0_12px_rgba(199,163,107,0.3)]'
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
        <div ref={calendarRef} className="relative z-10">
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
      <section className="relative z-10 bg-hampton-pink/20 py-14 text-center px-4">
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
