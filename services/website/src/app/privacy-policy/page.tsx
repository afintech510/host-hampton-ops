import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Privacy Policy | Host Hampton' }

export default function PrivacyPolicy() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="font-serif text-3xl text-hampton-navy mb-6">Privacy Policy</h1>
      <div className="prose prose-sm text-hampton-navy space-y-4">
        <p className="text-hampton-mauve text-sm">Last updated: March 7, 2026</p>

        <p>
          Host Hampton LLC (&quot;Host Hampton,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates
          the website <a href="https://www.hosthampton.com" className="text-hampton-pink hover:underline">www.hosthampton.com</a> and
          provides themed birthday parties, event hosting, room rentals, permanent jewelry services, and community
          events at our studio located at 295 Montauk Highway, Suite 7, Speonk, NY 11972.
        </p>
        <p>
          This Privacy Policy describes how we collect, use, disclose, and protect your personal information,
          including information collected through our website, booking forms, event ticket purchases, and
          SMS/text messaging program.
        </p>

        <h2 className="font-semibold text-lg mt-6">1. Information We Collect</h2>
        <p>We collect information you provide directly to us, including when you:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Make a party booking or room rental reservation</li>
          <li>Purchase event tickets or RSVP to a free event</li>
          <li>Submit an inquiry or contact form</li>
          <li>Opt in to receive text messages or email marketing</li>
          <li>Interact with us on social media or in person</li>
        </ul>
        <p>This information may include:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Full name</li>
          <li>Email address</li>
          <li>Phone number (including mobile number)</li>
          <li>Mailing address</li>
          <li>Payment information (processed securely via Stripe; we do not store card details)</li>
          <li>Event details (child&apos;s name, age, guest count, party preferences)</li>
        </ul>
        <p>
          We also automatically collect certain information when you visit our site, including your IP address,
          browser type, device information, referring/exit pages, and pages viewed. We use cookies, Google
          Analytics, and similar tracking technologies to understand how our site is used.
        </p>

        <h2 className="font-semibold text-lg mt-6">2. How We Use Your Information</h2>
        <p>We use the information we collect to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Process bookings, event ticket purchases, and payments</li>
          <li>Send transactional communications (booking confirmations, receipts, event reminders)</li>
          <li>Send promotional offers, event announcements, and marketing communications (with your consent)</li>
          <li>Respond to your questions, comments, and customer service requests</li>
          <li>Improve our website, services, and customer experience</li>
          <li>Comply with legal obligations</li>
        </ul>

        <h2 className="font-semibold text-lg mt-6">3. SMS / Text Messaging Program</h2>
        <p>
          Host Hampton offers an SMS/text messaging program for customers who expressly opt in. By providing
          your mobile phone number and checking the consent box on our booking, ticket purchase, or
          registration forms, you consent to receive text messages from Host Hampton.
        </p>

        <h3 className="font-semibold text-base mt-4">Types of Messages</h3>
        <p>You may receive the following types of text messages:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Transactional messages:</strong> Booking confirmations, event reminders (1 day before,
            day of event), and important updates about your reservation or tickets</li>
          <li><strong>Promotional messages:</strong> Event announcements, special offers, flash sales, and
            marketing communications about Host Hampton services (only if you opt in to marketing)</li>
        </ul>

        <h3 className="font-semibold text-base mt-4">Message Frequency</h3>
        <p>
          Message frequency varies. You may receive up to 8 messages per month depending on upcoming events,
          bookings, and promotions. Transactional messages (reminders, confirmations) are sent as needed based
          on your bookings and ticket purchases.
        </p>

        <h3 className="font-semibold text-base mt-4">Opt-In</h3>
        <p>
          You opt in to receive text messages by checking the marketing consent checkbox when making a booking,
          purchasing event tickets, or registering on our website. Consent is not a condition of purchase. You
          can complete a booking or ticket purchase without opting in to text messages.
        </p>

        <h3 className="font-semibold text-base mt-4">Opt-Out</h3>
        <p>
          You may opt out of receiving text messages at any time by replying <strong>STOP</strong> to any
          message you receive from us. You may also text <strong>STOP</strong> to our messaging number at any
          time. After opting out, you will receive one final confirmation message and no further text messages
          will be sent unless you re-opt-in. You may also contact us
          at <a href="mailto:hosthampton295@gmail.com" className="text-hampton-pink hover:underline">hosthampton295@gmail.com</a> or
          call <a href="tel:6319989325" className="text-hampton-pink hover:underline">(631) 998-9325</a> to opt out.
        </p>

        <h3 className="font-semibold text-base mt-4">Help</h3>
        <p>
          For help or questions about our text messaging program, reply <strong>HELP</strong> to any message,
          email us at <a href="mailto:hosthampton295@gmail.com" className="text-hampton-pink hover:underline">hosthampton295@gmail.com</a>,
          or call <a href="tel:6319989325" className="text-hampton-pink hover:underline">(631) 998-9325</a>.
        </p>

        <h3 className="font-semibold text-base mt-4">Message and Data Rates</h3>
        <p>
          Message and data rates may apply. Check with your mobile carrier for details about your messaging
          plan. Host Hampton is not responsible for any charges your carrier may apply.
        </p>

        <h3 className="font-semibold text-base mt-4">No Sharing of Mobile Information</h3>
        <p>
          <strong>We do not sell, rent, loan, trade, lease, or otherwise transfer for profit any phone
          numbers or personal information collected through our SMS/text messaging program to any third
          party.</strong> Your mobile information will not be shared with or sold to third parties or
          affiliates for marketing or promotional purposes. We may share your information with our messaging
          service provider (Twilio) solely for the purpose of delivering text messages you have consented to
          receive.
        </p>

        <h3 className="font-semibold text-base mt-4">Supported Carriers</h3>
        <p>
          Our SMS program is supported on major U.S. carriers including AT&amp;T, Verizon, T-Mobile, Sprint,
          and most other carriers. Carriers are not liable for delayed or undelivered messages.
          T-Mobile is not liable for delayed or undelivered messages.
        </p>

        <h2 className="font-semibold text-lg mt-6">4. Cookies and Tracking Technologies</h2>
        <p>
          We use cookies, web beacons, and similar technologies to collect information about how you interact
          with our website. This includes Google Analytics for website analytics and Google Ads conversion
          tracking. You can control cookie preferences through your browser settings. Disabling cookies may
          affect your experience on our site.
        </p>

        <h2 className="font-semibold text-lg mt-6">5. Information Sharing and Disclosure</h2>
        <p>
          We do not sell, trade, or rent your personal information to third parties. We may share your
          information with the following categories of service providers who assist us in operating our
          business:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Payment processing:</strong> Stripe (for secure payment processing)</li>
          <li><strong>Email communications:</strong> Resend and Brevo (for transactional and marketing emails)</li>
          <li><strong>SMS/Text messaging:</strong> Twilio (for delivering text messages)</li>
          <li><strong>Analytics:</strong> Google Analytics (for website usage analysis)</li>
          <li><strong>Customer support:</strong> Crisp (for live chat)</li>
        </ul>
        <p>
          These service providers are contractually obligated to protect your information and may only use it
          to provide services on our behalf. We may also disclose your information when required by law, to
          protect our rights or safety, or to comply with a legal process.
        </p>

        <h2 className="font-semibold text-lg mt-6">6. Data Security</h2>
        <p>
          We implement reasonable technical and organizational measures to protect your personal information
          against unauthorized access, alteration, disclosure, or destruction. Payment information is processed
          through Stripe&apos;s PCI-compliant infrastructure and is never stored on our servers. However, no
          method of transmission over the Internet is 100% secure, and we cannot guarantee absolute security.
        </p>

        <h2 className="font-semibold text-lg mt-6">7. Data Retention</h2>
        <p>
          We retain your personal information for as long as necessary to fulfill the purposes for which it
          was collected, including to satisfy legal, accounting, or reporting requirements. Phone numbers
          collected for SMS messaging are retained until you opt out or request deletion. When you opt out of
          SMS, your phone number is flagged as opted-out and no further marketing messages are sent.
        </p>

        <h2 className="font-semibold text-lg mt-6">8. Your Rights</h2>
        <p>You have the right to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Access the personal information we hold about you</li>
          <li>Request correction of inaccurate information</li>
          <li>Request deletion of your personal information</li>
          <li>Opt out of marketing emails by clicking the &quot;Unsubscribe&quot; link in any email</li>
          <li>Opt out of text messages by replying STOP to any message</li>
          <li>Withdraw your consent to data processing at any time</li>
        </ul>
        <p>
          To exercise any of these rights, please contact us
          at <a href="mailto:hosthampton295@gmail.com" className="text-hampton-pink hover:underline">hosthampton295@gmail.com</a> or
          call <a href="tel:6319989325" className="text-hampton-pink hover:underline">(631) 998-9325</a>.
        </p>

        <h2 className="font-semibold text-lg mt-6">9. Third-Party Links</h2>
        <p>
          Our site may contain links to third-party websites. We are not responsible for the content or
          privacy practices of those sites. We encourage you to review the privacy policy of every site
          you visit.
        </p>

        <h2 className="font-semibold text-lg mt-6">10. Children&apos;s Privacy</h2>
        <p>
          Our website is not directed to children under the age of 13. We do not knowingly collect personal
          information from children under 13. If we learn that we have collected personal information from a
          child under 13, we will take steps to delete that information promptly. If you believe a child has
          provided us with personal information, please contact us.
        </p>

        <h2 className="font-semibold text-lg mt-6">11. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify you of material changes by
          posting the updated policy on this page and updating the &quot;Last updated&quot; date. Your
          continued use of our website or services after changes are posted constitutes your acceptance of
          the updated policy.
        </p>

        <h2 className="font-semibold text-lg mt-6">12. Contact Us</h2>
        <p>
          If you have questions about this Privacy Policy or our data practices, please contact us:
        </p>
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
