import type { Metadata } from 'next'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import {
  PartyPopper, Gem, DoorOpen, Baby, Church, Heart, Zap, Calendar,
  BookOpen, Phone, FileText, Shield, RotateCcw, MapPin, Truck, HardHat, Calculator,
} from 'lucide-react'

export const metadata: Metadata = {
  title: 'Sitemap',
  description: 'Browse all pages on the Host Hampton website. Find party packages, events, booking, and more.',
}

export const dynamic = 'force-dynamic'

interface LinkItem {
  href: string
  label: string
  description: string
  icon: React.ReactNode
}

const iconClass = 'w-5 h-5 text-hampton-navy/60'

const sections: { title: string; links: LinkItem[] }[] = [
  {
    title: 'Party Services',
    links: [
      { href: '/party-packages', label: 'Theme Party Packages', description: 'Glow, Swiftie, Spa, Slime, K-Pop, Barbie and more', icon: <PartyPopper className={iconClass} /> },
      { href: '/party-menu', label: 'Full Pricing Menu', description: 'Complete pricing for all services and add-ons', icon: <FileText className={iconClass} /> },
      { href: '/glow-party', label: 'Kids Glow Party', description: 'Neon blacklight birthday party experience', icon: <Zap className={iconClass} /> },
      { href: '/first-birthday-parties', label: 'First Birthday Parties', description: 'Special milestone celebration packages', icon: <Baby className={iconClass} /> },
      { href: '/communion-party', label: 'Communion Party', description: 'First communion celebration packages', icon: <Church className={iconClass} /> },
      { href: '/party-room-rental', label: 'Party Room Rental', description: 'Private studio space for your event', icon: <DoorOpen className={iconClass} /> },
      { href: '/party-add-ons', label: 'Party Add-Ons', description: 'Extra touches to enhance any party', icon: <Heart className={iconClass} /> },
      { href: '/permanent-jewelry', label: 'Permanent Jewelry', description: 'Custom-welded bracelets, anklets, and necklaces', icon: <Gem className={iconClass} /> },
      { href: '/party-quote', label: 'Party Quote Builder', description: 'Build a custom party quote with real-time pricing', icon: <Calculator className={iconClass} /> },
      { href: '/fundraiser', label: 'Fundraisers', description: 'Host a fundraiser event at our venue', icon: <Heart className={iconClass} /> },
      { href: '/mobile-party', label: 'Mobile Party', description: 'We bring the party to your location', icon: <Truck className={iconClass} /> },
      { href: '/trucker-hat-bar', label: 'Trucker Hat Bar', description: 'Atelier Brim — curated hat bar for corporate events', icon: <HardHat className={iconClass} /> },
    ],
  },
  {
    title: 'Booking & Events',
    links: [
      { href: '/book', label: 'Reserve Your Date', description: 'Book any service on our calendar', icon: <Calendar className={iconClass} /> },
      { href: '/events', label: 'Events & Workshops', description: 'Upcoming classes, markets, and community events', icon: <BookOpen className={iconClass} /> },
      { href: '/cm-cheer', label: 'CM Cheer Events', description: 'Center Moriches cheer at Host Hampton', icon: <PartyPopper className={iconClass} /> },
    ],
  },
  {
    title: 'Information',
    links: [
      { href: '/contact-us', label: 'Contact Us', description: 'Get in touch — we respond within 24 hours', icon: <Phone className={iconClass} /> },

    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy-policy', label: 'Privacy Policy', description: 'How we handle your data', icon: <Shield className={iconClass} /> },
      { href: '/terms-of-service', label: 'Terms of Service', description: 'Website terms and conditions', icon: <FileText className={iconClass} /> },
      { href: '/return-policy', label: 'Return Policy', description: 'Refund and cancellation info', icon: <RotateCcw className={iconClass} /> },
    ],
  },
]

export default async function SitemapPage() {
  // Fetch dynamic events
  let events: { slug: string; title: string }[] = []
  try {
    const supabase = getSupabase()
    const { data } = await supabase
      .from('events')
      .select('slug, title')
      .eq('is_active', true)
      .order('event_date', { ascending: true, nullsFirst: false })
    events = data || []
  } catch {
    // Page still renders without events
  }

  return (
    <div>
      <section className="py-16 text-center px-4">
        <h1 className="font-serif text-4xl text-hampton-navy mb-3">Sitemap</h1>
        <p className="text-hampton-navy/70 text-base max-w-lg mx-auto">
          A complete directory of every page on our site. Find what you're looking for below.
        </p>
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          {sections.map(section => (
            <div key={section.title}>
              <h2 className="font-serif text-xl text-hampton-navy mb-4 pb-2 border-b border-hampton-pink/20">
                {section.title}
              </h2>
              <ul className="space-y-3">
                {section.links.map(link => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="group flex items-start gap-3 p-3 -mx-3 rounded-xl hover:bg-hampton-pink/5 transition-colors"
                    >
                      <span className="mt-0.5 shrink-0">{link.icon}</span>
                      <div>
                        <span className="text-sm font-semibold text-hampton-navy group-hover:text-hampton-blue transition-colors">
                          {link.label}
                        </span>
                        <p className="text-xs text-hampton-navy/50 mt-0.5">{link.description}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Dynamic events section */}
          {events.length > 0 && (
            <div className="md:col-span-2">
              <h2 className="font-serif text-xl text-hampton-navy mb-4 pb-2 border-b border-hampton-pink/20">
                <span className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-hampton-navy/60" />
                  Individual Events
                </span>
              </h2>
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {events.map(event => (
                  <li key={event.slug}>
                    <Link
                      href={`/events/${event.slug}`}
                      className="block p-3 rounded-xl text-sm font-medium text-hampton-navy hover:text-hampton-blue hover:bg-hampton-pink/5 transition-colors"
                    >
                      {event.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
