import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import {
  Check, ChevronDown, Phone, Wifi, PlugZap, Lock, Pizza, ClipboardList, Video,
  Trophy, Tv, Spade, CalendarCheck, MapPin, ArrowRight,
} from 'lucide-react'
import DraftPartyLeadForm from '@/components/DraftPartyLeadForm'
import { OG_DEFAULTS, SITE_URL, businessRef } from '@/lib/seo'
import {
  DRAFT_PARTY_SLUG, DRAFT_PACKAGES, DRAFT_NIGHTS, DRAFT_BLOCK_HOURS, DRAFT_MAX_GUESTS,
  DRAFT_DEPOSIT_CENTS, DRAFT_START_WINDOW, DRAFT_EXTRA_HOUR_CENTS, DRAFT_HAS_BIG_SCREEN,
  draftFaqs, draftUsd, perManager,
} from '@/lib/draftParty'

const PAGE_URL = `${SITE_URL}/${DRAFT_PARTY_SLUG}`
const [ROOM, PKG] = DRAFT_PACKAGES

export const metadata: Metadata = {
  title: 'Fantasy Draft Party Room — Long Island',
  description:
    `Private weeknight room for your fantasy football draft in Speonk, near Westhampton. WiFi and power for every laptop. From ${draftUsd(ROOM.priceCents)}, food optional.`,
  keywords: [
    'fantasy football draft party venue', 'fantasy draft party room', 'private room for fantasy football draft',
    'fantasy football draft venues near me', 'places to host fantasy football draft', 'fantasy draft Long Island',
    'fantasy draft party Hamptons', 'fantasy draft Westhampton', 'fantasy football draft package',
  ],
  alternates: { canonical: PAGE_URL },
  openGraph: {
    ...OG_DEFAULTS,
    title: 'Fantasy Football Draft Nights at Host Hampton',
    description: `Your league's private draft room in Speonk. ${DRAFT_NIGHTS}, ${DRAFT_BLOCK_HOURS} hours, room only or with Michelangelo's food.`,
    url: PAGE_URL,
  },
}

/** A made-up first two rounds for the hero board, snake order. Position colours match a real sticker board. */
type Pos = 'QB' | 'RB' | 'WR' | 'TE'
const BOARD: { team: string; picks: Pos[] }[] = [
  { team: 'Commish', picks: ['RB', 'WR'] },
  { team: 'Sully', picks: ['WR', 'RB'] },
  { team: 'Big Mike', picks: ['RB', 'TE'] },
  { team: 'Danny B', picks: ['WR', 'WR'] },
  { team: 'Last Place', picks: ['QB', 'RB'] },
  { team: 'Fitzy', picks: ['RB', 'WR'] },
]
/** "1.03" / "2.04" — round 2 runs backwards, as a snake does. */
function pickLabel(round: number, col: number): string {
  const slot = round % 2 === 1 ? col + 1 : BOARD.length - col
  return `${round}.${String(slot).padStart(2, '0')}`
}
const POS_CLASS: Record<string, string> = {
  QB: 'bg-[#b5524a] text-white',
  RB: 'bg-[#4f8a5b] text-white',
  WR: 'bg-[#4a73a8] text-white',
  TE: 'bg-[#c08a3e] text-white',
}

const HIGHLIGHTS = [
  { icon: Lock, title: 'Actually private', desc: 'A room with a door, not a reserved table in a loud bar. Only your league, and you can hear every pick.' },
  { icon: Wifi, title: 'WiFi that holds up', desc: 'Built for a dozen laptops on ESPN, Yahoo or Sleeper at once, plus a video call for anyone drafting from home.' },
  { icon: PlugZap, title: 'Power at the table', desc: 'Nobody dies at pick 9.04. There’s power at the draft table, so laptops and phones stay charged all night.' },
  { icon: ClipboardList, title: 'Paper board welcome', desc: 'Live board on the wall, stickers flying. The Draft Night Package brings the board for you.' },
  { icon: Pizza, title: 'Michelangelo’s next door', desc: 'Pizza, wings and heroes from the place in the same building. Food is on the table when you arrive.' },
  DRAFT_HAS_BIG_SCREEN
    ? { icon: Tv, title: 'Board on the big screen', desc: 'Plug in with HDMI and put the live draft room up where everyone can see it.' }
    : { icon: Tv, title: 'Bring the screen', desc: 'Bringing a TV or projector? We’ll set it at the head of the table with power ready.' },
]

