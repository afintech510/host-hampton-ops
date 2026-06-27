import type { Metadata } from 'next'
import Link from 'next/link'
import { Calendar, Clock } from 'lucide-react'
import { getSupabase } from '@/lib/supabase'
import EventFilters from './EventFilters'
import SpecialEventBanner from '@/components/SpecialEventBanner'

export const metadata: Metadata = {
  title: 'Events & Workshops | Host Hampton',
  description: 'Workshops, classes, and community events at Host Hampton in Remsenburg-Speonk, NY. Embroidery, sourdough, spirit readings, and more.',
  openGraph: {
    title: 'Host Hampton Events',
    description: 'Workshops, classes, and community events in Remsenburg-Speonk, NY.',
    url: 'https://www.hosthampton.com/events',
    siteName: 'Host Hampton',
    images: [
      {
        url: 'https://www.hosthampton.com/og/events-og.jpg',
        width: 1200,
        height: 630,
        alt: 'Host Hampton Events — Remsenburg-Speonk, NY',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Host Hampton Events',
    description: 'Workshops, classes, and community events in Remsenburg-Speonk, NY.',
    images: ['https://www.hosthampton.com/og/events-og.jpg'],
  },
}

export const dynamic = 'force-dynamic'

export default async function EventsPage() {
  const supabase = getSupabase()

  const { data: events } = await supabase
    .from('events')
    .select('*')
    .eq('is_active', true)
    .order('is_featured', { ascending: false })
    .order('event_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  const allEvents = (events || []) as EventRow[]
  const categories = Array.from(new Set(allEvents.map(e => e.category)))

  return (
    <div>
      <section className="py-16 pb-6 text-center px-4">
        <h1 className="font-serif text-4xl text-hampton-navy mb-4">Events & Workshops</h1>
        <p className="text-hampton-navy text-lg max-w-xl mx-auto">
          Workshops, classes, and community gatherings at Host Hampton. Find your next experience below.
        </p>
      </section>

      <SpecialEventBanner />

      <section className="py-12 max-w-6xl mx-auto px-4 sm:px-6">
        <EventFilters events={allEvents} categories={categories} />
      </section>

      <section className="bg-hampton-pink/10 py-14 text-center px-4">
        <h2 className="section-heading mb-3">Want to Host a Workshop?</h2>
        <p className="text-hampton-navy mb-7 max-w-md mx-auto">
          We partner with local instructors, brands, and organizations. Get in touch to discuss hosting your workshop at Host Hampton.
        </p>
        <Link href="/contact-us" className="btn-primary px-8 py-4">Contact Us</Link>
      </section>
    </div>
  )
}

export interface EventRow {
  id: string
  slug: string
  title: string
  short_description: string | null
  description: string | null
  category: string
  price_cents: number
  has_variants: boolean
  variants: { label: string; priceCents: number }[]
  event_date: string | null
  event_time: string | null
  max_tickets: number
  available_tickets: number
  has_sessions: boolean
  is_featured: boolean
  image_url: string | null
  images: { url: string; name: string; is_primary: boolean }[]
}
