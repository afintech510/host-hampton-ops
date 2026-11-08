import type { PartyCardData, PartyCardLine } from '@/lib/assistant/partyCard'
import type { ReactNode } from 'react'
import { dollars } from '@/lib/assistant/dollars'
import { etDateTime } from '@/lib/assistant/timeFormat'
import { CardField, CardSection } from './PartyTile'

/** An admin booking's details, grouped in the same order as an opened lead. */
export default function BookingDetails({ party, venue, adminNotes, contactActions }: { party: PartyCardData; venue: string | null; adminNotes: string | null; contactActions: ReactNode }) {
  const groups: Array<{ label: string; lines: PartyCardLine[] }> = [
    { label: 'Theme / package', lines: party.theme },
    { label: 'Activities', lines: party.activities },
    { label: 'Add-ons', lines: party.addOns },
    { label: 'Food & drinks', lines: party.food },
    { label: 'Desserts', lines: party.desserts },
    { label: 'Discounts', lines: party.discounts },
  ]
  const selected = groups.filter(g => g.lines.length > 0)
  return (
    <>
      <CardSection title="Contact">
        <dl className="mb-3 grid gap-3 sm:grid-cols-2">
          <CardField label="Host">{party.contact.name || 'Not provided'}</CardField>
          <CardField label="Booking reference">{party.ref}</CardField>
          <CardField label="Phone">{party.contact.phone ? <a href={`tel:${party.contact.phone}`} className="underline decoration-hampton-navy/25 underline-offset-4">{party.contact.phone}</a> : 'Not provided'}</CardField>
          <CardField label="Email">{party.contact.email ? <a href={`mailto:${party.contact.email}`} className="underline decoration-hampton-navy/25 underline-offset-4">{party.contact.email}</a> : 'Not provided'}</CardField>
        </dl>
        {contactActions}
      </CardSection>
      <CardSection title="Party details">
        <dl className="grid gap-3 sm:grid-cols-2">
          <CardField label="Party type">{party.type}</CardField>
          <CardField label="Date & time">{party.when || 'Not set'}</CardField>
          {party.child.name && <CardField label="Celebrating">{party.child.name}{party.child.age ? ` · Turning ${party.child.age}` : ''}</CardField>}
          <CardField label="Guests">{party.guests ?? 'Not set'}</CardField>
          <CardField label="Booking status">{party.status}</CardField>
          {venue && <CardField label="Venue">{venue}</CardField>}
        </dl>
      </CardSection>
      <CardSection title="Party plan">
        {selected.length > 0 || party.extraGuests ? (
          <dl className="space-y-3">
            {selected.map(g => (
              <CardField key={g.label} label={g.label}>
                <ul className="space-y-1">
                  {g.lines.map((line, i) => <li key={i}>{line.text}{line.optional && <span className="ml-1 text-xs text-hampton-navy/70">(optional)</span>}</li>)}
                </ul>
              </CardField>
            ))}
            {party.extraGuests && <CardField label="Extra guests">{party.extraGuests.text}</CardField>}
          </dl>
        ) : <p className="text-sm text-hampton-navy/70">No selections added yet.</p>}
      </CardSection>
      <CardSection title="Payment summary">
        <dl className="grid grid-cols-3 gap-3 rounded-xl border border-hampton-navy/10 bg-white p-3 sm:p-4">
          <CardField label="Total">{party.totalCents > 0 ? dollars(party.totalCents) : 'Not priced'}</CardField>
          <CardField label="Paid">{dollars(party.paidCents)}</CardField>
          <CardField label="Balance"><span className="font-semibold">{party.totalCents > 0 ? dollars(party.owedCents) : 'Not priced'}</span></CardField>
          {party.tipCents > 0 && <CardField label="Tip">{dollars(party.tipCents)}</CardField>}
        </dl>
        <p className="mt-2 text-[11px] text-hampton-navy/70">Updated {etDateTime(party.asOf)}</p>
      </CardSection>
      {adminNotes && <CardSection title="Internal notes"><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-hampton-navy/75">{adminNotes}</p></CardSection>}
    </>
  )
}
