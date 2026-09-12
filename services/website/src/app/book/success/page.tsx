import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { CheckCircle, Calendar, Mail, Phone } from 'lucide-react'
import ConversionTracker from '@/components/ConversionTracker'
import { NOINDEX } from '@/lib/seo'

export const metadata: Metadata = {
  robots: NOINDEX, title: 'Request Received!' }

export default function BookSuccess({ searchParams }: { searchParams: { request?: string } }) {
  const isRequest = searchParams?.request === '1'

  const steps = isRequest
    ? [
        { icon: <Calendar size={16} />, text: 'We confirm your requested date is available within 24 hours' },
        { icon: <Mail size={16} />, text: 'Once confirmed, we email you a secure link to pay your deposit and lock in your date' },
        { icon: <Phone size={16} />, text: 'We\'ll reach out to start planning all the fun details' },
      ]
    : [
        { icon: <Mail size={16} />, text: 'Check your email for a booking confirmation from us' },
        { icon: <Calendar size={16} />, text: 'You\'ll receive a personalized themed EVITE digital invitation' },
        { icon: <Phone size={16} />, text: 'We\'ll reach out to start planning all the fun details' },
      ]

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-20">
      <Suspense><ConversionTracker type="booking" /></Suspense>
      <div className="max-w-lg w-full text-center">
        <CheckCircle size={64} className="text-green-500 mx-auto mb-6" />
        <h1 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-4">
          {isRequest ? 'Request Received! 🎉' : 'You\'re All Set! 🎉'}
        </h1>
        <p className="text-hampton-navy text-lg mb-8">
          {isRequest
            ? 'Thanks! We\'ve got your party request. Nothing is booked yet and no payment is due — we\'ll confirm your date is available within 24 hours.'
            : 'Your date is locked in. We\'ll confirm your booking within 24 hours and send a welcome email with next steps.'}
        </p>
        <div className="bg-white rounded-2xl border border-hampton-pink/20 p-6 text-left space-y-3 mb-8">
          <h2 className="font-semibold text-hampton-navy text-base mb-3">What happens next:</h2>
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-3 text-sm text-hampton-navy">
              <span className="text-hampton-navy">{s.icon}</span>
              <span>{s.text}</span>
            </div>
          ))}
        </div>
        <p className="text-hampton-navy text-sm mb-6">
          Questions? Call or text us: <a href="tel:6319989325" className="font-semibold hover:text-hampton-navy">(631) 998-9325</a>
        </p>
        <Link href="/" className="btn-primary">Back to Home</Link>
      </div>
    </div>
  )
}
