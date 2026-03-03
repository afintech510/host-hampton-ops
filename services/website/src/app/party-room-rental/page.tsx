import type { Metadata } from 'next'
import Link from 'next/link'
import { Check, ChevronDown, Clock, Camera, Briefcase, Palette } from 'lucide-react'
import DynamicTypingSection from '@/components/DynamicTypingSection'
import RoomRentalLeadForm from '@/components/RoomRentalLeadForm'
import { getSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Party Room Rental | Host Hampton, Speonk NY',
  description:
    'Rent our private party studio in Speonk, NY for birthdays, showers, photo shoots, workshops, and more. Starting at $450 for 3 hours. DIY your event your way.',
}

const ROOM_SERVICES = [
  'Baby Shower',
  'Bridal Shower',
  'Birthday Party',
  'Photo Shoot',
  'Pop-Up Shop',
  'Team Meeting',
  'Workshop',
  'Book Club',
]

const useCases = [
  '🎂 Birthday Parties (all ages)',
  '👶 Baby Showers',
  '💍 Bridal Showers',
  '📸 Photo Shoots & Content Days',
  '💅 Beauty Pop-Ups',
  '🎨 Art & Craft Workshops',
  '🛍 Pop-Up Shops',
  '💼 Team Meetings & Trainings',
]

const pricing = [
  { name: 'Weekday Rental', sub: 'Mon\u2013Fri', price: 450, hours: 3 },
  { name: 'Weekend Rental', sub: 'Sat\u2013Sun', price: 575, hours: 3, popular: true },
  { name: 'Full Day Weekday', sub: 'Mon\u2013Fri', price: 700, hours: 12 },
  { name: 'Full Day Weekend', sub: 'Sat\u2013Sun', price: 975, hours: 12 },
]

const faqs = [
  {
    q: "What\u2019s included with the room rental?",
    a: 'Tables, chairs, basic lighting, WiFi, Bluetooth sound system, a prep area, and restroom access are all included. The space is yours to decorate and set up however you like \u2014 you supply everything else.',
  },
  {
    q: 'Can I bring my own catering and vendors?',
    a: 'Absolutely. You\u2019re welcome to bring any outside food, drinks, decorations, and vendors. There are no restrictions on outside catering.',
  },
  {
    q: 'What is the security deposit?',
    a: 'A $500 refundable security deposit is collected separately before your event. It\u2019s returned in full after a post-event inspection confirms the space is in good condition.',
  },
  {
    q: "How do I book? What\u2019s the reservation deposit?",
    a: 'Click Check Availability below, pick your date, and complete the reservation form. A $99 non-refundable deposit holds your date. The remaining balance is due 7 days before the event.',
  },
  {
    q: "What\u2019s the difference between a room rental and studio rental?",
    a: 'A room rental is for private events like parties and showers (3-hour or full-day blocks). A studio rental is hourly and geared toward professional use \u2014 photo shoots, workshops, meetings, and classes.',
  },
  {
    q: 'Where are you located?',
    a: '295 Montauk Highway, Suite 7, Speonk NY 11972 \u2014 right off Montauk Highway in the heart of the Hamptons.',
  },
]

interface MenuItem {
  id: string
  name: string
  description: string | null
  price_cents: number
  price_label: string | null
  price_type: string
  category: string
}

function fmt(cents: number, label?: string | null): string {
  if (label) return label
  if (cents === 0) return 'Included'
  const d = cents / 100
  return d % 1 === 0 ? `$${d.toLocaleString()}` : `$${d.toFixed(2)}`
}

