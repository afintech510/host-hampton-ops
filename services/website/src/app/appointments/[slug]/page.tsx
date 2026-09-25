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
    <main className="min-h-screen bg-hampton-ivory pb-16">
      {/**
       * ── The hero, and why the blue FADES ──
       *
       * This page used to open on flat ivory with a hard 6px accent rule across
       * the top of the booking card, which read as an edge rather than a header
       * — it did not look like the rest of the site. `/christmas-market` and the
       * homepage both fade #BCCDEB down through #dae6f0 into the page's own
       * #F7F2E8, so the blue dissolves into the content instead of stopping at a
       * line. Same gradient here, so an appointment page is recognisably a Host
       * Hampton page.
       *
       * The event's name, date, hours and address live UP HERE, on the server,
       * rather than inside the client form. Two reasons: the fade needs content
       * in it or it is just a stripe, and this is the one page whose <h1> a
       * crawler should not have to hydrate to see.
       */}
      <section className="bg-gradient-to-b from-[#BCCDEB] via-[#dae6f0] to-[#F7F2E8] px-5 pt-12 pb-14 text-center">
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
