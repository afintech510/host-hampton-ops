import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle, Calendar, Mail, Phone } from 'lucide-react'

export const metadata: Metadata = { title: 'Booking Confirmed! | Host Hampton' }

export default function BookSuccess() {
  return (
    <div className="min-h-screen bg-hampton-ivory flex items-center justify-center px-4 py-20">
      <div className="max-w-lg w-full text-center">
        <CheckCircle size={64} className="text-green-500 mx-auto mb-6" />
        <h1 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-4">
          You're All Set! 🎉
        </h1>
        <p className="text-hampton-mauve text-lg mb-8">
          Your date is locked in. We'll confirm your booking within 24 hours and send a welcome email with next steps.
        </p>
        <div className="bg-white rounded-2xl border border-hampton-pink/20 p-6 text-left space-y-3 mb-8">
          <h2 className="font-semibold text-hampton-navy text-base mb-3">What happens next:</h2>
          {[
            { icon: <Mail size={16} />, text: 'Check your email for a booking confirmation from us' },
            { icon: <Calendar size={16} />, text: 'We\'ll send calendar invite with your party date & time' },
            { icon: <Phone size={16} />, text: 'We\'ll reach out to start planning all the fun details' },
          ].map((s, i) => (
            <div key={i} className="flex items-center gap-3 text-sm text-hampton-navy">
              <span className="text-hampton-mauve">{s.icon}</span>
              <span>{s.text}</span>
            </div>
          ))}
        </div>
        <p className="text-hampton-mauve text-sm mb-6">
          Questions? Call or text us: <a href="tel:6319989325" className="font-semibold hover:text-hampton-navy">(631) 998-9325</a>
        </p>
        <Link href="/" className="btn-primary">Back to Home</Link>
      </div>
    </div>
  )
}
