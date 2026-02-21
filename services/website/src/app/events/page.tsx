import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Events & Classes | Host Hampton',
  description: 'Workshops, classes, and community events at Host Hampton in Speonk, NY. Moms in the Morning, Girls Night Out, craft classes, and more.',
}

const events = [
  { name: 'Moms in the Morning',  price: '$10',    desc: 'A weekly drop-in morning for moms. Coffee, connection, and community. Every Tuesday 9–11am.' },
  { name: 'Girls Night Out',       price: 'From $25', desc: 'Themed girls night events with crafts, drinks, and fun. Check Instagram for upcoming dates.' },
  { name: 'Craft Workshops',       price: 'Varies',   desc: 'Seasonal DIY workshops for adults and kids. Wreaths, painting, candles, and more.' },
  { name: 'Kids Classes',          price: 'Varies',   desc: 'After-school craft classes and weekend workshops for ages 5–12.' },
  { name: 'Permanent Jewelry Pop-Ups', price: 'From $45', desc: 'Walk-in permanent jewelry sessions — no appointment needed on select days.' },
]

export default function Events() {
  return (
    <div className="bg-hampton-ivory">
      <section className="bg-hampton-navy py-16 text-center px-4">
        <h1 className="font-serif text-4xl text-white mb-4">Events & Classes</h1>
        <p className="text-hampton-blue/80 text-lg max-w-xl mx-auto">
          More than just parties — Host Hampton is a community hub for moms, kids, and local families.
        </p>
      </section>

      <section className="py-16 max-w-4xl mx-auto px-4 sm:px-6">
        <div className="space-y-4">
          {events.map(e => (
            <div key={e.name} className="bg-white border border-hampton-pink/20 rounded-2xl p-6 flex flex-col sm:flex-row justify-between gap-4">
              <div>
                <h2 className="font-semibold text-hampton-navy text-lg mb-1">{e.name}</h2>
                <p className="text-hampton-mauve text-sm leading-relaxed">{e.desc}</p>
              </div>
              <div className="text-right shrink-0">
                <span className="bg-hampton-pink/20 text-hampton-navy font-bold px-4 py-1.5 rounded-full text-sm">{e.price}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-10 text-center">
          <p className="text-hampton-mauve text-sm mb-4">Follow us on Instagram for upcoming event dates and to RSVP.</p>
          <a href="https://instagram.com/hosthampton" target="_blank" rel="noopener noreferrer"
             className="btn-primary">@hosthampton on Instagram</a>
        </div>
      </section>

      <section className="bg-hampton-pink/10 py-14 text-center px-4">
        <h2 className="section-heading mb-3">Want to Host a Workshop?</h2>
        <p className="text-hampton-mauve mb-7 max-w-md mx-auto">We partner with local instructors, brands, and organizations. Get in touch to discuss hosting your workshop at Host Hampton.</p>
        <Link href="/contact-us" className="btn-primary px-8 py-4">Contact Us</Link>
      </section>
    </div>
  )
}
