'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import Link from 'next/link'

function SuccessContent() {
  const params = useSearchParams()
  const ref = params.get('ref')
  const method = params.get('method')
  const depositCentsRaw = params.get('deposit')
  const depositCents = depositCentsRaw ? parseInt(depositCentsRaw, 10) : null
  const depositFormatted = depositCents && depositCents > 0
    ? `$${(depositCents / 100).toLocaleString('en-US')}`
    : 'your deposit'

  const isNonCard = method === 'venmo' || method === 'zelle' || method === 'cash'
  const methodLabel = method === 'venmo' ? 'Venmo' : method === 'zelle' ? 'Zelle' : method === 'cash' ? 'Cash' : 'Card'

  return (
    <div className="min-h-screen bg-[#F6F1EB] flex items-center justify-center px-4 py-16">
      <div className="bg-white rounded-2xl shadow-lg max-w-lg w-full p-8 md:p-12 text-center">
        <div className="text-5xl mb-6">🎉</div>
        <h1 className="font-display text-3xl text-[#1a2744] mb-3">
          {isNonCard ? 'Booking Reserved!' : 'Deposit Received!'}
        </h1>

        {ref && (
          <p className="text-sm text-[#A1B5C8] font-mono mb-6">
            Booking Ref: {ref}
          </p>
        )}

        {isNonCard ? (
          <div className="text-left bg-[#F6F1EB] rounded-xl p-6 mb-6">
            <p className="text-[#1a2744] font-semibold mb-3">Send {depositFormatted} via {methodLabel}:</p>
            {method === 'venmo' && (
              <p className="text-gray-600 text-sm">
                Contact <strong>Allie at <a href="tel:6319989325" className="underline">(631) 998-9325</a></strong> for the Venmo handle.
                Include <strong>{ref}</strong> in the note.
              </p>
            )}
            {method === 'zelle' && (
              <p className="text-gray-600 text-sm">
                Contact <strong>Allie at <a href="tel:6319989325" className="underline">(631) 998-9325</a></strong> for the Zelle phone number.
                Include <strong>{ref}</strong> in the memo.
              </p>
            )}
            {method === 'cash' && (
              <p className="text-gray-600 text-sm">
                Bring {depositFormatted} cash to Host Hampton before or on the day of your event.
              </p>
            )}
          </div>
        ) : (
          <p className="text-gray-600 mb-6">
            Thank you! Your deposit of {depositFormatted} has been received.
          </p>
        )}

        <div className="text-left bg-[#F6F1EB] rounded-xl p-6 mb-8">
          <p className="text-[#1a2744] font-semibold mb-3">What happens next:</p>
          <ol className="text-gray-600 text-sm space-y-2 list-decimal list-inside">
            <li>We review and confirm all party details within 24 hours</li>
            <li>You&apos;ll receive an approval email with a link to your booking portal</li>
            <li>Use your portal to view details, make changes, and submit payments</li>
            <li>Remaining balance is due the day before your event</li>
          </ol>
        </div>

        <p className="text-gray-500 text-sm mb-6">
          Questions? Call or text{' '}
          <a href="tel:6319989325" className="text-[#1a2744] font-semibold hover:underline">
            (631) 998-9325
          </a>
        </p>

        <Link
          href="/"
          className="inline-block bg-[#1a2744] text-[#F6F1EB] px-8 py-3 rounded-lg font-medium hover:bg-[#2a3754] transition-colors"
        >
          Back to Home
        </Link>
      </div>
    </div>
  )
}

export default function PartySuccessPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F6F1EB]" />}>
      <SuccessContent />
    </Suspense>
  )
}
