import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Fundraiser Events | Host Hampton, Speonk NY',
  description: 'Host your next fundraiser at Host Hampton. Private studio, full event support, catering options, and a beautiful space for community events in Speonk, NY.',
}

export default function Fundraiser() {
  return (
    <div className="bg-hampton-ivory">
      <section className="bg-hampton-navy py-20 text-center px-4">
        <p className="text-hampton-pink text-sm font-semibold tracking-widest uppercase mb-4">Community & Giving Back</p>
        <h1 className="font-serif text-4xl md:text-5xl text-white mb-5">Host Your Fundraiser Here</h1>
        <p className="text-hampton-blue/80 text-lg max-w-xl mx-auto mb-8">
          Our private studio is the perfect intimate setting for fundraisers, community events, and charity gatherings. Let's celebrate your cause together.
        </p>
        <Link href="/book?event_type=fundraiser"
              className="bg-hampton-pink text-hampton-navy font-bold px-8 py-4 rounded-full hover:bg-opacity-90 shadow-lg">
          Reserve the Space
        </Link>
      </section>

      <section className="py-16 max-w-5xl mx-auto px-4 sm:px-6">
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {[
            { icon: '💛', title: 'Flexible Setup',    desc: 'Our studio adapts to your event — whether it\'s a silent auction, bake sale, craft night fundraiser, or community gathering.' },
            { icon: '🎨', title: 'Event Activities',  desc: 'Add craft activities, permanent jewelry stations, or workshop experiences as part of your fundraiser to boost engagement and donations.' },
            { icon: '🤝', title: 'Full Support',      desc: 'We can help coordinate catering, setup, and logistics so you can focus on your cause, not the venue.' },
          ].map(f => (
            <div key={f.title} className="bg-white border border-hampton-pink/20 rounded-2xl p-6 text-center">
              <div className="text-4xl mb-3">{f.icon}</div>
              <h3 className="font-semibold text-hampton-navy text-base mb-2">{f.title}</h3>
              <p className="text-hampton-mauve text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>

        <div className="bg-hampton-pink/10 rounded-2xl p-8 text-center">
          <h2 className="font-serif text-2xl text-hampton-navy mb-3">Interested in Hosting a Fundraiser?</h2>
          <p className="text-hampton-mauve text-base mb-6">
            Every fundraiser is unique. Reach out and let's create something custom for your cause and community.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/contact-us" className="btn-secondary">Contact Us to Discuss</Link>
            <Link href="/book?event_type=fundraiser" className="btn-primary">Reserve the Space</Link>
          </div>
        </div>
      </section>
    </div>
  )
}
