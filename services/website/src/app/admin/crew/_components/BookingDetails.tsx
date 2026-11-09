import type { PartyCardData, PartyCardLine } from '@/lib/assistant/partyCard'
import type { ReactNode } from 'react'
import { dollars } from '@/lib/assistant/dollars'
import { etDateTime } from '@/lib/assistant/timeFormat'
import { CARD_GRID, CardField, CardSection } from './PartyTile'

/**
 * An admin booking's details, built to be short on a phone: two columns throughout.
 *
 *   top block   WHO on the left (host, phone, email, the child, status) and WHAT/WHEN on the
 *               right, right-justified (booking reference, date and time, type, guests, venue),
 *               then the three contact buttons on one row;
 *   party plan  the selection groups two across;
 *   payment     one row of figures, the "updated" time on the title line.
 */
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
      <section>
        <dl className={CARD_GRID}>
          <CardField label="Host">{party.contact.name || 'Not provided'}</CardField>
          <CardField label="Booking reference" right>{party.ref}</CardField>
          <CardField label="Phone">{party.contact.phone ? <a href={`tel:${party.contact.phone}`} className="underline decoration-hampton-navy/25 underline-offset-4">{party.contact.phone}</a> : 'Not provided'}</CardField>
          <CardField label="Date & time" right>{party.when || 'Not set'}</CardField>
          <CardField label="Email">{party.contact.email ? <a href={`mailto:${party.contact.email}`} className="underline decoration-hampton-navy/25 underline-offset-4">{party.contact.email}</a> : 'Not provided'}</CardField>
          <CardField label="Party type" right>{party.type}</CardField>
          <CardField label="Celebrating">{party.child.name ? `${party.child.name}${party.child.age ? ` · turning ${party.child.age}` : ''}` : 'Not given'}</CardField>
          <CardField label="Guests" right>{party.guests ?? 'Not set'}</CardField>
          <CardField label="Booking status">{party.status}</CardField>
          {venue ? <CardField label="Venue" right>{venue}</CardField> : <span />}
        </dl>
        <div className="mt-3">{contactActions}</div>
      </section>
      <CardSection title="Party plan">
        {selected.length > 0 || party.extraGuests ? (
          <dl className={CARD_GRID}>
            {selected.map(g => (
              <CardField key={g.label} label={g.label}>
                <ul className="space-y-0.5">
                  {g.lines.map((line, i) => <li key={i}>{line.text}{line.optional && <span className="ml-1 text-xs text-hampton-navy/70">(optional)</span>}</li>)}
                </ul>
              </CardField>
            ))}
            {party.extraGuests && <CardField label="Extra guests">{party.extraGuests.text}</CardField>}
          </dl>
        ) : <p className="text-sm text-hampton-navy/70">No selections added yet.</p>}
      </CardSection>
      <CardSection title="Payment summary" aside={`Updated ${etDateTime(party.asOf)}`}>
        <dl className={`grid gap-x-3 rounded-xl border border-hampton-navy/10 bg-white p-2.5 sm:p-3 ${party.tipCents > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
          <CardField label="Total">{party.totalCents > 0 ? dollars(party.totalCents) : 'Not priced'}</CardField>
          <CardField label="Paid">{dollars(party.paidCents)}</CardField>
          <CardField label="Balance"><span className="font-semibold">{party.totalCents > 0 ? dollars(party.owedCents) : 'Not priced'}</span></CardField>
          {party.tipCents > 0 && <CardField label="Tip">{dollars(party.tipCents)}</CardField>}
        </dl>
      </CardSection>
      {adminNotes && <CardSection title="Internal notes"><p className="whitespace-pre-wrap break-words text-sm leading-snug text-hampton-navy/75">{adminNotes}</p></CardSection>}
    </>
  )
}
