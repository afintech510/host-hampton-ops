import type { Metadata } from 'next'

// The root layout appends ' | Host Hampton'; naming it here rendered it twice.
export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms that apply to bookings, payments, cancellations and use of the Host Hampton website.',
}

export default function TermsOfService() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="font-serif text-3xl text-hampton-navy mb-6">Terms of Service</h1>
      <div className="prose prose-sm text-hampton-navy space-y-4">
        <p className="text-hampton-mauve text-sm">Last updated: March 7, 2026</p>

        <p>
          Welcome to Host Hampton. By accessing or using our website (<a href="https://www.hosthampton.com" className="text-hampton-pink hover:underline">www.hosthampton.com</a>) and
          services, you agree to be bound by these Terms of Service (&quot;Terms&quot;). Please read them
          carefully. If you do not agree to these Terms, please do not use our website or services.
        </p>

        <h2 className="font-semibold text-lg mt-6">1. Services Overview</h2>
        <p>
          Host Hampton LLC (&quot;Host Hampton,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;)
          provides themed birthday parties, event hosting, room rentals, permanent jewelry services, mobile
          party services, community workshops, and related celebrations at our studio located at 295 Montauk
          Highway, Suite 7, Speonk, NY 11972. We also offer event ticketing through our website.
        </p>

        <h2 className="font-semibold text-lg mt-6">2. Bookings &amp; Payments</h2>
        <p>
          A <strong>$250 deposit</strong> is required to reserve your date and is applied toward your total
          event balance. Dates are not held without a deposit. The remaining balance may be paid any time
          before your event, and must be settled no later than the day of the event.
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
          <li>Room and studio rentals require a <strong>$500 refundable security hold</strong>, authorized on your card on arrival and released after the event if the space is left in its original condition. This is an authorization hold, not a charge — it is only captured if there is damage or excessive cleaning</li>
        </ul>

        <h2 className="font-semibold text-lg mt-6">4. Rescheduling</h2>
        <p>
          <strong>There is no date-change fee.</strong> You may move your event to another date at any time,
          subject to availability, and your deposit moves with it. Theme, add-ons, dietary preferences, and
          guest count may be adjusted up to 7 days before the party date; changes within 7 days are subject
          to availability and may incur additional charges.
        </p>

        <h2 className="font-semibold text-lg mt-6">5. Cancellations &amp; Refunds</h2>
        <p>
          If you cancel <strong>more than 30 days</strong> before your event date, half of the $250 deposit
          ($125) is non-refundable and the remainder is refunded. If you cancel <strong>within 30 days</strong>
          of your event date, the full $250 deposit is non-refundable. Any balance you have paid beyond the
          deposit is refunded in either case. No-shows forfeit the full deposit. Remember that changing your
          date carries no fee — if your plans shift, rescheduling costs you nothing. Event ticket purchases
          are non-refundable unless the event is cancelled by Host Hampton.
        </p>

        <h2 className="font-semibold text-lg mt-6">6. Text Messaging Terms &amp; Conditions</h2>
        <p>
          Host Hampton offers an SMS/text messaging program. By opting in to our text messaging program,
          you agree to the following terms:
        </p>

        <h3 className="font-semibold text-base mt-4">Consent</h3>
        <p>
          By providing your mobile phone number and checking the marketing consent checkbox on any of our
          forms (booking, ticket purchase, or registration), you expressly consent to receive recurring
          automated text messages from Host Hampton at the mobile number you provided. Consent to receive
          text messages is not required as a condition of purchasing any goods or services.
        </p>

        <h3 className="font-semibold text-base mt-4">Types of Messages</h3>
        <p>Messages may include:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Booking confirmations and updates</li>
          <li>Event reminders (e.g., 1 day before your event)</li>
          <li>Party preparation reminders</li>
          <li>Promotional offers and event announcements</li>
          <li>Flash sale notifications</li>
          <li>New event and service announcements</li>
        </ul>

        <h3 className="font-semibold text-base mt-4">Message Frequency</h3>
        <p>
          Message frequency varies. You may receive up to 8 messages per month. Additional transactional
          messages (booking confirmations, event reminders) may be sent as needed based on your specific
          bookings and ticket purchases.
        </p>

        <h3 className="font-semibold text-base mt-4">Message and Data Rates</h3>
        <p>
          Message and data rates may apply. Please check with your mobile carrier for details about your
          text messaging plan. Host Hampton is not responsible for any messaging or data charges imposed
          by your carrier.
        </p>

        <h3 className="font-semibold text-base mt-4">Opt-Out</h3>
        <p>
          You can opt out of text messages at any time by replying <strong>STOP</strong> to any message
          from Host Hampton. You may also
          text <strong>STOP</strong>, <strong>UNSUBSCRIBE</strong>, <strong>CANCEL</strong>, <strong>END</strong>,
          or <strong>QUIT</strong> to opt out. After opting out, you will receive one final confirmation
          message confirming your unsubscription. No additional text messages will be sent unless you
          re-opt-in.
        </p>

        <h3 className="font-semibold text-base mt-4">Help</h3>
        <p>
          For help with our text messaging program, reply <strong>HELP</strong> to any message. You may also
          contact us at <a href="mailto:hosthampton295@gmail.com" className="text-hampton-pink hover:underline">hosthampton295@gmail.com</a> or
          call <a href="tel:6319989325" className="text-hampton-pink hover:underline">(631) 998-9325</a>.
        </p>

        <h3 className="font-semibold text-base mt-4">Privacy</h3>
        <p>
          Your mobile phone number and the personal information you provide will not be sold, rented, or
          shared with third parties or affiliates for marketing or promotional purposes. Information
          collected through our SMS program is subject to
          our <a href="/privacy-policy" className="text-hampton-pink hover:underline">Privacy Policy</a>.
          We use Twilio as our messaging service provider solely for the purpose of delivering text messages.
        </p>

        <h3 className="font-semibold text-base mt-4">Carrier Disclaimer</h3>
        <p>
          Our SMS program is supported by major U.S. carriers including AT&amp;T, Verizon, T-Mobile,
          Sprint, and most regional carriers. However, carriers are not liable for delayed or undelivered
          messages. T-Mobile is not liable for delayed or undelivered messages.
        </p>

        <h2 className="font-semibold text-lg mt-6">7. Email Communications</h2>
        <p>
          By opting in to marketing communications, you also consent to receive promotional emails from
          Host Hampton. You may unsubscribe from marketing emails at any time by clicking the
          &quot;Unsubscribe&quot; link at the bottom of any email. Transactional emails (booking
          confirmations, receipts, event reminders) will still be sent as necessary for your purchases
          and bookings.
        </p>

        <h2 className="font-semibold text-lg mt-6">8. Permitted Use</h2>
        <p>
          You agree to use our website and services only for lawful purposes. You may not use our site in
          any way that could damage, disable, overburden, or impair our servers or interfere with any other
          party&apos;s use of the site.
        </p>

        <h2 className="font-semibold text-lg mt-6">9. Intellectual Property</h2>
        <p>
          All content on this website, including text, graphics, logos, images, and software, is the
          property of Host Hampton LLC and is protected by applicable intellectual property laws. You may
          not reproduce, distribute, or create derivative works without our prior written consent.
        </p>

        <h2 className="font-semibold text-lg mt-6">10. Privacy</h2>
        <p>
          Your use of our website is also governed by our{' '}
          <a href="/privacy-policy" className="text-hampton-pink hover:underline">Privacy Policy</a>,
          which describes how we collect, use, and protect your personal information, including information
          collected through our SMS/text messaging program.
        </p>

        <h2 className="font-semibold text-lg mt-6">11. Limitation of Liability</h2>
        <p>
          Host Hampton shall not be liable for any indirect, incidental, special, consequential, or punitive
          damages arising from your use of our website or services. Our total liability shall not exceed the
          amount you paid for the applicable service.
        </p>

        <h2 className="font-semibold text-lg mt-6">12. Modifications</h2>
        <p>
          We reserve the right to modify these Terms at any time. Changes will be posted on this page with
          an updated &quot;Last updated&quot; date. Your continued use of our website or services after
          changes are posted constitutes acceptance of the modified Terms.
        </p>

        <h2 className="font-semibold text-lg mt-6">13. Governing Law</h2>
        <p>
          These Terms shall be governed by and construed in accordance with the laws of the State of New
          York, without regard to its conflict of law provisions.
        </p>

        <h2 className="font-semibold text-lg mt-6">Contact Us</h2>
        <p>Questions about these Terms? Contact us:</p>
        <ul className="list-none pl-0 space-y-1">
          <li><strong>Host Hampton LLC</strong></li>
          <li>295 Montauk Highway, Suite 7</li>
          <li>Speonk, NY 11972</li>
          <li>Email: <a href="mailto:hosthampton295@gmail.com" className="text-hampton-pink hover:underline">hosthampton295@gmail.com</a></li>
          <li>Phone: <a href="tel:6319989325" className="text-hampton-pink hover:underline">(631) 998-9325</a></li>
        </ul>
      </div>
    </div>
  )
}
