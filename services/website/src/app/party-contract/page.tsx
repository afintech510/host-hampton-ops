import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Party Contract | Host Hampton' }

export default function PartyContract() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="font-serif text-3xl text-hampton-navy mb-6">Party Contract</h1>
      <div className="prose prose-sm text-hampton-navy space-y-4">
        <p className="text-hampton-mauve text-sm">Host Hampton — Standard Party Agreement</p>
        <h2 className="font-semibold text-lg mt-6">Reservation & Deposit</h2>
        <p>A $250 deposit is required to secure your party date. This deposit is applied toward the total balance. Remaining balance is due no later than 7 days before the event.</p>
        <h2 className="font-semibold text-lg mt-6">Party Details</h2>
        <p>Theme, add-ons, dietary preferences, and guest count may be adjusted up to 7 days before the party date. Changes within 7 days are subject to availability and may incur additional charges.</p>
        <h2 className="font-semibold text-lg mt-6">Venue Rules</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>The party includes 2 hours of exclusive studio use</li>
          <li>Setup begins 1 hour before the party; guests should arrive at the scheduled start time</li>
          <li>Parents/guardians are responsible for supervising their children at all times</li>
          <li>Host Hampton is not responsible for personal items left at the venue</li>
          <li>Any damage to the studio or equipment beyond normal wear will be assessed and billed accordingly</li>
        </ul>
        <h2 className="font-semibold text-lg mt-6">Room Rental Security Deposit</h2>
        <p>Room-only rentals require a $500 refundable security deposit, returned within 5 business days after the event if the space is left in its original condition.</p>
        <h2 className="font-semibold text-lg mt-6">Cancellation</h2>
        <p>Cancellations more than 14 days before the event receive a credit for a future booking. Cancellations within 14 days forfeit the deposit. No-shows forfeit the full deposit.</p>
        <h2 className="font-semibold text-lg mt-6">Agreement</h2>
        <p>By placing a deposit, you agree to these terms. A copy of this contract will be sent to the email address provided at booking.</p>
        <p className="mt-6">Questions? Contact us at hosthampton295@gmail.com or (631) 998-9325.</p>
      </div>
    </div>
  )
}
