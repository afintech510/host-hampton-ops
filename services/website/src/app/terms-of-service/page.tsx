import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Terms of Service | Host Hampton' }

export default function TermsOfService() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="font-serif text-3xl text-hampton-navy mb-6">Terms of Service</h1>
      <div className="prose prose-sm text-hampton-navy space-y-4">
        <p className="text-hampton-mauve text-sm">Last updated: {new Date().getFullYear()}</p>
        <p>By accessing and using hosthampton.com, you accept and agree to be bound by these Terms of Service.</p>
        <h2 className="font-semibold text-lg mt-6">Bookings & Deposits</h2>
        <p>A non-refundable deposit of $250 is required to reserve your party date. The deposit is applied toward your total event balance. Dates are not held without a deposit.</p>
        <h2 className="font-semibold text-lg mt-6">Rescheduling</h2>
        <p>You may reschedule your event up to 7 days before the party date, subject to availability. Rescheduling within 7 days of the event may result in forfeiture of the deposit.</p>
        <h2 className="font-semibold text-lg mt-6">Cancellations</h2>
        <p>Cancellations made more than 14 days before the event date will receive a credit toward a future event. Cancellations within 14 days are subject to deposit forfeiture.</p>
        <h2 className="font-semibold text-lg mt-6">Contact</h2>
        <p>Questions about these terms? Contact us at hosthampton295@gmail.com or (631) 998-9325.</p>
      </div>
    </div>
  )
}
