import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Privacy Policy | Host Hampton' }

export default function PrivacyPolicy() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="font-serif text-3xl text-hampton-navy mb-6">Privacy Policy</h1>
      <div className="prose prose-sm text-hampton-navy space-y-4">
        <p className="text-hampton-mauve text-sm">Last updated: {new Date().getFullYear()}</p>
        <p>Host Hampton ("we", "us", or "our") operates hosthampton.com. This page informs you of our policies regarding the collection, use, and disclosure of personal information we receive from users of the site.</p>
        <h2 className="font-semibold text-lg mt-6">Information We Collect</h2>
        <p>We collect information you provide directly to us, such as when you make a booking, contact us, or sign up for our mailing list. This may include your name, email address, phone number, and event details.</p>
        <h2 className="font-semibold text-lg mt-6">How We Use Your Information</h2>
        <p>We use the information we collect to provide, maintain, and improve our services, process transactions, and communicate with you about your bookings and events.</p>
        <h2 className="font-semibold text-lg mt-6">Contact Us</h2>
        <p>If you have any questions about this Privacy Policy, please contact us at hosthampton295@gmail.com or call (631) 998-9325.</p>
      </div>
    </div>
  )
}
