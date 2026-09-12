import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { OG_DEFAULTS } from '@/lib/seo'

export const metadata: Metadata = {
  title: 'Party FAQ — Booking & Pricing',
  description:
    'Deposits, pricing, guest counts, food and cake, mobile at-home parties and how to book a party at Host Hampton in Speonk, NY.',
  keywords: [
    'party venue FAQ Long Island',
    'birthday party questions Speonk',
    'blank canvas party venue Hamptons',
    'mobile party FAQ',
    'baby shower venue Long Island',
    'party deposit booking',
  ],
  openGraph: {
    ...OG_DEFAULTS,
    title: 'Host Hampton — Party FAQ',
    description:
      'Deposits, pricing, guest counts, food & cake, mobile parties, travel area, and how to book. Everything people ask before booking a party at Host Hampton.',
    url: 'https://www.hosthampton.com/faq',
    siteName: 'Host Hampton',
    locale: 'en_US',
    type: 'website',
  },
}

interface FaqItem {
  category: string
  q: string
  a: string
}

// Answers are drawn from documented Host Hampton facts (pricing, deposit rate,
// mobile travel radius, hours, location). Keep them accurate — this page is the
// primary source AI answer engines quote when people ask about the venue.
const faqs: FaqItem[] = [
  // ── Booking & Deposits ──
  {
    category: 'Booking & Deposits',
    q: 'How do I book a party at Host Hampton?',
    a: 'You can reserve online any time — build your party and pick a date at hosthampton.com/book, or start with our party builder. Prefer to talk it through first? Call or text us at (631) 998-9325 and we\'ll help you plan every detail.',
  },
  {
    category: 'Booking & Deposits',
    q: 'How much is the deposit to reserve a date?',
    a: 'A $250 deposit reserves your date and is applied toward your total. The remaining balance can be paid any time before your party. Half the deposit ($125) is non-refundable if you cancel more than 30 days out; within 30 days the full deposit is non-refundable. Changing your date is always free, subject to availability. A 3% processing fee applies to card payments; you can also pay by other methods to avoid it.',
  },
  {
    category: 'Booking & Deposits',
    q: 'How far in advance should I book?',
    a: 'We recommend booking 2–4 weeks in advance, especially for weekend dates, which fill up fastest. If your date is sooner, reach out anyway — we\'ll do our best to make it work.',
  },
  {
    category: 'Booking & Deposits',
    q: 'Can I customize my party package?',
    a: 'Yes — every party is fully customizable. Pick your theme, activities, food, decor, and add-ons, and we\'ll tailor the package to your guest count and budget.',
  },

  // ── The Studio & Mobile Parties ──
  {
    category: 'The Studio & Mobile Parties',
    q: 'What is Host Hampton?',
    a: 'Host Hampton is a private, boutique celebration studio in Speonk, NY. We host upscale themed birthday parties, baby and bridal showers, communions, first birthdays, workshops, and events — a clean, blank-canvas space with hands-on party hosts so you can relax and enjoy.',
  },
  {
    category: 'The Studio & Mobile Parties',
    q: 'Do you host at your studio, or can you come to us?',
    a: 'Both! You can celebrate at our Speonk studio, or book a Mobile Party and we\'ll bring the whole experience — activities, decor, supplies, and a dedicated host — to your home, backyard, park, or venue.',
  },
  {
    category: 'The Studio & Mobile Parties',
    q: 'How far will you travel for a mobile party?',
    a: 'We travel throughout the Hamptons and all of Long Island — we have run parties and events everywhere from Manhattan to Montauk. Travel is free within 20 miles of our Speonk studio; beyond that a modest mileage charge covers the drive. We never add a mandatory gratuity — what we quote is what you pay.',
  },
  {
    category: 'The Studio & Mobile Parties',
    q: 'How much space do I need for a mobile party at my home?',
    a: 'A living room, garage, backyard, or patio usually works great. Plan for roughly 200–300 sq ft per activity station, and we\'ll help you map out the best layout during planning.',
  },
  {
    category: 'The Studio & Mobile Parties',
    q: 'What happens if it rains for an outdoor mobile party?',
    a: 'We always have a backup plan. For outdoor parties we can move activities inside or set up under cover, and we\'ll coordinate the details with you ahead of time.',
  },

  // ── Food, Cake & Decor ──
  {
    category: 'Food, Cake & Decor',
    q: 'Can I bring my own food and cake?',
    a: 'Yes — you\'re welcome to bring your own cake and food, which is why our blank-canvas space is so popular for showers and birthdays. Prefer us to handle it? We also offer food, dessert, and beverage add-ons on our party menu.',
  },
  {
    category: 'Food, Cake & Decor',
    q: 'Do you provide decorations?',
    a: 'Yes. Themed decor is part of the experience — we set up and, for parties at the studio or mobile parties, we pack everything up afterward so there\'s zero cleanup for you.',
  },

  // ── Pricing ──
  {
    category: 'Pricing',
    q: 'How much does a party cost?',
    a: 'Party packages start at $800 and are fully customizable based on your theme, guest count, activities, and add-ons. Tell us what you have in mind and we\'ll build a quote — usually within 24 hours.',
  },
  {
    category: 'Pricing',
    q: 'How much is a first birthday party?',
    a: 'Our first birthday package starts at $850 for up to 10 guests, and can be scaled up for larger celebrations.',
  },
  {
    category: 'Pricing',
    q: 'How much is permanent jewelry?',
    a: 'Permanent jewelry starts at $65, depending on the chain and any charms you choose. It\'s a popular add-on for parties and a fun walk-in or event activity.',
  },

  // ── Location & Hours ──
  {
    category: 'Location & Hours',
    q: 'Where is Host Hampton located?',
    a: 'We\'re at 295 Montauk Hwy, Suite 7, Speonk, NY 11972 — on the East End of Long Island, convenient to the Hamptons, Westhampton, Southampton, and the surrounding towns.',
  },
  {
    category: 'Location & Hours',
    q: 'What are your hours?',
    a: 'Saturday and Sunday, 10:00 AM–8:00 PM; Monday through Friday, 12:00 PM–7:00 PM. Parties and private bookings can often be arranged outside these hours — just ask.',
  },
  {
    category: 'Location & Hours',
    q: 'What areas do you serve?',
    a: 'We serve the Hamptons, Long Island, and the East End — including Speonk, Westhampton, Southampton, and surrounding communities — both at our studio and through mobile parties.',
  },
]

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map(f => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
}

