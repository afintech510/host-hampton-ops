import type { Metadata } from 'next'
import { Phone, Mail, MapPin, Clock, Instagram, Facebook, Navigation } from 'lucide-react'
import ContactForm from '@/components/ContactForm'

export const metadata: Metadata = {
  title: 'Contact Us | Host Hampton',
  description: 'Get in touch with Host Hampton in Speonk, NY. Call, text, or email to plan your party. Located at 295 Montauk Hwy, Suite 7, Speonk, NY 11972.',
}

const CITIES_SERVED = [
  'Patchogue', 'Bellport', 'East Patchogue', 'Brookhaven', 'Mastic',
  'Mastic Beach', 'Shirley', 'Center Moriches', 'East Moriches', 'Moriches',
  'Westhampton', 'Westhampton Beach', 'Eastport', 'Remsenburg', 'Speonk',
  'Hampton Bays', 'Quogue', 'East Quogue', 'Southampton', 'Water Mill',
  'Bridgehampton', 'Sag Harbor', 'East Hampton', 'Amagansett', 'Montauk',
  'Riverhead', 'Flanders', 'Calverton', 'Manorville', 'Ridge', 'Yaphank',
]

export default function ContactUs() {
  return (
    <div>
      <section className="py-16 text-center px-4">
        <h1 className="font-serif text-4xl text-hampton-navy mb-3">Let&apos;s Plan Your Perfect Party</h1>
        <p className="text-hampton-navy text-base max-w-md mx-auto">
          Whether you have questions or you&apos;re ready to book, we&apos;d love to hear from you. Expect a response within 24 hours.
        </p>
      </section>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-16 grid md:grid-cols-2 gap-12">
        <div>
          <h2 className="font-serif text-2xl text-hampton-navy mb-6">Get In Touch</h2>
          <div className="space-y-5">
            <a href="tel:6319989325" className="flex items-center gap-4 group">
              <div className="w-10 h-10 bg-hampton-pink/20 rounded-full flex items-center justify-center text-hampton-navy group-hover:bg-hampton-pink transition-colors">
                <Phone size={18} />
              </div>
              <div>
                <p className="text-xs text-hampton-navy font-medium uppercase tracking-wide">Phone / Text</p>
                <p className="text-hampton-navy font-semibold">(631) 998-9325</p>
              </div>
            </a>
            <a href="mailto:hosthampton295@gmail.com" className="flex items-center gap-4 group">
              <div className="w-10 h-10 bg-hampton-pink/20 rounded-full flex items-center justify-center text-hampton-navy group-hover:bg-hampton-pink transition-colors">
                <Mail size={18} />
              </div>
              <div>
                <p className="text-xs text-hampton-navy font-medium uppercase tracking-wide">Email</p>
                <p className="text-hampton-navy font-semibold">hosthampton295@gmail.com</p>
              </div>
            </a>
            <a href="https://maps.app.goo.gl/dpHmDoUKSN7dXCaT8" target="_blank" rel="noopener noreferrer" className="flex items-start gap-4 group">
              <div className="w-10 h-10 bg-hampton-pink/20 rounded-full flex items-center justify-center text-hampton-navy shrink-0 group-hover:bg-hampton-pink transition-colors">
                <MapPin size={18} />
              </div>
              <div>
                <p className="text-xs text-hampton-navy font-medium uppercase tracking-wide">Address</p>
                <p className="text-hampton-navy font-semibold">295 Montauk Highway, Suite 7</p>
                <p className="text-hampton-navy">Speonk, NY 11972</p>
                <p className="text-hampton-blue text-xs mt-1 group-hover:underline">View on Google Maps &rarr;</p>
              </div>
            </a>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-hampton-pink/20 rounded-full flex items-center justify-center text-hampton-navy shrink-0">
                <Clock size={18} />
              </div>
              <div>
                <p className="text-xs text-hampton-navy font-medium uppercase tracking-wide">Hours</p>
                <p className="text-hampton-navy text-sm">Mon&#8211;Fri: 12:00 PM &#8211; 7:00 PM</p>
                <p className="text-hampton-navy text-sm">Sat&#8211;Sun: 10:00 AM &#8211; 8:00 PM</p>
              </div>
            </div>
          </div>
          <div className="flex gap-4 mt-8">
            <a href="https://instagram.com/hosthampton" target="_blank" rel="noopener noreferrer"
               className="w-10 h-10 bg-hampton-navy text-white rounded-full flex items-center justify-center hover:bg-hampton-mauve transition-colors">
              <Instagram size={18} />
            </a>
            <a href="https://facebook.com/hosthampton" target="_blank" rel="noopener noreferrer"
               className="w-10 h-10 bg-hampton-navy text-white rounded-full flex items-center justify-center hover:bg-hampton-mauve transition-colors">
              <Facebook size={18} />
            </a>
          </div>
        </div>

        <ContactForm />
      </section>

      {/* ── Serving These Areas ── */}
      <section className="bg-hampton-pink/10 py-16 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="section-heading">Serving These Areas</h2>
            <p className="text-hampton-navy max-w-lg mx-auto">
              Located in Speonk, NY &#8212; proudly serving communities across the East End and beyond.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {CITIES_SERVED.map(city => (
              <span
                key={city}
                className="bg-white border border-hampton-pink/20 rounded-full px-4 py-1.5 text-sm text-hampton-navy font-medium"
              >
                {city}
              </span>
            ))}
            <span className="bg-hampton-navy text-white rounded-full px-4 py-1.5 text-sm font-semibold">
              &amp; Surrounding Areas
            </span>
          </div>
        </div>
      </section>

      {/* ── Map + Directions ── */}
      <section className="relative">
        <div className="h-80 w-full">
          <iframe
            src="https://www.google.com/maps/embed?pb=!1m14!1m8!1m3!1d1515!2d-72.704402!3d40.8187948!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x89e8f7a98a3779bf%3A0x3e5a903d930c3d7c!2sHost%20Hampton!5e0!3m2!1sen!2sus"
            width="100%"
            height="100%"
            style={{ border: 0 }}
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            title="Host Hampton — 295 Montauk Highway, Suite 7, Speonk NY 11972"
          />
        </div>
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
          <a
            href="https://www.google.com/maps/dir/?api=1&destination=Host+Hampton&destination_place_id=0x89e8f7a98a3779bf:0x3e5a903d930c3d7c"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-hampton-navy text-white px-6 py-3 rounded-full text-sm font-semibold shadow-lg hover:bg-hampton-navy/90 transition-colors"
          >
            <Navigation size={16} />
            Get Directions
          </a>
        </div>
      </section>
    </div>
  )
}
