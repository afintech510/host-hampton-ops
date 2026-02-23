import type { Metadata } from 'next'
import Link from 'next/link'
import { Check } from 'lucide-react'
import UniversalCalendar from '@/components/UniversalCalendar'

export const metadata: Metadata = {
  title: 'Party Room Rental | Host Hampton, Speonk NY',
  description: 'Rent our private party studio in Speonk, NY for birthdays, showers, photo shoots, workshops, and more. Starting at $450 for 3 hours. DIY your event your way.',
}

const useCases = [
  '🎂 Birthday Parties (all ages)', '👶 Baby Showers', '💍 Bridal Showers', '📸 Photo Shoots & Content Days',
  '💅 Beauty Pop-Ups', '🎨 Art & Craft Workshops', '🛍 Pop-Up Shops', '💼 Team Meetings & Trainings',
]

const pricing = [
  { name: 'Weekday Rental',   sub: 'Mon–Fri', price: 450,  hours: 3 },
  { name: 'Weekend Rental',   sub: 'Sat–Sun', price: 575,  hours: 3, popular: true },
  { name: 'Full Day Rental',  sub: 'Any day', price: 975,  hours: 12 },
  { name: 'Studio Hourly',    sub: 'Shoots, classes, pop-ups', price: 75, hours: 1 },
]

export default function PartyRoomRental() {
  return (
    <div className="bg-hampton-ivory">
      <section className="py-16 text-center px-4">
        <h1 className="font-serif text-4xl md:text-5xl text-hampton-navy mb-4">Party Room Rental</h1>
        <p className="text-hampton-navy text-lg max-w-xl mx-auto">
          Our beautiful, private studio is yours to use however you like. You bring the ideas — we provide the perfect space.
        </p>
      </section>

      <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-10">
          <h2 className="section-heading">Your Space. Your Vision.</h2>
          <p className="text-hampton-navy max-w-xl mx-auto">Perfect for any occasion that deserves a beautiful, private setting.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {useCases.map(u => (
            <div key={u} className="bg-white border border-hampton-pink/20 rounded-xl px-4 py-3 text-sm text-hampton-navy font-medium text-center">
              {u}
            </div>
          ))}
        </div>
      </section>

      <section className="bg-hampton-pink/10 py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <h2 className="section-heading text-center mb-2">Rental Rates</h2>
          <p className="text-center text-hampton-navy mb-8">All rentals include the space only. Tables, chairs, and basic lighting included.</p>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4">
            {pricing.map(p => (
              <div key={p.name}
                   className={`rounded-2xl p-5 text-center ${p.popular ? 'bg-hampton-pink/20 border-2 border-hampton-pink' : 'bg-white border border-hampton-pink/20'}`}>
                {p.popular && <p className="text-hampton-navy text-xs font-bold mb-1 uppercase tracking-wide">Most Booked</p>}
                <h3 className="font-serif text-hampton-navy text-base font-bold mb-1">{p.name}</h3>
                <p className="text-hampton-navy text-xs mb-3">{p.sub}</p>
                <p className="text-2xl font-bold text-hampton-navy">${p.price}</p>
                <p className="text-hampton-navy text-xs mt-1">{p.hours} {p.hours === 1 ? 'hour' : 'hours'}</p>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-hampton-pink/20 p-5 mt-6">
            <p className="text-hampton-navy text-sm font-semibold mb-2">Additional Details</p>
            <ul className="space-y-1.5">
              {[
                'Additional hours available: $75/hr (weekday) or $100/hr (weekend)',
                'Security deposit: $500 (refundable after event)',
                'Cleaning fee waived if space left in original condition',
                'You may bring your own decorations, catering, and vendors',
                'Tables and chairs for up to 60 guests included',
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

      {/* Check Availability */}
      <section className="py-14 max-w-2xl mx-auto px-4 sm:px-6">
        <UniversalCalendar
          mode="booking"
          lockedBookingType="room-rental"
          expandable={true}
          initialExpanded={false}
        />
      </section>

      <section className="py-14 text-center px-4">
        <h2 className="section-heading mb-3">Book the Studio</h2>
        <p className="text-hampton-navy mb-7 max-w-md mx-auto">
          Reserve with a $250 deposit. Perfect for any event where you want a gorgeous, private setting.
        </p>
        <Link href="/book?event_type=room-rental" className="btn-primary px-10 py-4 text-base">
          Reserve the Space
        </Link>
      </section>
    </div>
  )
}
