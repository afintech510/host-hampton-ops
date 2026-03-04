import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Return Policy' }

export default function ReturnPolicy() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="font-serif text-3xl text-hampton-navy mb-6">Return Policy</h1>
      <div className="prose prose-sm text-hampton-navy space-y-4">
        <p className="text-hampton-mauve text-sm">Last updated: {new Date().getFullYear()}</p>
        <h2 className="font-semibold text-lg mt-6">Event Deposits</h2>
        <p>Deposits are non-refundable but may be transferred to a future event date. Please see our Terms of Service for full cancellation and rescheduling policies.</p>
        <h2 className="font-semibold text-lg mt-6">Merchandise & Gift Shop</h2>
        <p>In-store purchases may be returned within 14 days of purchase with original receipt for store credit. Items must be unused and in original packaging.</p>
        <h2 className="font-semibold text-lg mt-6">Permanent Jewelry</h2>
        <p>Permanent jewelry is custom-fitted and welded to order. Due to the nature of the service, permanent jewelry purchases are non-refundable.</p>
        <h2 className="font-semibold text-lg mt-6">Contact</h2>
        <p>For return inquiries, contact hosthampton295@gmail.com or call (631) 998-9325.</p>
      </div>
    </div>
  )
}
