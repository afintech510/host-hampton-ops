import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle, Calendar, MapPin, ArrowRight } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Tickets Confirmed | Host Hampton',
}

export default function EventSuccessPage() {
  return (
    <div className="bg-hampton-ivory min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center py-16">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle className="w-10 h-10 text-green-600" />
        </div>

        <h1 className="font-serif text-3xl text-hampton-navy mb-3">You're In! 🎉</h1>
        <p className="text-hampton-mauve text-lg mb-8">
          Your tickets are confirmed. Check your email for all the details.
        </p>

        <div className="bg-white rounded-2xl border border-hampton-pink/20 p-6 text-left mb-8">
          <h2 className="font-semibold text-hampton-navy text-sm mb-4">What to expect:</h2>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-hampton-blue/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-sm font-bold text-hampton-navy">1</span>
              </div>
              <p className="text-sm text-hampton-mauve">Check your inbox for a confirmation email with your ticket reference.</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-hampton-blue/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-sm font-bold text-hampton-navy">2</span>
              </div>
              <p className="text-sm text-hampton-mauve">Arrive at Host Hampton a few minutes early. We're at 295 Montauk Hwy, Suite 7, Speonk.</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-hampton-blue/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-sm font-bold text-hampton-navy">3</span>
              </div>
              <p className="text-sm text-hampton-mauve">We'll have everything ready for you — just show up and enjoy!</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/events" className="btn-secondary px-6 py-3 text-center">
            Browse More Events
          </Link>
          <Link href="/" className="btn-primary px-6 py-3 text-center flex items-center justify-center gap-1">
            Back to Home <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}