// Group questions by category, preserving first-seen order.
const categories = faqs.reduce<string[]>((acc, f) => {
  if (!acc.includes(f.category)) acc.push(f.category)
  return acc
}, [])

export default function FaqPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      {/* Hero */}
      <section className="py-16 md:py-20 text-center px-4">
        <p className="section-subheading">Questions? We&apos;ve Got Answers</p>
        <h1 className="font-serif text-4xl md:text-5xl text-hampton-navy mb-5 max-w-3xl mx-auto leading-tight">
          Party FAQ
        </h1>
        <p className="text-hampton-navy/80 text-lg max-w-2xl mx-auto">
          Everything people ask before booking a party at Host Hampton — deposits, pricing, guests, food, mobile parties, and how to reserve your date.
        </p>
      </section>

      {/* FAQ groups */}
      <section className="pb-16 max-w-3xl mx-auto px-4 sm:px-6">
        {categories.map(cat => (
          <div key={cat} className="mb-10">
            <h2 className="section-heading text-2xl mb-5">{cat}</h2>
            <div className="space-y-3">
              {faqs
                .filter(f => f.category === cat)
                .map(faq => (
                  <details
                    key={faq.q}
                    className="group rounded-xl border border-hampton-pink/20 bg-white open:border-[#c4975a]/40 transition-all"
                  >
                    <summary className="flex items-center justify-between gap-4 p-5 cursor-pointer list-none font-semibold text-hampton-navy text-base">
                      {faq.q}
                      <ChevronDown size={16} className="shrink-0 text-hampton-navy/40 group-open:rotate-180 transition-transform" />
                    </summary>
                    <p className="px-5 pb-5 text-hampton-navy/70 text-sm leading-relaxed">{faq.a}</p>
                  </details>
                ))}
            </div>
          </div>
        ))}
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-r from-hampton-pink to-hampton-mauve py-16">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-4">
            Still Have a Question?
          </h2>
          <p className="text-hampton-navy/70 text-base mb-8">
            We&apos;re happy to help you plan. Reach out and we&apos;ll get right back to you.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/book"
              className="bg-hampton-navy text-hampton-ivory font-bold px-10 py-4 rounded-full text-base hover:bg-opacity-90 transition-all shadow-xl"
            >
              Reserve Your Date
            </Link>
            <a
              href="tel:6319989325"
              className="border-2 border-hampton-navy/40 text-hampton-navy font-semibold px-10 py-4 rounded-full text-base hover:border-[#c4975a] transition-all"
            >
              Call (631) 998-9325
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