const OTHER_NIGHTS = [
  { icon: Trophy, label: 'Championship & trophy night' },
  { icon: ClipboardList, label: 'Last-place punishment reveal' },
  { icon: Tv, label: 'Super Bowl party' },
  { icon: CalendarCheck, label: 'March Madness bracket night' },
  { icon: Spade, label: 'Poker night' },
  { icon: Video, label: 'Fantasy baseball draft' },
]

export default function FantasyDraftPartyPage() {
  const faqs = draftFaqs()

  const serviceSchema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    serviceType: 'Fantasy football draft party room rental',
    name: 'Fantasy Football Draft Nights — Host Hampton',
    description: metadata.description,
    provider: businessRef(),
    areaServed: [
      { '@type': 'City', name: 'Speonk, NY' },
      { '@type': 'AdministrativeArea', name: 'Suffolk County, NY' },
    ],
    url: PAGE_URL,
  }
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  }
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Fantasy Football Draft Nights', item: PAGE_URL },
    ],
  }

  return (
    <div className="bg-[#14181d]">
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet" />
      {[serviceSchema, faqSchema, breadcrumbSchema].map((s, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(s).replace(/</g, '\\u003c') }} />
      ))}

      {/* ── Hero ── */}
      <section className="relative overflow-hidden py-16 md:py-24">
        <div className="absolute inset-0 opacity-[0.06] bg-[repeating-linear-gradient(90deg,#fff_0,#fff_2px,transparent_2px,transparent_80px)]" aria-hidden />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 grid md:grid-cols-2 gap-12 items-center">
          <div className="text-center md:text-left">
            <p className="text-hampton-pink text-sm font-semibold tracking-widest uppercase mb-4">
              Fantasy Football Draft Nights · Speonk, Long Island
            </p>
            <h1 className="font-varsity text-6xl md:text-7xl lg:text-8xl text-white leading-[0.9] tracking-wide mb-6">
              Your League&apos;s<br /><span className="text-hampton-pink">Private Draft Room</span>
            </h1>
            <p className="text-white/75 text-lg leading-relaxed mb-6 max-w-lg mx-auto md:mx-0">
              A private room for your fantasy football draft, {DRAFT_NIGHTS} nights. Laptops or a live paper
              board, room only or with food from Michelangelo&apos;s next door. No bar noise, and nobody&apos;s
              basement to clean.
            </p>
            <div className="flex flex-wrap gap-2 justify-center md:justify-start mb-8">
              {[`${DRAFT_NIGHTS}`, `${DRAFT_BLOCK_HOURS}-hour block`, `Up to ${DRAFT_MAX_GUESTS} people`, `From ${draftUsd(ROOM.priceCents)}`].map(c => (
                <span key={c} className="border border-white/20 text-white/80 text-xs font-semibold px-3 py-1.5 rounded-full">{c}</span>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-3 justify-center md:justify-start">
              <a href="#book" className="bg-hampton-pink text-[#14181d] font-bold px-8 py-4 rounded-xl text-base uppercase tracking-wider hover:bg-white transition-colors">
                Lock In Your Draft Night
              </a>
              <a href="tel:6319989325" className="border-2 border-white/30 text-white font-semibold px-8 py-4 rounded-xl text-base inline-flex items-center justify-center gap-2 hover:border-hampton-pink transition-colors">
                <Phone size={16} /> (631) 998-9325
              </a>
            </div>
          </div>

          {/* Draft board — decorative, so hidden from assistive tech. */}
          <div aria-hidden className="bg-[#f4f1ea] rounded-2xl p-3 sm:p-4 shadow-2xl rotate-[-1.5deg] max-w-lg w-full mx-auto">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="font-varsity text-2xl text-[#14181d] tracking-wide">2027 Draft Board</span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#14181d]/50">Round 1–2</span>
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {BOARD.map((col, c) => (
                <div key={col.team} className="space-y-1.5">
                  <div className="bg-[#14181d] text-white text-[9px] sm:text-[10px] font-bold uppercase text-center rounded px-1 py-1.5 truncate">{col.team}</div>
                  {col.picks.map((pos, i) => (
                    <div key={i} className={`${POS_CLASS[pos]} rounded h-12 sm:h-14 flex flex-col items-center justify-center`}>
                      <span className="text-[9px] opacity-75">{pickLabel(i + 1, c)}</span>
                      <span className="font-varsity text-lg leading-none">{pos}</span>
                    </div>
                  ))}
                  <div className="border-2 border-dashed border-[#14181d]/20 rounded h-12 sm:h-14" />
                </div>
              ))}
            </div>
            <p className="text-center text-[11px] text-[#14181d]/50 mt-2">You&apos;re on the clock.</p>
          </div>
        </div>
      </section>

      {/* ── Packages ── */}
      <section className="bg-hampton-ivory py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <p className="section-subheading">Weeknight Draft Special</p>
            <h2 className="section-heading">Two Ways to Draft</h2>
            <p className="text-hampton-navy/70 max-w-xl mx-auto">
              {DRAFT_NIGHTS} nights, {DRAFT_BLOCK_HOURS} hours, starting between {DRAFT_START_WINDOW}. One flat price for the
              league. Split it however your league splits dues.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {DRAFT_PACKAGES.map(p => (
              <div key={p.id} className={`rounded-2xl p-7 flex flex-col ${p.id === 'package' ? 'bg-[#14181d] text-white ring-2 ring-hampton-pink' : 'bg-white border border-hampton-navy/10'}`}>
                {p.id === 'package' && (
                  <span className="self-start bg-hampton-pink text-[#14181d] text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full mb-3">Most leagues pick this</span>
                )}
                <h3 className="font-varsity text-4xl tracking-wide">{p.name}</h3>
                <p className={`text-sm mb-5 ${p.id === 'package' ? 'text-white/60' : 'text-hampton-navy/60'}`}>{p.tagline}</p>
                <p className="mb-1">
                  <span className="text-5xl font-bold">{draftUsd(p.priceCents)}</span>
                  <span className={`text-sm ml-2 ${p.id === 'package' ? 'text-white/60' : 'text-hampton-navy/60'}`}>
                    {p.extraGuestCents ? `for ${p.includesGuests} · +${draftUsd(p.extraGuestCents)} each extra` : `flat · up to ${DRAFT_MAX_GUESTS}`}
                  </span>
                </p>
                <p className={`text-sm font-semibold mb-6 ${p.id === 'package' ? 'text-hampton-pink' : 'text-hampton-navy'}`}>
                  About {perManager(p, 12)} a manager in a 12-team league
                </p>
                <ul className="space-y-2.5 mb-8 flex-1">
                  {p.includes.map(i => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      <Check size={16} className={`shrink-0 mt-0.5 ${p.id === 'package' ? 'text-hampton-pink' : 'text-hampton-navy'}`} />
                      <span>{i}</span>
                    </li>
                  ))}
                </ul>
                <a href="#book" className={`text-center font-bold px-6 py-3.5 rounded-xl text-sm uppercase tracking-wider transition-colors ${p.id === 'package' ? 'bg-hampton-pink text-[#14181d] hover:bg-white' : 'bg-[#14181d] text-white hover:bg-black'}`}>
                  Request {p.name}
                </a>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-hampton-navy/60 mt-6 max-w-2xl mx-auto leading-relaxed">
            {draftUsd(DRAFT_DEPOSIT_CENTS)} deposit holds your night and comes off the total. Extra hours {draftUsd(DRAFT_EXTRA_HOUR_CENTS)} each.
            Sales tax applies. Friday or the weekend? Those book at our standard{' '}
            <Link href="/party-room-rental" className="underline underline-offset-2">room rental rates</Link>.
          </p>
        </div>
      </section>

      {/* ── Built for draft night ── */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <p className="text-hampton-pink text-sm font-semibold tracking-widest uppercase mb-2">Better Than the Loser&apos;s Basement</p>
            <h2 className="font-varsity text-5xl md:text-6xl text-white tracking-wide">Built for Draft Night</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {HIGHLIGHTS.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="bg-white/[0.04] border border-white/10 rounded-2xl p-6">
                <Icon size={26} className="text-hampton-pink mb-3" />
                <h3 className="text-white font-semibold text-lg mb-1.5">{title}</h3>
                <p className="text-white/65 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="pb-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="grid md:grid-cols-3 gap-5">
            {[
              { n: '1', t: 'Pick your night', d: `Send your date and league size. We confirm the room within 24 hours.` },
              { n: '2', t: 'Hold it', d: `A ${draftUsd(DRAFT_DEPOSIT_CENTS)} deposit locks the night. Moving your date is free when another night is open.` },
              { n: '3', t: 'Draft', d: 'Walk in to a set table, WiFi on and food out. We clean up after you.' },
            ].map(s => (
              <div key={s.n} className="flex gap-4 items-start">
                <span className="font-varsity text-6xl text-hampton-pink leading-none">{s.n}</span>
                <div>
                  <h3 className="text-white font-semibold text-lg">{s.t}</h3>
                  <p className="text-white/65 text-sm leading-relaxed">{s.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Where (plain-language answer for "where can I host my draft…") ── */}
      <section className="bg-hampton-ivory py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 grid md:grid-cols-[1fr_280px] gap-10 items-center">
          <div>
            <h2 className="section-heading">Where to Host a Fantasy Football Draft on the East End</h2>
            <p className="text-hampton-navy/80 leading-relaxed mb-4">
              Most leagues end up at a bar where they can&apos;t hear the picks, or in somebody&apos;s basement. Host
              Hampton is a private studio at 295 Montauk Highway in Speonk, between Westhampton and Eastport. It
              takes about 10 minutes from Center Moriches and Eastport, and 15 to 20 from Riverhead, Hampton Bays,
              Southampton and Manorville. The lot is out front, and Michelangelo of Speonk is in the same building.
            </p>
            <p className="text-hampton-navy/80 leading-relaxed">
              It&apos;s set up for a draft: one long table for up to {DRAFT_MAX_GUESTS} managers, WiFi for every
              laptop, wall space for a live board, and {DRAFT_BLOCK_HOURS} hours so nobody has to rush the last
              rounds. On a Saturday this room hosts kids&apos; birthday parties. On a Tuesday in August it&apos;s
              your league&apos;s war room.
            </p>
          </div>
          <div className="relative aspect-[3/4] rounded-2xl overflow-hidden shadow-lg">
            <Image src="/images/gallery/gallery-studio-exterior.webp" alt="Host Hampton studio at 295 Montauk Highway, Speonk" fill sizes="280px" className="object-cover" />
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-3 text-white text-xs flex items-center gap-1.5">
              <MapPin size={12} /> 295 Montauk Hwy, Suite 7, Speonk
            </div>
          </div>
        </div>
      </section>

      {/* ── Form ── */}
      <section id="book" className="py-20 scroll-mt-20">
        <div className="max-w-2xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-8">
            <h2 className="font-varsity text-5xl md:text-6xl text-white tracking-wide">Lock In Your Draft Night</h2>
            <p className="text-white/70">Tell us the night and the league size. We&apos;ll confirm within 24 hours.</p>
          </div>
          <DraftPartyLeadForm />
        </div>
      </section>

      {/* ── Same room, other nights ── */}
      <section className="pb-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <p className="text-hampton-pink text-sm font-semibold tracking-widest uppercase mb-2">After the Draft</p>
          <h2 className="font-varsity text-4xl md:text-5xl text-white tracking-wide mb-8">Same Room, Every League Night</h2>
          <div className="flex flex-wrap justify-center gap-3">
            {OTHER_NIGHTS.map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-2 border border-white/15 rounded-full px-4 py-2 text-sm text-white/80">
                <Icon size={15} className="text-hampton-pink" /> {label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="bg-hampton-ivory py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="section-heading text-center mb-10">Fantasy Draft Night FAQ</h2>
          <div className="space-y-3">
            {faqs.map(f => (
              <details key={f.q} className="group rounded-xl border border-hampton-navy/10 bg-white open:shadow-sm transition-all">
                <summary className="flex items-center justify-between gap-4 p-5 cursor-pointer list-none font-semibold text-hampton-navy text-sm">
                  {f.q}
                  <ChevronDown size={16} className="shrink-0 text-hampton-navy/40 group-open:rotate-180 transition-transform" />
                </summary>
                <p className="px-5 pb-5 text-hampton-navy/70 text-sm leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-16 text-center px-4">
        <h2 className="font-varsity text-5xl md:text-6xl text-white tracking-wide mb-3">The Clock Is Running</h2>
        <p className="text-white/70 mb-8 max-w-md mx-auto">
          Late-August weeknights go first. Grab yours before the rest of the league picks it for you.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a href="#book" className="bg-hampton-pink text-[#14181d] font-bold px-10 py-4 rounded-xl uppercase tracking-wider hover:bg-white transition-colors inline-flex items-center justify-center gap-2">
            Request a Night <ArrowRight size={16} />
          </a>
          <a href="tel:6319989325" className="border-2 border-white/30 text-white font-semibold px-10 py-4 rounded-xl hover:border-hampton-pink transition-colors">
            Call (631) 998-9325
          </a>
        </div>
      </section>
    </div>
  )
}
