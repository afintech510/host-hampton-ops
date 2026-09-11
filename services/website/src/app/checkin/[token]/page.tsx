import type { Metadata } from 'next'
import { resolveCheckinToken, requiresRentalAgreement } from '@/lib/checkinLink'
import CheckinForm from './CheckinForm'

export const dynamic = 'force-dynamic'

// A tokenised page with a customer's details on it must never be indexed or
// cached by a crawler.
export const metadata: Metadata = {
  title: 'Party Check-In | Host Hampton',
  robots: { index: false, follow: false },
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-24 text-center">
      <h1 className="font-serif text-3xl font-bold text-hampton-navy mb-3">{title}</h1>
      <div className="text-hampton-navy/70">{children}</div>
    </div>
  )
}

export default async function CheckinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await resolveCheckinToken(token)

  // Nothing about the booking is rendered until the token resolves.
  if (!result.ok) {
    return result.reason === 'expired' ? (
      <Shell title="This check-in link has expired">
        <p>
          Check-in links stop working after your party date. If you still need to reach us, give us a
          call or reply to your confirmation text and we&apos;ll sort it out.
        </p>
      </Shell>
    ) : (
      <Shell title="We couldn&apos;t find that check-in link">
        <p>
          The link may have been mistyped or copied incompletely. Try tapping it directly from your
          text message, or contact us and we&apos;ll send a fresh one.
        </p>
      </Shell>
    )
  }

  const b = result.booking

  return (
    <CheckinForm
      token={token}
      bookingRef={String(b.booking_ref)}
      partyDate={b.party_date ? String(b.party_date) : null}
      partyTime={b.party_time ? String(b.party_time) : null}
      childName={b.child_name ? String(b.child_name) : null}
      checkinStatus={String(b.checkin_status ?? 'pending')}
      agreementSigned={!!b.checkin_agreement_signed_at}
      requiresAgreement={requiresRentalAgreement(b)}
      initial={{
        name: String(b.contact_name ?? ''),
        email: String(b.contact_email ?? ''),
        phone: String(b.contact_phone ?? ''),
        addressLine1: String(b.checkin_address_line1 ?? ''),
        addressLine2: String(b.checkin_address_line2 ?? ''),
        city: String(b.checkin_city ?? ''),
        state: String(b.checkin_state ?? ''),
        postalCode: String(b.checkin_postal_code ?? ''),
      }}
    />
  )
}
