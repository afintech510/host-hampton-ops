import type { Metadata } from 'next'
import { Phone, Mail, MapPin, Clock, Instagram, Facebook } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Contact Us | Host Hampton',
  description: 'Get in touch with Host Hampton in Speonk, NY. Call, text, or email to plan your party. Located at 295 Montauk Hwy, Suite 7, Speonk, NY 11972.',
}

export default function ContactUs() {
  return (
    <div className="bg-hampton-ivory">
      <section className="py-16 text-center px-4">
        <h1 className="font-serif text-4xl text-hampton-navy mb-3">Let's Plan Your Perfect Party</h1>
        <p className="text-hampton-navy text-base max-w-md mx-auto">
          Whether you have questions or you're ready to book, we'd love to hear from you. Expect a response within 24 hours.
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
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-hampton-pink/20 rounded-full flex items-center justify-center text-hampton-navy shrink-0">
                <MapPin size={18} />
              </div>
              <div>
                <p className="text-xs text-hampton-navy font-medium uppercase tracking-wide">Address</p>
                <p className="text-hampton-navy font-semibold">295 Montauk Highway, Suite 7</p>
                <p className="text-hampton-navy">Speonk, NY 11972</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-hampton-pink/20 rounded-full flex items-center justify-center text-hampton-navy shrink-0">
                <Clock size={18} />
              </div>
              <div>
                <p className="text-xs text-hampton-navy font-medium uppercase tracking-wide">Hours</p>
                <p className="text-hampton-navy text-sm">Mon–Fri: 12:00 PM – 7:00 PM</p>
                <p className="text-hampton-navy text-sm">Sat–Sun: 10:00 AM – 8:00 PM</p>
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

        <div className="bg-white rounded-2xl border border-hampton-pink/20 p-6 shadow-sm">
          <h2 className="font-serif text-2xl text-hampton-navy mb-5">Send a Message</h2>
          <form className="space-y-4" action="mailto:hosthampton295@gmail.com" method="get">
            <div>
              <label className="block text-xs font-medium text-hampton-navy uppercase tracking-wide mb-1">Your Name</label>
              <input type="text" name="name" required placeholder="Jane Smith"
                     className="w-full border border-hampton-pink/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-pink/40" />
            </div>
            <div>
              <label className="block text-xs font-medium text-hampton-navy uppercase tracking-wide mb-1">Email</label>
              <input type="email" name="email" required placeholder="you@email.com"
                     className="w-full border border-hampton-pink/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-pink/40" />
            </div>
            <div>
              <label className="block text-xs font-medium text-hampton-navy uppercase tracking-wide mb-1">Message</label>
              <textarea name="body" rows={4} placeholder="Tell us about your event..."
                        className="w-full border border-hampton-pink/30 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-pink/40 resize-none" />
            </div>
            <button type="submit" className="btn-primary w-full text-center">Send Message</button>
          </form>
        </div>
      </section>

      {/* Map embed */}
      <section className="h-64 w-full">
        <iframe
          src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3022!2d-72.68!3d40.843!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zNDDCsDUwJzM1LjUiTiA3MsKwNDAnNDMuMSJX!5e0!3m2!1sen!2sus!4v1234567890"
          width="100%"
          height="100%"
          style={{ border: 0 }}
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title="Host Hampton Location"
        />
      </section>
    </div>
  )
}
