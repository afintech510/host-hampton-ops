'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Calendar, Clock } from 'lucide-react'
import type { EventRow } from './page'

function formatPrice(cents: number): string {
  if (cents === 0) return 'FREE'
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function availabilityBadge(available: number, max: number) {
  if (available <= 0) return { text: 'Sold Out', color: 'bg-red-100 text-red-700' }
  const pct = available / max
  if (pct <= 0.2) return { text: `${available} spots left`, color: 'bg-amber-100 text-amber-700' }
  return { text: `${available} spots`, color: 'bg-green-100 text-green-700' }
}

function EventCard({ event }: { event: EventRow }) {
  const priceDisplay = event.has_variants
    ? `From ${formatPrice(Math.min(...event.variants.map(v => v.priceCents)))}`
    : formatPrice(event.price_cents)

  const badge = availabilityBadge(event.available_tickets, event.max_tickets)
  const dateDisplay = event.event_date
    ? formatDate(event.event_date)
    : event.has_sessions
      ? 'Multiple Dates'
      : 'Date TBD'

  const soldOut = event.available_tickets <= 0

  return (
    <Link
      href={`/events/${event.slug}`}
      className="group bg-white rounded-2xl border border-hampton-pink/20 overflow-hidden hover:shadow-lg transition-all duration-300 flex flex-col"
    >
      <div className="h-48 relative overflow-hidden">
        {event.image_url ? (
          <img src={event.image_url} alt={event.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-hampton-blue/30 to-hampton-pink/30 flex items-center justify-center">
            <Calendar className="w-12 h-12 text-hampton-navy/20" />
          </div>
        )}
        <span className="absolute top-3 right-3 bg-white/90 text-hampton-navy font-bold px-3 py-1 rounded-full text-sm shadow-sm">
          {priceDisplay}
        </span>
        <span className="absolute top-3 left-3 bg-hampton-navy/80 text-white px-2.5 py-0.5 rounded-full text-xs capitalize">
          {event.category}
        </span>
      </div>

      <div className="p-5 flex flex-col flex-1">
        <h2 className="font-serif text-lg text-hampton-navy font-semibold mb-2 group-hover:text-hampton-blue transition-colors">
          {event.title}
        </h2>
        <p className="text-hampton-navy text-sm leading-relaxed mb-4 line-clamp-2 flex-1">
          {event.short_description || event.description}
        </p>

        <div className="flex items-center gap-3 text-xs text-hampton-navy/80 mb-4">
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            {dateDisplay}
          </span>
          {event.event_time && (
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {event.event_time}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-hampton-pink/10">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${badge.color}`}>
            {badge.text}
          </span>
          <span className={`text-sm font-semibold ${soldOut ? 'text-gray-400' : 'text-hampton-navy group-hover:text-hampton-blue'} transition-colors`}>
            {soldOut ? 'Sold Out' : event.price_cents === 0 ? 'RSVP →' : 'Get Tickets →'}
          </span>
        </div>
      </div>
    </Link>
  )
}

export default function EventFilters({ events, categories }: { events: EventRow[]; categories: string[] }) {
  const [active, setActive] = useState('all')

  const filtered = active === 'all' ? events : events.filter(e => e.category === active)

  return (
    <>
      {/* Category filter tabs */}
      <div className="flex flex-wrap gap-2 mb-8 justify-center">
        <button
          onClick={() => setActive('all')}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            active === 'all'
              ? 'bg-hampton-navy text-white'
              : 'bg-white text-hampton-navy border border-hampton-pink/20 hover:bg-hampton-pink/10'
          }`}
        >
          All Events
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActive(cat)}
            className={`px-4 py-2 rounded-full text-sm font-medium capitalize transition-colors ${
              active === cat
                ? 'bg-hampton-navy text-white'
                : 'bg-white text-hampton-navy border border-hampton-pink/20 hover:bg-hampton-pink/10'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Event grid */}
      {filtered.length === 0 ? (
        <p className="text-center text-hampton-navy py-12">No events in this category right now. Check back soon!</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map(event => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </>
  )
}
