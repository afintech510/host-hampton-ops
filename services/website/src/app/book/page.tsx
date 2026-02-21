'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'
import { Lock, CheckCircle, Phone } from 'lucide-react'

function BookingContent() {
  const params = useSearchParams()
  const packageName = params.get('package') ?? ''

  return (
    <div className="min-h-screen bg-hampton-ivory">
      <section className="bg-hampton-navy py-14 text-center px-4">
        <Lock size={28} className="text-hampton-pink mx-auto mb-3" />
        <h1 className="font-serif text-3xl md:text-4xl text-white mb-3">Reserve Your Date</h1>
        <p className="text-hampton-blue/80 text-base max-w-md mx-auto">
          Pay the $250 deposit to lock in your date. All party details can be changed up to 1 week before.
        </p>
      </section>

      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
        <div className="bg-white rounded-2xl border border-hampton-pink/20 shadow-sm p-8 text-center">
          {packageName && (
            <div className="bg-hampton-pink/20 rounded-xl px-5 py-3 mb-6 inline-block">
              <p className="text-hampton-navy text-sm font-semibold">Selected Package: <span className="text-hampton-mauve">{packageName}</span></p>
            </div>
          )}

          <div className="space-y-4 mb-8">
            {[
              'Choose your date on our live calendar',
              'Tell us a little about your party',
              'Pay $250 deposit via Stripe',
              'We\'ll confirm within 24 hours',
            ].map((s, i) => (
              <div key={i} className="flex items-center gap-3 text-left">
                <div className="w-7 h-7 rounded-full bg-hampton-pink/20 flex items-center justify-center text-hampton-mauve text-sm font-bold shrink-0">
                  {i + 1}
                </div>
                <span className="text-hampton-navy text-sm">{s}</span>
              </div>
            ))}
          </div>

          {/* Booking form will be wired to Stripe + Google Calendar */}
          <div className="bg-hampton-ivory rounded-xl p-6 text-center border border-hampton-pink/20">
            <p className="text-hampton-mauve text-sm mb-4">Online booking coming soon! For now, call or text us to reserve your date:</p>
            <a href="tel:6319989325"
               className="flex items-center justify-center gap-2 bg-hampton-navy text-hampton-ivory font-semibold py-3 px-8 rounded-full hover:bg-opacity-90 transition-all">
              <Phone size={16} />
              (631) 998-9325
            </a>
            <p className="text-hampton-mauve text-xs mt-3">Mon–Fri 12–7pm · Sat–Sun 10am–8pm</p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-hampton-mauve text-xs">
          <Lock size={12} />
          <span>$250 deposit is applied toward your total balance. Secure Stripe checkout coming soon.</span>
        </div>
      </section>
    </div>
  )
}

export default function BookPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-hampton-ivory flex items-center justify-center"><p className="text-hampton-mauve">Loading...</p></div>}>
      <BookingContent />
    </Suspense>
  )
}
