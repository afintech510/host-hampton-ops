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
import {
  resolveAppointmentEvent,
  isEventClosed,
  slotTimes,
  closingLabel,
} from '@/lib/appointmentEvents'
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

  const times = slotTimes(cfg)

  return (
    /**
     * ── NO BACKGROUND ON THIS ELEMENT, AND NO GRADIENT BELOW. THAT IS THE FIX. ──
     *
     * The site-wide fade already exists, on `body` in globals.css:
     *
     *     linear-gradient(to bottom, #BCCDEB 0%, #dae6f0 300px, #F7F2E8 600px)
     *
     * That is why the homepage is seamless — it is ONE gradient over the first
     * 600px of the document, so there is no element boundary for a seam to form
     * at. This page had `bg-hampton-ivory` here, which is opaque #F7F2E8 and
     * painted straight over it; that is why it opened flat.
     *
     * The first fix was to re-create the fade on the hero section. It matched in
     * colour and still showed a LINE, because a ~250px gradient butting onto a
     * flat fill changes slope abruptly at the join, and the eye reads that
     * discontinuity as an edge even when the two colours are identical. Adam
     * spotted it against the homepage.
     *
     * So: paint nothing, and let the body gradient through. Nothing to match,
     * nothing to keep in sync, and no seam is possible. `#F7F2E8` is also
     * `body`'s `background-color`, so everything below 600px is unchanged.
     */
    <main className="min-h-screen pb-16">
      {/* The event's name, date, hours and address are rendered HERE, on the
          server, rather than inside the client form — this is the one page whose
          <h1> a crawler should not have to hydrate to see. */}
      <section className="px-5 pt-12 pb-14 text-center">
        <p className="text-hampton-navy/60 text-xs tracking-[2px] uppercase mb-3">
          Host Hampton &middot; By appointment
        </p>
        <h1 className="text-hampton-navy font-serif text-4xl sm:text-5xl leading-tight mb-4">
          {cfg.name}
        </h1>
        <p className="text-hampton-navy/80 text-base mb-1">
          {cfg.dateLabel} &middot; {times[0]} &ndash; {closingLabel(cfg)}
        </p>
        <p className="text-hampton-navy/60 text-sm">{cfg.locationLine}</p>
      </section>

      <Suspense
        fallback={
          <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-6">
            <div className="rounded-2xl border-2 border-[#1e3a5f]/20 bg-white shadow-md p-8 text-center">
              <p className="text-sm text-hampton-navy/70">Loading available times&hellip;</p>
            </div>
          </section>
        }
      >
        <AppointmentForm cfg={cfg} closed={closed} />
      </Suspense>
    </main>
  )
}
