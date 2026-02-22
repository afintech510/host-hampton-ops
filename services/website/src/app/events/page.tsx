import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import { Calendar, Clock } from 'lucide-react'
import EventFilters from './EventFilters'

export const metadata: Metadata = {
  title: 'Events & Workshops | Host Hampton',
  description: 'Workshops, classes, and community events at Host Hampton in Speonk, NY. Embroidery, sourdough, spirit readings, and more.',
}

export const dynamic = 'force-dynamic'

export default async function EventsPage() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

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
    <div className="bg-hampton-ivory">
      <section className="bg-hampton-navy py-16 text-center px-4">
        <h1 className="font-serif text-4xl text-white mb-4">Events & Workshops</h1>
        <p className="text-hampton-blue/80 text-lg max-w-xl mx-auto">
          Workshops, classes, and community gatherings at Host Hampton. Find your next experience below.
        </p>
      </section>

      <section className="py-12 max-w-6xl mx-auto px-4 sm:px-6">
        <EventFilters events={allEvents} categories={categories} />
      </section>

      <section className="bg-hampton-pink/10 py-14 text-center px-4">
        <h2 className="section-heading mb-3">Want to Host a Workshop?</h2>
        <p className="text-hampton-mauve mb-7 max-w-md mx-auto">
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
}
