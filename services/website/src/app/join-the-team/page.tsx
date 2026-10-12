import type { Metadata } from 'next'
import { OG_DEFAULTS, SITE_URL, ORGANIZATION_ID } from '@/lib/seo'
import { ROLES, payLabel, JOB_DATE_POSTED, JOB_VALID_THROUGH, type RoleKey } from '@/lib/careers'
import { STUDIO_STREET, STUDIO_TOWN, STUDIO_REGION, STUDIO_POSTAL_CODE } from '@/lib/studioLocation'
import JoinTheTeamForm from './JoinTheTeamForm'

/**
 * /join-the-team — the careers page the Indeed and social ads point at.
 *
 * Spec: docs/careers-page-plan.md (Adam's decisions, 2026-10-11). The role copy
 * matches the ads: kids mostly 5–9; arts & crafts, hair tinsel, braiding and nail
 * painting, which we train; the studio in Speonk plus at-home parties across the
 * East End; 18+. Copy rules from the plan: no age-coded "perfect for students"
 * language (NY Human Rights Law covers 18+), pay is always stated (NY pay
 * transparency), and no luxury / exclusivity words.
 *
 * `/careers` is a permanent redirect to here, declared in next.config.js — a
 * stub page that calls redirect() sends no Location header.
 */

const PAGE_URL = `${SITE_URL}/join-the-team`

export const metadata: Metadata = {
  title: 'Party Jobs in Speonk — Join the Team',
  description:
    "Now hiring Party Leads ($25/hr + tips) and Party Helpers ($17/hr + tips) for kids' parties in Speonk and across the East End. Weekends, 18+.",
  alternates: { canonical: PAGE_URL },
  openGraph: {
    ...OG_DEFAULTS,
    title: 'Join the Host Hampton Team',
    description: "Party Leads $25/hr + tips · Party Helpers $17/hr + tips. Kids' parties in Speonk and across the East End.",
    url: PAGE_URL,
  },
}

interface RoleCopy {
  key: RoleKey
  heading: string
  intro: string
  bullets: string[]
}

const ROLE_COPY: RoleCopy[] = [
  {
    key: 'lead',
    heading: 'Party Lead',
    intro:
      "You're the face of the party: welcoming families, keeping parents relaxed, running the flow of the event and leading a small team of helpers. You run the room — and you're hands-on when it counts, from arts and crafts to hair tinsel, braids and nails.",
    bullets: [
      'Poise and presence — you can read a room and keep a busy parent smiling',
      'Hospitality, events, retail or team-lead experience',
      'An eye for design: decorating, setup, making a room look finished',
      'Bonus: balloon arch / garland experience',
      'Regular weekend availability (some weekday events too)',
    ],
  },
  {
    key: 'helper',
    heading: 'Party Helper',
    intro:
      "You're hands-on with the kids (mostly ages 5–9): leading arts and crafts, doing hair tinsel, braids and nail painting, keeping the energy up, and helping with setup and cleanup so every birthday feels special.",
    bullets: [
      "Never done tinsel or braids? We'll teach you — but you'll need to learn them, because every party has them",
      'Childcare, babysitting or camp experience is a plus',
      'A great attitude matters most',
      'Part-time weekends, flexible hours that fit around school or another job',
    ],
  },
]

/** Plain-text description for structured data, built from the same copy. */
function jobDescriptionHtml(c: RoleCopy): string {
  return `<p>${c.intro}</p><ul>${c.bullets.map(b => `<li>${b}</li>`).join('')}</ul><p>${payLabel(c.key)}. Must be 18+. Parties at our studio in Speonk and at families' homes across the East End.</p>`
}

