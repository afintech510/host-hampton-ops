import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Privacy Policy | Host Hampton' }

export default function PrivacyPolicy() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="font-serif text-3xl text-hampton-navy mb-6">Privacy Policy</h1>
      <div className="prose prose-sm text-hampton-navy space-y-4">
        <p className="text-hampton-mauve text-sm">Last updated: {new Date().getFullYear()}</p>

        <p>
          Host Hampton (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) operates hosthampton.com.
          This page informs you of our policies regarding the collection, use, and disclosure
          of personal information when you use our website and services.
        </p>

        <h2 className="font-semibold text-lg mt-6">Information We Collect</h2>
        <p>
          We collect information you provide directly, such as when you make a booking, submit
          an inquiry form, purchase event tickets, sign up for our mailing list, or contact us.
          This may include your name, email address, phone number, mailing address, payment
          information, and event details.
        </p>
        <p>
          We also automatically collect certain information when you visit our site, including
          your IP address, browser type, referring/exit pages, and pages viewed. We use cookies
          and similar tracking technologies to track activity on our site and hold certain
          information.
        </p>

        <h2 className="font-semibold text-lg mt-6">How We Use Your Information</h2>
        <p>We use the information we collect to:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Provide, maintain, and improve our services</li>
          <li>Process transactions and send related information (confirmations, receipts)</li>
          <li>Send you updates about your bookings, events, and reservations</li>
          <li>Respond to your comments, questions, and customer service requests</li>
          <li>Communicate promotional offers, news, and other information about our services (you may opt out at any time)</li>
          <li>Monitor and analyze trends, usage, and activities to improve our site</li>
        </ul>

        <h2 className="font-semibold text-lg mt-6">Cookies</h2>
        <p>
          We use cookies and similar tracking technologies to track activity on our website and
          hold certain information. Cookies are files with a small amount of data which may
          include an anonymous unique identifier. You can instruct your browser to refuse all
          cookies or to indicate when a cookie is being sent.
        </p>

        <h2 className="font-semibold text-lg mt-6">Information Sharing</h2>
        <p>
          We do not sell, trade, or rent your personal information to third parties. We may share
          your information with trusted service providers who assist us in operating our website,
          conducting our business, or serving our users, so long as those parties agree to keep
          this information confidential. We may also release your information when required by law
          or to protect rights, property, or safety.
        </p>

        <h2 className="font-semibold text-lg mt-6">Data Security</h2>
        <p>
          The security of your personal information is important to us. We implement a variety of
          security measures to maintain the safety of your personal information. However, no
          method of transmission over the Internet or electronic storage is 100% secure, and we
          cannot guarantee absolute security.
        </p>

        <h2 className="font-semibold text-lg mt-6">Your Rights</h2>
        <p>
          You have the right to access, correct, or delete the personal information we hold about
          you. You may also opt out of receiving promotional emails by following the unsubscribe
          link in any email we send. To exercise any of these rights, please contact us using the
          information below.
        </p>

        <h2 className="font-semibold text-lg mt-6">Third-Party Links</h2>
        <p>
          Our site may contain links to third-party websites. We have no control over and assume
          no responsibility for the content, privacy policies, or practices of any third-party
          sites or services. We encourage you to review the privacy policy of every site you visit.
        </p>

        <h2 className="font-semibold text-lg mt-6">Children&apos;s Privacy</h2>
        <p>
          Our services do not address anyone under the age of 13. We do not knowingly collect
          personal information from children under 13. If we become aware that we have collected
          personal information from a child under 13 without parental consent, we will take steps
          to remove that information.
        </p>

        <h2 className="font-semibold text-lg mt-6">SMS / Text Messaging Privacy</h2>
        <p>
          Host Hampton may send SMS or text messages to customers who opt in, including booking
          confirmations, event reminders, and promotional updates. Your mobile information will
          not be shared with or sold to third parties or affiliates for marketing or promotional
          purposes. You may opt out of text messages at any time by replying <strong>STOP</strong> to
          any message. Message and data rates may apply. Message frequency varies.
        </p>

        <h2 className="font-semibold text-lg mt-6">Changes to This Policy</h2>
        <p>
          We may update our Privacy Policy from time to time. We will notify you of any changes by
          posting the new Privacy Policy on this page and updating the &quot;Last updated&quot; date.
          Changes are effective immediately upon posting.
        </p>

        <h2 className="font-semibold text-lg mt-6">Contact Us</h2>
        <p>
          If you have any questions about this Privacy Policy, please contact us
          at <a href="mailto:hosthampton295@gmail.com" className="text-hampton-pink hover:underline">hosthampton295@gmail.com</a> or
          call <a href="tel:6319989325" className="text-hampton-pink hover:underline">(631) 998-9325</a>.
        </p>
      </div>
    </div>
  )
}
