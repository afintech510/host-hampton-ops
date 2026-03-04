import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Terms of Service' }

export default function TermsOfService() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="font-serif text-3xl text-hampton-navy mb-6">Terms of Service</h1>
      <div className="prose prose-sm text-hampton-navy space-y-4">
        <p className="text-hampton-mauve text-sm">Last updated: {new Date().getFullYear()}</p>

        <p>
          Welcome to Host Hampton. By accessing or using our website (hosthampton.com) and
          services, you agree to be bound by these Terms of Service. Please read them carefully.
        </p>

        <h2 className="font-semibold text-lg mt-6">1. Services Overview</h2>
        <p>
          Host Hampton provides themed birthday parties, event hosting, room rentals, permanent
          jewelry services, mobile party services, and related celebrations at our studio in
          Speonk, NY. We also offer event ticketing and community workshops through our website.
        </p>

        <h2 className="font-semibold text-lg mt-6">2. Bookings & Payments</h2>
        <p>
          A non-refundable deposit is required to reserve your party date. The deposit amount
          varies by service type and is applied toward your total event balance. Dates are not
          held without a deposit. Remaining balance is due no later than 7 days before the event.
        </p>
        <p>
          All payments are processed securely through Stripe. By making a payment, you agree to
          Stripe&apos;s terms of service in addition to ours.
        </p>

        <h2 className="font-semibold text-lg mt-6">3. Event Policies</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Parties include 2 hours of exclusive studio use</li>
          <li>Setup begins 1 hour before the party; guests should arrive at the scheduled start time</li>
          <li>Parents/guardians are responsible for supervising children at all times</li>
          <li>Host Hampton is not responsible for personal items left at the venue</li>
          <li>Any damage to the studio or equipment beyond normal wear will be assessed and billed accordingly</li>
          <li>Room-only rentals require a $500 refundable security deposit, returned within 5 business days if the space is left in its original condition</li>
        </ul>

        <h2 className="font-semibold text-lg mt-6">4. Rescheduling</h2>
        <p>
          You may reschedule your event up to 7 days before the party date, subject to
          availability. Rescheduling within 7 days of the event may result in forfeiture of the
          deposit. Theme, add-ons, dietary preferences, and guest count may be adjusted up to
          7 days before the party date. Changes within 7 days are subject to availability and
          may incur additional charges.
        </p>

        <h2 className="font-semibold text-lg mt-6">5. Cancellations & Refunds</h2>
        <p>
          Cancellations made more than 14 days before the event date will receive a credit toward
          a future booking. Cancellations within 14 days of the event are subject to deposit
          forfeiture. No-shows forfeit the full deposit. Event ticket purchases are non-refundable
          unless the event is cancelled by Host Hampton.
        </p>

        <h2 className="font-semibold text-lg mt-6">6. Permitted Use</h2>
        <p>
          You agree to use our website and services only for lawful purposes. You may not use our
          site in any way that could damage, disable, overburden, or impair our servers or
          interfere with any other party&apos;s use of the site.
        </p>

        <h2 className="font-semibold text-lg mt-6">7. Intellectual Property</h2>
        <p>
          All content on this website, including text, graphics, logos, images, and software, is
          the property of Host Hampton and is protected by applicable intellectual property laws.
          You may not reproduce, distribute, or create derivative works without our prior written
          consent.
        </p>

        <h2 className="font-semibold text-lg mt-6">8. Privacy</h2>
        <p>
          Your use of our website is also governed by our{' '}
          <a href="/privacy-policy" className="text-hampton-pink hover:underline">Privacy Policy</a>,
          which describes how we collect, use, and protect your personal information.
        </p>

        <h2 className="font-semibold text-lg mt-6">9. Limitation of Liability</h2>
        <p>
          Host Hampton shall not be liable for any indirect, incidental, special, consequential,
          or punitive damages arising from your use of our website or services. Our total liability
          shall not exceed the amount you paid for the applicable service.
        </p>

        <h2 className="font-semibold text-lg mt-6">10. Modifications</h2>
        <p>
          We reserve the right to modify these Terms at any time. Changes will be posted on this
          page with an updated &quot;Last updated&quot; date. Your continued use of our website after
          changes are posted constitutes acceptance of the modified terms.
        </p>

        <h2 className="font-semibold text-lg mt-6">11. Text Messaging Terms</h2>
        <p>
          By providing your phone number and opting in, you consent to receive text messages from
          Host Hampton including booking confirmations, event reminders, and promotional messages.
          Message and data rates may apply. Message frequency varies. Reply <strong>STOP</strong> to
          opt out at any time. Reply <strong>HELP</strong> for assistance. Your mobile information
          will not be shared with third parties for marketing purposes. See
          our <a href="/privacy-policy" className="text-hampton-pink hover:underline">Privacy Policy</a> for
          more details.
        </p>

        <h2 className="font-semibold text-lg mt-6">12. Governing Law</h2>
        <p>
          These Terms shall be governed by and construed in accordance with the laws of the
          State of New York, without regard to its conflict of law provisions.
        </p>

        <h2 className="font-semibold text-lg mt-6">Contact Us</h2>
        <p>
          Questions about these terms? Contact us
          at <a href="mailto:hosthampton295@gmail.com" className="text-hampton-pink hover:underline">hosthampton295@gmail.com</a> or
          call <a href="tel:6319989325" className="text-hampton-pink hover:underline">(631) 998-9325</a>.
        </p>
      </div>
    </div>
  )
}
