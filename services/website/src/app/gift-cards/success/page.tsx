import type { Metadata } from 'next'
import Link from 'next/link'
import { NOINDEX } from '@/lib/seo'

export const metadata: Metadata = {
  robots: NOINDEX,
  title: 'Gift Card Sent! | Host Hampton',
}

export default function GiftCardSuccessPage() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="font-serif text-3xl text-hampton-navy mb-4">Gift Card Sent!</h1>
        <p className="text-hampton-navy/70 leading-relaxed mb-2">
          Your gift card has been emailed to the recipient. They&apos;ll receive a beautiful virtual card with your personal message and redemption code.
        </p>
        <p className="text-hampton-navy/50 text-sm mb-8">
          A confirmation copy has been sent to your email as well.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/gift-cards"
            className="px-6 py-3 rounded-xl bg-hampton-navy text-white font-semibold text-sm hover:bg-hampton-navy/90 transition-colors"
          >
            Send Another Gift Card
          </Link>
          <Link
            href="/"
            className="px-6 py-3 rounded-xl border-2 border-hampton-navy text-hampton-navy font-semibold text-sm hover:bg-hampton-navy/5 transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  )
}
