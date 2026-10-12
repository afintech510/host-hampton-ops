import type { Metadata } from 'next'

// The root layout appends ' | Host Hampton'; naming it here rendered it twice.
export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Host Hampton collects, uses and protects your personal information, and the choices you have.',
}

export default function PrivacyPolicy() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="font-serif text-3xl text-hampton-navy mb-6">Privacy Policy</h1>
      <div className="prose prose-sm text-hampton-navy space-y-4">
        <p className="text-hampton-mauve text-sm">Last updated: October 11, 2026</p>

        <p>
          Host Hampton LLC (&quot;Host Hampton,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates
          the website <a href="https://www.hosthampton.com" className="text-hampton-pink hover:underline">www.hosthampton.com</a> and
          provides themed birthday parties, event hosting, room rentals, permanent jewelry services, and community
          events at our studio located at 295 Montauk Highway, Speonk, NY 11972.
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
          Analytics, advertising pixels, and similar tracking technologies to understand how our site is used
          and to measure and target our advertising. Sections 4 and 6 describe this in detail, including how to
          opt out. Our online party invitations are handled differently; section 12 explains how.
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
          We use cookies, web beacons, pixels, and similar technologies to collect information about how you
          interact with our website. These include:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Google Analytics</strong> — to understand how our site is used</li>
          <li><strong>Google Ads conversion tracking and remarketing</strong> — to measure our advertising and
            show our ads to people who have visited our site</li>
          <li><strong>Meta Pixel</strong> (Facebook and Instagram) — to measure our advertising and show our
            ads to people who have visited our site</li>
        </ul>
        <p>
          These technologies record information such as the pages you view, the links you click, and general
          device and browser details. <strong>We do not use them to collect your name, email address, or phone
          number.</strong> We have deliberately turned off the optional &quot;advanced matching&quot; feature
          that would share hashed contact details with Meta.
        </p>
        <p>
          You can control cookie preferences through your browser settings. Disabling cookies may affect your
          experience on our site. See section 6 below for how to opt out of interest-based advertising
          specifically.
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
          <li><strong>Advertising:</strong> Google Ads and Meta (Facebook and Instagram) — browsing activity
            only, for measuring our ads and showing them to past visitors</li>
          <li><strong>Customer support:</strong> Crisp (for live chat)</li>
        </ul>
        <p>
          We want to be precise about the advertising entry above, because some privacy laws use the word
          &quot;sharing&quot; broadly. We do not receive any payment for it and we do not hand over customer
          lists. What happens is that the advertising pixels described in section 4 let Google and Meta
          recognize a browser that has visited our site, so that we can show that browser our ads later. If
          you would rather that did not happen, section 6 explains how to stop it.
        </p>
        <p>
          These service providers are contractually obligated to protect your information and may only use it
          to provide services on our behalf. We may also disclose your information when required by law, to
          protect our rights or safety, or to comply with a legal process.
        </p>

        <h2 className="font-semibold text-lg mt-6">6. Interest-Based Advertising and Your Choices</h2>
        <p>
          We advertise on Google and on Meta&apos;s platforms (Facebook and Instagram). Using the pixels
          described in section 4, these platforms may show you our ads after you have visited our website —
          for example, reminding you about a party package you looked at, or about an upcoming event at the
          studio. This is commonly called remarketing or interest-based advertising.
        </p>
        <p>You can opt out at any time, and you do not need to contact us to do it:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Google:</strong> adjust your{' '}
            <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer"
               className="text-hampton-pink hover:underline">Google Ads Settings</a>
          </li>
          <li>
            <strong>Meta:</strong> adjust your ad preferences in your{' '}
            <a href="https://www.facebook.com/settings?tab=ads" target="_blank" rel="noopener noreferrer"
               className="text-hampton-pink hover:underline">Facebook settings</a>
          </li>
          <li>
            <strong>Industry-wide:</strong> use the{' '}
            <a href="https://optout.aboutads.info" target="_blank" rel="noopener noreferrer"
               className="text-hampton-pink hover:underline">Digital Advertising Alliance opt-out</a> or the{' '}
            <a href="https://optout.networkadvertising.org" target="_blank" rel="noopener noreferrer"
               className="text-hampton-pink hover:underline">Network Advertising Initiative opt-out</a>
          </li>
          <li>
            <strong>Browser signal:</strong> we honor the Global Privacy Control (GPC) signal if your browser
            or extension sends one
          </li>
        </ul>
        <p>
          <strong>Phone numbers are never used for advertising.</strong> As stated in section 3, phone numbers
          collected through our SMS program are not transferred to any third party, and that includes
          advertising platforms. We do not upload phone numbers to Google or Meta for any purpose.
        </p>

        <h2 className="font-semibold text-lg mt-6">7. Data Security</h2>
        <p>
          We implement reasonable technical and organizational measures to protect your personal information
          against unauthorized access, alteration, disclosure, or destruction. Payment information is processed
          through Stripe&apos;s PCI-compliant infrastructure and is never stored on our servers. However, no
          method of transmission over the Internet is 100% secure, and we cannot guarantee absolute security.
        </p>

        <h2 className="font-semibold text-lg mt-6">8. Data Retention</h2>
        <p>
          We retain your personal information for as long as necessary to fulfill the purposes for which it
          was collected, including to satisfy legal, accounting, or reporting requirements. Phone numbers
          collected for SMS messaging are retained until you opt out or request deletion. When you opt out of
          SMS, your phone number is flagged as opted-out and no further marketing messages are sent.
        </p>

        <h2 className="font-semibold text-lg mt-6">9. Your Rights</h2>
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

        <h2 className="font-semibold text-lg mt-6">10. Third-Party Links</h2>
        <p>
          Our site may contain links to third-party websites. We are not responsible for the content or
          privacy practices of those sites. We encourage you to review the privacy policy of every site
          you visit.
        </p>

        <h2 className="font-semibold text-lg mt-6">11. Children&apos;s Privacy</h2>
        <p>
          Our website is not directed to children under the age of 13. We do not knowingly collect personal
          information from children under 13. If we learn that we have collected personal information from a
          child under 13, we will take steps to delete that information promptly. If you believe a child has
          provided us with personal information, please contact us. Section 12 explains how we handle the
          first names of children that a parent or guardian includes on a party invitation RSVP.
        </p>

        <h2 className="font-semibold text-lg mt-6">12. Party Invitations and RSVPs</h2>
        <p>
          When you book a party, we may create an online invitation for it. The host family can share the
          invitation&apos;s private link with their guests, and guests can RSVP on it. This section explains what
          that involves. It applies to the invitation pages on our website (their addresses begin
          with <strong>hosthampton.com/i/</strong>) and to the emails we send about them.
        </p>

        <h3 className="font-semibold text-base mt-4">What a guest provides when RSVPing</h3>
        <p>When a guest RSVPs, they give us:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>A parent or guardian&apos;s name</li>
          <li>The <strong>first names only</strong> of the children attending, and the number of adults coming</li>
          <li>Optionally, a note about a food allergy</li>
          <li>Optionally, a short note to the birthday child</li>
          <li>Optionally, an email address for reminders (or a mobile number, instead of an email)</li>
        </ul>
        <p>
          A guest does not need to create an account. Giving a mobile number for an RSVP does not sign
          you up for our text-message program described in section 3, and reminders are sent by email.
        </p>

        <h3 className="font-semibold text-base mt-4">Who can see RSVP details</h3>
        <p>
          Only the host family and Host Hampton staff can see RSVP details. The invitation page itself shows
          no guest list and no counts of who is coming. We do not sell RSVP information or use it for
          advertising.
        </p>

        <h3 className="font-semibold text-base mt-4">Reminder emails</h3>
        <p>
          If a guest gives an email address for reminders, we use it only to send emails about that party:
          a confirmation, a reminder the week before and the day before, notice of any change to the date or
          place, and notice if the party is cancelled. Every one of these emails contains a &quot;Stop
          reminders&quot; link, and a guest can also change or withdraw their RSVP at any time using the
          private link in those emails. These are not marketing emails.
        </p>

        <h3 className="font-semibold text-base mt-4">How long we keep it</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Allergy notes</strong> are deleted 7 days after the party.</li>
          <li><strong>Reminder email addresses, mobile numbers, and the IP address</strong> recorded with an
            RSVP are deleted 30 days after the party, unless the guest joined the Birthday Club (below).</li>
          <li><strong>Invitations are taken offline</strong> 30 days after the party. An invitation made
            for a party that was never booked is taken offline 60 days after it was created, or once the
            party date has passed, whichever comes first.</li>
        </ul>

        <h3 className="font-semibold text-base mt-4">The Birthday Club (optional)</h3>
        <p>
          On the RSVP form there is an <strong>unchecked</strong> box to join the Host Hampton Birthday Club.
          It is entirely optional and RSVPing works exactly the same without it. If a guest ticks it, we
          use their email address to send party and craft ideas, and we keep a record of that consent: the
          exact wording that was shown next to the box, the date and time, and the IP address it came from.
          We keep that record, and the email address, until the guest unsubscribes. They can unsubscribe at
          any time using the link in any Birthday Club email or by contacting us, and we then stop emailing them.
          Joining the Birthday Club is separate from our other marketing lists and from text messaging.
        </p>

        <h3 className="font-semibold text-base mt-4">Invitation pages are private</h3>
        <p>
          Invitation pages are not indexed by search engines and ask browsers not to pass the page address
          on to other sites. Each invitation is protected by an unguessable link, so only people the host
          family shares it with are likely to find it. Anyone who has the link can see the invitation and
          RSVP, so please share it only with the people you mean to invite.
        </p>

        <h3 className="font-semibold text-base mt-4">Measurement on invitation pages</h3>
        <p>
          We measure how invitations are used, in a deliberately limited way. Google Analytics receives only
          a generic page address for invitation pages, never the invitation&apos;s own link and never any
          names. <strong>No Google Ads tag and no Meta Pixel runs on invitation pages.</strong> When an
          invitation page is viewed, we may send a single anonymous &quot;page viewed&quot; event to Meta
          through its Conversions API, to help us measure our advertising. That event does not contain any
          names, email addresses, phone numbers, or the invitation&apos;s link.
        </p>

        <h3 className="font-semibold text-base mt-4">Children&apos;s information</h3>
        <p>
          The only information about a child on an invitation or RSVP is a first name, and it is provided by a
          parent or guardian: the host family when they book, and the parent or guardian of a guest when they
          RSVP. We do not ask children for information, and invitations are not directed to children.
        </p>

        <h2 className="font-semibold text-lg mt-6">13. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify you of material changes by
          posting the updated policy on this page and updating the &quot;Last updated&quot; date. Your
          continued use of our website or services after changes are posted constitutes your acceptance of
          the updated policy.
        </p>

        <h2 className="font-semibold text-lg mt-6">14. Contact Us</h2>
        <p>
          If you have questions about this Privacy Policy or our data practices, please contact us:
        </p>
        <ul className="list-none pl-0 space-y-1">
          <li><strong>Host Hampton LLC</strong></li>
          <li>295 Montauk Highway</li>
          <li>Speonk, NY 11972</li>
          <li>Email: <a href="mailto:hosthampton295@gmail.com" className="text-hampton-pink hover:underline">hosthampton295@gmail.com</a></li>
          <li>Phone: <a href="tel:6319989325" className="text-hampton-pink hover:underline">(631) 998-9325</a></li>
        </ul>
      </div>
    </div>
  )
}
