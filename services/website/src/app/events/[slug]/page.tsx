import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Calendar, Clock, MapPin, ArrowLeft } from 'lucide-react'
import { getSupabase } from '@/lib/supabase'
import TicketForm from './TicketForm'
import ImageGallery from './ImageGallery'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const supabase = getSupabase()
  const { data: event } = await supabase
    .from('events')
    .select('title, short_description')
    .eq('slug', params.slug)
    .single()

  if (!event) return { title: 'Event Not Found' }
  return {
    title: event.title,
    description: event.short_description || `Join us for ${event.title} at Host Hampton in Speonk, NY.`,
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default async function EventDetailPage({ params }: { params: { slug: string } }) {
  const supabase = getSupabase()

  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('slug', params.slug)
    .eq('is_active', true)
    .single()

  if (!event) notFound()

  let sessions: any[] = []
  if (event.has_sessions) {
    const { data } = await supabase
      .from('event_sessions')
      .select('*')
      .eq('event_id', event.id)
      .eq('is_active', true)
      .gte('session_date', new Date().toISOString().split('T')[0])
      .order('session_date', { ascending: true })
    sessions = data || []
  }

  const dateDisplay = event.event_date
    ? formatDate(event.event_date)
    : event.has_sessions
      ? 'Select a date below'
      : 'Date coming soon'

  return (
    <div className="min-h-screen">
      {/* Back link */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6">
        <Link href="/events" className="inline-flex items-center gap-1 text-hampton-navy hover:text-hampton-navy text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Events
        </Link>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Left: details */}
          <div className="lg:col-span-3">
            {/* Image(s) */}
            {(() => {
              const images: { url: string; name: string; is_primary: boolean }[] = event.images || []
              // Sort so primary is first
              const sorted = [...images].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
              if (sorted.length > 1) {
                return <ImageGallery images={sorted} title={event.title} />
              }
              const imgUrl = sorted[0]?.url || event.image_url
              if (imgUrl) {
                return (
                  <div className="rounded-2xl overflow-hidden mb-6 bg-white">
                    <img src={imgUrl} alt={event.title} className="w-full object-contain" />
                  </div>
                )
              }
              return (
                <div className="rounded-2xl overflow-hidden mb-6 h-48 bg-gradient-to-br from-hampton-blue/30 to-hampton-pink/30 flex items-center justify-center">
                  <Calendar className="w-16 h-16 text-hampton-navy/20" />
                </div>
              )
            })()}

            {/* Category badge */}
            <span className="inline-block bg-hampton-navy/10 text-hampton-navy px-3 py-1 rounded-full text-xs font-medium capitalize mb-3">
              {event.category}
            </span>

            <h1 className="font-serif text-3xl text-hampton-navy mb-4">{event.title}</h1>

            {/* Meta */}
            <div className="flex flex-wrap gap-4 text-sm text-hampton-navy mb-6">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4" />
                {dateDisplay}
              </span>
              {event.event_time && (
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  {event.event_time}{event.event_end_time ? ` – ${event.event_end_time}` : ''}
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4" />
                {event.location}
              </span>
            </div>

            {/* Description */}
            <div className="prose prose-sm max-w-none text-hampton-navy/90 leading-relaxed">
              {event.description?.split('\n').map((p: string, i: number) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </div>

          {/* Right: ticket purchase */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl border border-hampton-pink/20 p-6 sticky top-24">
              <TicketForm
                event={{
                  id: event.id,
                  slug: event.slug,
                  title: event.title,
                  price_cents: event.price_cents,
                  has_variants: event.has_variants,
                  variants: event.variants || [],
                  has_sessions: event.has_sessions,
                  available_tickets: event.available_tickets,
                  max_tickets: event.max_tickets,
                  allow_multi_session: event.allow_multi_session || false,
                  bundle_pricing: event.bundle_pricing || [],
                  imageUrl: (() => { const imgs = event.images || []; const p = imgs.find((i: any) => i.is_primary) || imgs[0]; return p?.url || event.image_url || null })(),
                  event_date: event.event_date,
                  event_time: event.event_time,
                }}
                sessions={sessions}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
