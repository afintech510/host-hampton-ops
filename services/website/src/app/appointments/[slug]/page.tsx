/**
 * The shareable page for one appointment event — /appointments/halloween-hair-2026.
 *
 * A SERVER page whose form is a client child. `AppointmentForm` calls
 * `useSearchParams()` (it reads the `?booked=` / `?cancelled=` Stripe return),
 * and a page that does that prerenders as its Suspense FALLBACK — so the whole
 * page would ship to a crawler as a spinner. The copy, the title and the
 * OpenGraph card are rendered up here where a bot can see them.
 *
 * An unknown slug is `notFound()`, not a guess. A closed event renders a closed
 * state rather than a form that will 410 the moment somebody presses it.
 */

import type { Metadata } from 'next'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { resolveAppointmentEvent, isEventClosed } from '@/lib/appointmentEvents'
import { OG_DEFAULTS } from '@/lib/seo'
import AppointmentForm from './AppointmentForm'

/**
 * Dynamic, and NOT prerendered.
 *
 * There was a `generateStaticParams()` here and it won: the build output showed
 * this route as ● (SSG) with all three slugs baked, which means `isEventClosed`
 * — a question about the clock — would have been answered once at build time
 * and frozen. The page would go on offering a booking form for a day that had
 * already been and gone until somebody redeployed. `closesAt` is only
 * self-executing if something reads it after the build.
 */
export const dynamic = 'force-dynamic'

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const cfg = resolveAppointmentEvent(params.slug)
  if (!cfg) return { title: 'Appointment' }

  const description =
    `${cfg.name} at Host Hampton — ${cfg.dateLabel}. By appointment only, book your slot online. ${cfg.locationLine}`

  return {
    title: `${cfg.name} — ${cfg.dateLabel}`,
    description,
    alternates: { canonical: `/appointments/${cfg.slug}` },
    openGraph: {
      // OG_DEFAULTS FIRST, then the overrides. Next merges `metadata` SHALLOWLY,
      // so a page-level `openGraph` block REPLACES the root one whole — without
      // this spread the share card loses its image and every link to this page
      // unfurls bare.
      ...OG_DEFAULTS,
      title: `${cfg.name} at Host Hampton`,
      description,
      url: `/appointments/${cfg.slug}`,
      type: 'website',
    },
  }
}

export default function AppointmentEventPage({ params }: { params: { slug: string } }) {
  const cfg = resolveAppointmentEvent(params.slug)
  if (!cfg) notFound()

  // Computed on the server so the closed state is in the HTML a crawler and a
  // link preview both read, rather than appearing after hydration.
  const closed = isEventClosed(cfg)

  return (
    <main className="min-h-screen bg-hampton-ivory pb-16">
      <Suspense
        fallback={
          <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-6">
            <div className="rounded-2xl border-2 border-[#1e3a5f]/20 bg-white shadow-md p-8">
              <h1 className="font-serif text-3xl text-hampton-navy mb-2">{cfg.name}</h1>
              <p className="text-sm text-hampton-navy/70">{cfg.dateLabel} · {cfg.locationLine}</p>
            </div>
          </section>
        }
      >
        <AppointmentForm cfg={cfg} closed={closed} />
      </Suspense>
    </main>
  )
}
