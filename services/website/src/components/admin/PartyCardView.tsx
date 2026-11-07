'use client'

import type { PartyCardData, PartyCardLine } from '@/lib/assistant/partyCard'
import { dollars } from '@/lib/assistant/dollars'
import { etDateTime } from '@/lib/assistant/timeFormat'

/**
 * Everything about one party on one card, in the order the manager reads it:
 *
 *   <Child>'s Party
 *   Contact name / phone / email
 *   When, type, child, guests, status
 *   Theme, activities, add-ons, food, desserts, extra guests
 *   Total, paid, owed, tip
 *
 * Shown in the assistant chat whenever the conversation is about that party. It is
 * a snapshot (the small "as of" line says when), display only: no button on it
 * changes anything.
 */

const none = <span className="text-hampton-navy/50">none</span>

function Lines({ lines }: { lines: PartyCardLine[] }) {
  if (lines.length === 0) return none
  return (
    <>
      {lines.map((l, i) => (
        <span key={i}>
          {i > 0 && '; '}
          {l.text}
        </span>
      ))}
    </>
  )
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-1.5">
      <span aria-hidden="true">•</span>
      <span>
        <span className="font-semibold">{label}:</span> {children}
      </span>
    </li>
  )
}

export default function PartyCardView({ party }: { party: PartyCardData }) {
  const kid = [party.child.name, party.child.age ? `${party.child.age}` : null].filter(Boolean).join(' / ')
  return (
    <section
      className="bg-white border-2 border-hampton-navy/20 rounded-xl p-4 text-sm text-hampton-navy"
      aria-label={`Party ${party.ref}`}
      data-party-card
      data-ref={party.ref}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-bold text-base leading-tight">{party.title}</h3>
        <a href={party.adminUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline shrink-0 mt-0.5">
          {party.ref}
        </a>
      </div>

      <div className="mt-2 space-y-0.5">
        <div><span className="font-semibold">Contact Name:</span> {party.contact.name || '—'}</div>
        <div>
          <span className="font-semibold">Phone:</span>{' '}
          {party.contact.phone ? <a className="underline" href={`tel:${party.contact.phone}`}>{party.contact.phone}</a> : '—'}
        </div>
        <div>
          <span className="font-semibold">Email:</span>{' '}
          {party.contact.email ? <a className="underline break-all" href={`mailto:${party.contact.email}`}>{party.contact.email}</a> : '—'}
        </div>
      </div>

      <ul className="mt-3 space-y-0.5">
        <Item label="When">{party.when ?? 'No date yet'}</Item>
        <Item label="Type">{party.type}</Item>
        <Item label="Child's Name / Age">{kid || '—'}</Item>
        <Item label="Guests">{party.guests ?? '—'}</Item>
        <Item label="Status">{party.status}</Item>
        <Item label="Theme"><Lines lines={party.theme} /></Item>
        <Item label="Activities"><Lines lines={party.activities} /></Item>
        <Item label="Add-ons"><Lines lines={party.addOns} /></Item>
        <Item label="Food"><Lines lines={party.food} /></Item>
        <Item label="Desserts"><Lines lines={party.desserts} /></Item>
        {party.discounts.length > 0 && <Item label="Discounts"><Lines lines={party.discounts} /></Item>}
        <Item label="Extra guests">{party.extraGuests ? party.extraGuests.text : none}</Item>
      </ul>

      <ul className="mt-3 space-y-0.5">
        <Item label="Total">{dollars(party.totalCents)}</Item>
        <Item label="Paid">{dollars(party.paidCents)}</Item>
        <Item label="Owed">{dollars(party.owedCents)}</Item>
        <Item label="Tip">{party.tipCents > 0 ? dollars(party.tipCents) : none}</Item>
      </ul>

      <p className="mt-2 text-[11px] text-hampton-navy/50">As of {etDateTime(party.asOf)}</p>
    </section>
  )
}