function jobPosting(c: RoleCopy) {
  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: c.key === 'lead' ? "Party Lead — Kids' Parties & Events" : "Weekend Party Helper — Kids' Birthday Parties",
    description: jobDescriptionHtml(c),
    datePosted: JOB_DATE_POSTED,
    validThrough: JOB_VALID_THROUGH,
    employmentType: 'PART_TIME',
    directApply: true,
    url: `${PAGE_URL}#apply`,
    hiringOrganization: {
      '@type': 'Organization',
      '@id': ORGANIZATION_ID,
      name: 'Host Hampton',
      sameAs: SITE_URL,
      logo: `${SITE_URL}/images/host-hampton-logo.png`,
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        streetAddress: STUDIO_STREET,
        addressLocality: STUDIO_TOWN,
        addressRegion: STUDIO_REGION,
        postalCode: STUDIO_POSTAL_CODE,
        addressCountry: 'US',
      },
    },
    baseSalary: {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: { '@type': 'QuantitativeValue', value: ROLES[c.key].payPerHour, unitText: 'HOUR' },
    },
  }
}

const DETAILS: Array<[string, string]> = [
  ['When', 'Mostly Saturdays and Sundays, often two parties a day. Some weekday events too.'],
  ['Where', "Our studio in Speonk, plus parties at families' homes across the East End."],
  ['Who', "Kids' birthday parties — mostly ages 5–9 — and the parents who throw them."],
  ['Training', 'Hair tinsel, braiding and nail painting: we teach you. Every party has them.'],
]

export default function JoinTheTeamPage() {
  return (
    <main className="min-h-screen bg-[#F6F1EB]">
      {ROLE_COPY.map(c => (
        <script
          key={c.key}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jobPosting(c)) }}
        />
      ))}

      {/* ── Hero ── */}
      <section className="bg-gradient-to-b from-[#BCCDEB] via-[#dae6f0] to-[#F7F2E8] px-5 pt-28 pb-16 text-center">
        <p className="text-hampton-navy/60 text-xs tracking-[2px] uppercase mb-3">
          Host Hampton &middot; Speonk, NY
        </p>
        <h1 className="text-hampton-navy font-serif text-4xl sm:text-5xl leading-tight mb-4">
          Join the Team
        </h1>
        <p className="text-hampton-navy/75 text-lg mb-2 max-w-xl mx-auto">
          We&rsquo;re hiring Party Leads and Party Helpers for our themed kids&rsquo; parties.
        </p>
        <p className="text-hampton-navy/60 text-base mb-8">
          Party Lead {payLabel('lead')} &middot; Party Helper {payLabel('helper')} &middot; 18+
        </p>
        <a
          href="#apply"
          className="inline-block bg-hampton-navy text-[#F6F1EB] font-bold text-base px-10 py-4 rounded-full hover:opacity-90 transition-opacity"
        >
          Apply now
        </a>
        <p className="text-hampton-navy/50 text-xs mt-3">One short form. About five minutes.</p>
      </section>

      <div className="max-w-3xl mx-auto px-5 pb-20">
        {/* ── The roles ── */}
        <div className="grid gap-5 -mt-4 mb-12">
          {ROLE_COPY.map(c => (
            <section key={c.key} className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                <h2 className="text-hampton-navy font-serif text-2xl">{c.heading}</h2>
                <p className="text-hampton-navy font-bold text-lg">{payLabel(c.key)}</p>
              </div>
              <p className="text-hampton-navy/80 text-base leading-relaxed mb-4">{c.intro}</p>
              <ul className="space-y-2">
                {c.bullets.map(b => (
                  <li key={b} className="flex gap-2 text-hampton-navy/75 text-sm leading-relaxed">
                    <span className="text-hampton-pink shrink-0" aria-hidden="true">&#9679;</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* ── Details ── */}
        <div className="grid sm:grid-cols-2 gap-4 mb-12">
          {DETAILS.map(([label, value]) => (
            <div key={label} className="bg-white rounded-2xl p-6 shadow-sm">
              <p className="text-hampton-navy/50 text-xs tracking-wider uppercase mb-2">{label}</p>
              <p className="text-hampton-navy text-base leading-relaxed">{value}</p>
            </div>
          ))}
        </div>

        {/* ── The form ── */}
        <section id="apply" className="scroll-mt-24">
          <h2 className="text-hampton-navy font-serif text-3xl mb-2 text-center">Apply</h2>
          <p className="text-hampton-navy/60 text-sm text-center mb-8">
            Both roles are 18+. We read every application ourselves.
          </p>
          <JoinTheTeamForm />
        </section>
      </div>
    </main>
  )
}
