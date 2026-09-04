import Link from 'next/link'
import Image from 'next/image'
import { Phone, Mail, MapPin, Instagram, Facebook, MessageCircle, Clock } from 'lucide-react'

export default function Footer() {
  return (
    <footer className="bg-[#BCCDEB] text-hampton-navy">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">

        {/* Brand */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <Image src="/images/host-hampton-logo.png" alt="Host Hampton" width={36} height={36} />
            <span className="font-serif text-lg font-bold">Host Hampton</span>
          </div>
          <p className="text-sm text-hampton-navy/70 leading-relaxed">
            A private celebration studio in Speonk, NY. Upscale Hamptons parties with hands-on hosts — fully customizable to fit any budget.
          </p>
          <div className="flex gap-3 mt-5">
            <a href="https://instagram.com/hosthampton" target="_blank" rel="noopener noreferrer"
               className="text-hampton-navy/60 hover:text-hampton-navy transition-colors">
              <Instagram size={20} />
            </a>
            <a href="https://facebook.com/hosthampton" target="_blank" rel="noopener noreferrer"
               className="text-hampton-navy/60 hover:text-hampton-navy transition-colors">
              <Facebook size={20} />
            </a>
          </div>
        </div>

        {/* Services */}
        <div>
          <h4 className="font-semibold text-sm tracking-widest uppercase text-hampton-navy mb-4">Services</h4>
          <ul className="space-y-2 text-sm text-hampton-navy/70">
            {[
              { href: '/kids-party-menu',    label: 'Design Your Party' },
              { href: '/party-packages',     label: 'Kids Theme Parties' },
              { href: '/mobile-craft-party', label: 'Mobile Craft Parties' },
              { href: '/shower-venue',       label: 'Baby & Bridal Showers' },
              { href: '/party-room-rental',  label: 'Room Rental' },
              { href: '/permanent-jewelry',  label: 'Permanent Jewelry' },
              { href: '/events',             label: 'Events & Classes' },
              { href: '/first-birthday-parties', label: 'First Birthdays' },
              { href: '/fundraiser',         label: 'Fundraisers' },
            ].map(l => (
              <li key={l.href}>
                <Link href={l.href} className="hover:text-hampton-navy transition-colors">{l.label}</Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Quick Links */}
        <div>
          <h4 className="font-semibold text-sm tracking-widest uppercase text-hampton-navy mb-4">Quick Links</h4>
          <ul className="space-y-2 text-sm text-hampton-navy/70">
            {[
              { href: '/book',              label: 'Reserve Your Date' },
              { href: '/faq',               label: 'FAQ' },
              { href: '/contact-us',        label: 'Contact Us' },

              { href: '/privacy-policy',    label: 'Privacy Policy' },
              { href: '/terms-of-service',  label: 'Terms of Service' },
              { href: '/return-policy',     label: 'Return Policy' },
              { href: '/sitemap',           label: 'Sitemap' },
            ].map(l => (
              <li key={l.href}>
                <Link href={l.href} className="hover:text-hampton-navy transition-colors">{l.label}</Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Contact */}
        <div>
          <h4 className="font-semibold text-sm tracking-widest uppercase text-hampton-navy mb-4">Find Us</h4>
          <ul className="space-y-3 text-sm text-hampton-navy/70">
            <li>
              <a href="https://maps.app.goo.gl/dpHmDoUKSN7dXCaT8" target="_blank" rel="noopener noreferrer" className="flex gap-2 hover:text-hampton-navy transition-colors">
                <MapPin size={16} className="shrink-0 mt-0.5 text-hampton-navy" />
                <span>295 Montauk Hwy, Suite 7<br />Speonk, NY 11972</span>
              </a>
            </li>
            <li>
              <a href="tel:6319989325" className="flex gap-2 hover:text-hampton-navy transition-colors">
                <Phone size={16} className="shrink-0 text-hampton-navy" />
                (631) 998-9325
              </a>
            </li>
            <li>
              <a href="sms:6319989325" className="flex gap-2 hover:text-hampton-navy transition-colors">
                <MessageCircle size={16} className="shrink-0 text-hampton-navy" />
                Text Us
              </a>
            </li>
            <li>
              <a href="mailto:hosthampton295@gmail.com" className="flex gap-2 hover:text-hampton-navy transition-colors">
                <Mail size={16} className="shrink-0 text-hampton-navy" />
                hosthampton295@gmail.com
              </a>
            </li>
            <li className="flex gap-2">
              <Clock size={16} className="shrink-0 mt-0.5 text-hampton-navy" />
              <span>
                Sat–Sun: 10am–8pm<br />
                Mon–Fri: 12pm–7pm
              </span>
            </li>
          </ul>
          <div className="mt-5">
            <Link href="/book" className="bg-hampton-navy text-white text-xs font-semibold px-5 py-2.5 rounded-full hover:bg-hampton-navy/90 transition-all shadow-sm">
              Reserve Your Date
            </Link>
          </div>
        </div>
      </div>

      <div className="border-t border-hampton-navy/15 py-5 text-center text-xs text-hampton-navy/50">
        &copy; {new Date().getFullYear()} Host Hampton. All rights reserved.
      </div>
    </footer>
  )
}
