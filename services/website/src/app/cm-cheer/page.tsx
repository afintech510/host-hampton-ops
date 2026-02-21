import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'CM Cheer Events | Host Hampton',
  description: 'CM Cheer events at Host Hampton in Speonk, NY. Celebrations, team events, and more. Contact us for details.',
}

export default function CMCheer() {
  return (
    <div className="bg-hampton-ivory">
      <section className="bg-hampton-navy py-20 text-center px-4">
        <p className="text-hampton-pink text-sm font-semibold tracking-widest uppercase mb-4">Center Moriches</p>
        <h1 className="font-serif text-4xl md:text-5xl text-white mb-5">CM Cheer at Host Hampton</h1>
        <p className="text-hampton-blue/80 text-lg max-w-xl mx-auto mb-8">
          Team celebrations, spirit events, and cheer parties — we've got the perfect private space for your squad.
        </p>
        <Link href="/book?event_type=cheer"
              className="bg-hampton-pink text-hampton-navy font-bold px-8 py-4 rounded-full hover:bg-opacity-90 shadow-lg">
          Book Your Event
        </Link>
      </section>

      <section className="py-16 max-w-4xl mx-auto px-4 sm:px-6 text-center">
        <h2 className="section-heading mb-4">Celebrate Your Team</h2>
        <p className="text-hampton-mauve text-base max-w-xl mx-auto mb-10">
          From end-of-season parties to spirit nights, Host Hampton's private studio is the perfect place to celebrate your cheer family.
        </p>
        <div className="grid sm:grid-cols-3 gap-6 mb-10">
          {[
            { icon: '🏆', title: 'End of Season Parties', desc: 'Celebrate wins, bonds, and memories in our beautiful private studio.' },
            { icon: '🎉', title: 'Team Spirit Nights',     desc: 'Themed parties, makeovers, and fun activities for the whole squad.' },
            { icon: '🎀', title: 'Coach Appreciation',     desc: 'Give your coach the celebration they deserve in a stunning private setting.' },
          ].map(f => (
            <div key={f.title} className="bg-white border border-hampton-pink/20 rounded-2xl p-5 text-center">
              <div className="text-4xl mb-3">{f.icon}</div>
              <h3 className="font-semibold text-hampton-navy text-sm mb-2">{f.title}</h3>
              <p className="text-hampton-mauve text-xs leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
        <Link href="/contact-us" className="btn-secondary mr-4">Contact Us</Link>
        <Link href="/book?event_type=cheer" className="btn-primary">Book Now</Link>
      </section>
    </div>
  )
}