export default async function PartyRoomRental() {
  // Fetch room-rental menu items server-side
  let menuItems: MenuItem[] = []
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('pricing_items')
      .select('id, name, description, category, price_cents, price_label, price_type')
      .eq('is_active', true)
      .or('event_types.cs.{room-rental},event_types.is.null')
      .in('category', ['service-add-on', 'decor-add-on'])
      .order('sort_order', { ascending: true })
    menuItems = data ?? []
  } catch {
    // page still renders
  }

  const serviceAddOns = menuItems.filter(i => i.category === 'service-add-on')
  const decorAddOns = menuItems.filter(i => i.category === 'decor-add-on')

  return (
    <div>
      {/* ── Hero: Dynamic Typing ── */}
      <DynamicTypingSection
        services={ROOM_SERVICES}
        subtitle="Our private Hamptons studio is the perfect blank canvas. You bring the vision &#8212; we provide the space, tables, chairs, and everything you need to make it yours."
        ctaText=""
      />

      {/* ── Use Cases ── */}
      <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <h2 className="section-heading">Your Space. Your Vision.</h2>
          <p className="text-hampton-navy max-w-xl mx-auto">
            Perfect for any occasion that deserves a beautiful, private setting.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {useCases.map(u => (
            <div
              key={u}
              className="bg-white border border-hampton-pink/20 rounded-xl px-4 py-3 text-sm text-hampton-navy font-medium text-center"
            >
              {u}
            </div>
          ))}
        </div>
      </section>

      {/* ── Rental Rates ── */}
      <section className="bg-hampton-pink/10 py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <h2 className="section-heading text-center mb-2">Rental Rates</h2>
          <p className="text-center text-hampton-navy mb-8">
            All rentals include the space only. Tables, chairs, and basic lighting included.
          </p>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4">
            {pricing.map(p => (
              <div
                key={p.name}
                className={`rounded-2xl p-5 text-center ${
                  p.popular
                    ? 'bg-hampton-pink/20 border-2 border-hampton-pink'
                    : 'bg-white border border-hampton-pink/20'
                }`}
              >
                {p.popular && (
                  <p className="text-hampton-navy text-xs font-bold mb-1 uppercase tracking-wide">
                    Most Booked
                  </p>
                )}
                <h3 className="font-serif text-hampton-navy text-base font-bold mb-1">{p.name}</h3>
                <p className="text-hampton-navy text-xs mb-3">{p.sub}</p>
                <p className="text-2xl font-bold text-hampton-navy">${p.price}</p>
                <p className="text-hampton-navy text-xs mt-1">
                  {p.hours} {p.hours === 1 ? 'hour' : 'hours'}
                </p>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-hampton-pink/20 p-5 mt-6">
            <p className="text-hampton-navy text-sm font-semibold mb-2">Additional Details</p>
            <ul className="space-y-1.5">
              {[
                'Additional hours available: $50/hr (weekday) or $100/hr (weekend)',
                'Security deposit: $500 (refundable after event)',
                'You may bring your own decorations, catering, and vendors',
                'Tables and chairs for up to 60 guests included',
                'WiFi included',
                'Bluetooth sound system included',
              ].map(i => (
                <li key={i} className="flex items-start gap-2 text-sm text-hampton-navy">
                  <Check size={14} className="shrink-0 mt-0.5" />
                  <span>{i}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Lead Capture Form ── */}
      <RoomRentalLeadForm />

      {/* ── Hourly Studio Rental ── */}
      <section className="py-16 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="section-heading">Hourly Studio Rental</h2>
            <p className="text-hampton-navy max-w-lg mx-auto">
              For professional use &#8212; photo shoots, meetings, workshops, and more.
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-hampton-pink/20 p-6 sm:p-8">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-serif text-xl font-bold text-hampton-navy">Studio by the Hour</h3>
                <p className="text-hampton-navy/60 text-sm mt-1">
                  Photography, meetings, workshops, classes, cosmetics
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-hampton-navy">$75</p>
                <p className="text-hampton-navy/60 text-xs">per hour</p>
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              {[
                { icon: Camera, text: 'Photo shoots & content creation' },
                { icon: Briefcase, text: 'Team meetings & trainings' },
                { icon: Palette, text: 'Workshops & pop-up classes' },
              ].map(({ icon: Icon, text }) => (
                <div
                  key={text}
                  className="flex items-center gap-2.5 p-3 rounded-xl bg-hampton-ivory/50 border border-hampton-pink/10"
                >
                  <Icon size={16} className="shrink-0 text-hampton-pink" />
                  <span className="text-sm text-hampton-navy">{text}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-hampton-mauve mt-4 flex items-center gap-1.5">
              <Clock size={12} />
              Minimum 1-hour booking. Additional hours billed at the same rate.
            </p>
          </div>
        </div>
      </section>

      {/* ── Room Rental Menu (display-only) ── */}
      {(serviceAddOns.length > 0 || decorAddOns.length > 0) && (
        <section className="bg-hampton-pink/10 py-16 px-4 sm:px-6">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="section-heading">Room Rental Menu</h2>
              <p className="text-hampton-navy max-w-lg mx-auto">
                Optional add-on services to make your event even easier.
              </p>
            </div>

            <div className="space-y-8">
              {/* Services & Add-Ons */}
              {serviceAddOns.length > 0 && (
                <div className="bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
                  <div className="bg-gradient-to-r from-hampton-navy to-hampton-navy/90 px-8 py-5 text-center">
                    <h3 className="font-serif text-2xl font-black text-white tracking-tight">
                      Services &amp; Add-Ons
                    </h3>
                    <p className="text-white/60 text-xs font-semibold tracking-[0.2em] uppercase mt-1">
                      Let us handle the details
                    </p>
                  </div>
                  <div className="p-6 sm:p-8">
                    <div className="grid sm:grid-cols-2 gap-3">
                      {serviceAddOns.map(item => (
                        <div
                          key={item.id}
                          className="flex items-start justify-between gap-3 p-4 rounded-xl border border-hampton-mauve/15 bg-hampton-ivory/30"
                        >
                          <div>
                            <p className="font-semibold text-hampton-navy text-sm">{item.name}</p>
                            {item.description && (
                              <p className="text-hampton-navy/50 text-xs mt-0.5">{item.description}</p>
                            )}
                          </div>
                          <span className="shrink-0 font-bold text-hampton-navy text-sm">
                            {fmt(item.price_cents, item.price_label)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Decor */}
              {decorAddOns.length > 0 && (
                <div className="bg-white rounded-3xl shadow-lg border border-hampton-pink/20 overflow-hidden">
                  <div className="bg-gradient-to-r from-hampton-pink to-hampton-pink/80 px-8 py-5 text-center">
                    <h3 className="font-serif text-2xl font-black text-white tracking-tight">
                      Decor
                    </h3>
                    <p className="text-white/60 text-xs font-semibold tracking-[0.2em] uppercase mt-1">
                      Finishing touches
                    </p>
                  </div>
                  <div className="p-6 sm:p-8">
                    <div className="grid sm:grid-cols-2 gap-3">
                      {decorAddOns.map(item => (
                        <div
                          key={item.id}
                          className="flex items-start justify-between gap-3 p-4 rounded-xl border border-hampton-mauve/15 bg-hampton-ivory/30"
                        >
                          <div>
                            <p className="font-semibold text-hampton-navy text-sm">{item.name}</p>
                            {item.description && (
                              <p className="text-hampton-navy/50 text-xs mt-0.5">{item.description}</p>
                            )}
                          </div>
                          <span className="shrink-0 font-bold text-hampton-navy text-sm">
                            {fmt(item.price_cents, item.price_label)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── FAQ ── */}
      <section className="py-16 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          <h2 className="section-heading text-center mb-10">Frequently Asked Questions</h2>
          <div className="space-y-3">
            {faqs.map(faq => (
              <details
                key={faq.q}
                className="group rounded-xl border border-hampton-pink/20 bg-white open:border-hampton-pink/40 open:shadow-sm transition-all"
              >
                <summary className="flex items-center justify-between gap-4 p-5 cursor-pointer list-none font-semibold text-hampton-navy text-sm">
                  {faq.q}
                  <ChevronDown
                    size={16}
                    className="shrink-0 text-hampton-mauve group-open:rotate-180 transition-transform"
                  />
                </summary>
                <p className="px-5 pb-5 text-hampton-navy/70 text-sm leading-relaxed">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-14 text-center px-4">
        <h2 className="section-heading mb-3">Book the Studio</h2>
        <p className="text-hampton-navy mb-7 max-w-md mx-auto">
          Reserve with a $99 deposit. Perfect for any event where you want a gorgeous, private
          setting.
        </p>
        <Link href="/book?type=room-rental" className="btn-primary px-10 py-4 text-base">
          Check Availability
        </Link>
      </section>
    </div>
  )
}
