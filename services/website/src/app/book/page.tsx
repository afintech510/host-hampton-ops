import { Suspense } from 'react'
import Link from 'next/link'
import { Calendar } from 'lucide-react'
import BookingClient from './BookingClient'

/**
 * /book is a SERVER component whose only job is to put real, crawlable HTML
 * around the client booking form.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS FIXES. /book used to BE the client component: `'use client'`,
 * `useSearchParams()`, wrapped in one `<Suspense>`. During a static prerender a
 * client component that reads `useSearchParams()` bails out to its Suspense
 * FALLBACK, so the HTML Next.js shipped for the highest-intent page on the site
 * — sitemap priority 0.8, linked from the nav and footer of all 69 pages — was
 * literally this, measured live on 2026-09-12:
 *
 *     <main …><div …><p …>Loading...</p></div></main>
 *
 * Ten characters. No <h1>, no copy, no links. Google renders JavaScript on a
 * second pass and would eventually see the form, but the AI crawlers robots.ts
 * goes out of its way to welcome — GPTBot, ClaudeBot, PerplexityBot — do not
 * execute JavaScript at all, so to every one of them the booking page was blank.
 *
 * Splitting it costs nothing at runtime: the form below is byte-for-byte the
 * component that was there before, still client-side, still inside Suspense.
 * Only the heading and the copy moved out, to where a crawler can read them.
 */

const WHAT_YOU_CAN_BOOK = [
  {
    href: '/party-packages',
    name: 'Themed kids birthday parties',
    blurb: 'Glow, spa, slime, K-pop, Barbie and more at our private Speonk studio — hands-on hosts guide every child through every activity.',
  },
  {
    href: '/mobile-party',
    name: 'Mobile parties at your home',
    blurb: 'We pack the whole party and bring it to you, anywhere on Long Island and into New York City.',
  },
  {
    href: '/studio-rental',
    name: 'Studio rental',
    blurb: 'Rent the room itself for a baby shower, first birthday, communion or holiday party and run it your way.',
  },
  {
    href: '/events',
    name: 'Ticketed events and classes',
    blurb: 'Drop-off craft nights, bingo and seasonal workshops — book a seat rather than the whole room.',
  },
]

export default function BookPage() {
  return (
    <div className="min-h-screen">
      {/* ── Hero (server-rendered, so it is in the HTML a crawler receives) ── */}
      <section className="py-14 text-center px-4">
        <Calendar size={28} className="text-hampton-pink mx-auto mb-3" aria-hidden="true" />
        <h1 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-3">
          Book Your Celebration at Host Hampton
        </h1>
        <p className="text-hampton-navy/70 text-base max-w-lg mx-auto">
          Pick your experience, choose a date, and we&apos;ll handle the rest. Our
          studio is at 295 Montauk Highway in Speonk, NY, and we travel across
          Long Island and the Hamptons for mobile parties.
        </p>
      </section>

      {/* ── The interactive booking form. Unchanged. ── */}
      <Suspense
        fallback={
          <div className="min-h-[24rem] flex items-center justify-center">
            <p className="text-hampton-navy">Loading the booking calendar…</p>
          </div>
        }
      >
        <BookingClient />
      </Suspense>

      {/* ── Crawlable context + internal links to the other money pages. ── */}
      <section className="bg-hampton-pink/10 py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <h2 className="section-heading text-center mb-2">What you can book here</h2>
          <p className="text-center text-hampton-navy/70 text-sm mb-8 max-w-xl mx-auto">
            Every booking starts the same way — pick a date above and tell us what
            you have in mind. A $250 deposit reserves the date and is applied
            toward your total.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            {WHAT_YOU_CAN_BOOK.map(item => (
              <div key={item.href} className="bg-white rounded-2xl border border-hampton-pink/20 p-6">
                <h3 className="font-semibold text-hampton-navy text-base mb-2">
                  <Link href={item.href} className="hover:underline">{item.name}</Link>
                </h3>
                <p className="text-hampton-navy/80 text-sm leading-relaxed">{item.blurb}</p>
              </div>
            ))}
          </div>
          <p className="text-center text-hampton-navy/70 text-sm mt-8">
            Not sure yet? <Link href="/kids-party-menu" className="underline">Browse the full party menu and pricing</Link>{' '}
            or <Link href="/faq" className="underline">read the booking FAQ</Link>.
          </p>
        </div>
      </section>
    </div>
  )
}
