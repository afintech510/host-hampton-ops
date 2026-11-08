'use client'

/**
 * One booked party as a tile: a date block, who it is for, what kind, and the two
 * things you scan for - what is still owed and whether the crew is covered. Tap it
 * and it opens to everything: the full party card, the venue for a mobile party, the
 * admin notes, who is staffed (with a button to the party-staff page), and the link
 * buttons.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Users } from 'lucide-react'
import PartyTile, { CARD_ACTION, CardBadge, CardSection, partyTitle } from './PartyTile'
import BookingDetails from './BookingDetails'
import type { PartyCardData } from '@/lib/assistant/partyCard'
import type { BookingTile as Tile } from '@/lib/crewAppData'
import { specialStaffingOf, type SpecialStaffing } from '@/lib/crew/specialStaffing'
import { PAYMENT_LABELS, PAYMENT_STYLE, STAGE_LABELS, STAGE_STYLE, type BookingStage, type PaymentStatus } from '@/lib/bookingStatus'
import { Banner, useAdminApi } from './adminCrew'
import { dollars as money } from '@/lib/assistant/dollars'
import { load, useAdminData, warm } from './adminData'
import ContactButtons from './ContactButtons'
import PartyActions from './PartyActions'

function crewChip(t: Tile) {
  if (!t.crew) return { text: 'Not scheduled', cls: 'bg-slate-100 text-slate-600' }
  const { needed, staffed, status } = t.crew
  if (status === 'cancelled') return { text: 'Crew cancelled', cls: 'bg-red-100 text-red-700' }
  const text = `Crew ${staffed}/${needed}${status === 'draft' ? ' · draft' : ''}`
  if (needed > 0 && staffed >= needed) return { text, cls: 'bg-emerald-100 text-emerald-800' }
  return { text, cls: staffed === 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800' }
}

function Staffing({ tile, special, onChanged }: { tile: Tile; special: SpecialStaffing[]; onChanged: () => void }) {
  const api = useAdminApi()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function importIt() {
    setBusy(true)
    setMsg('')
    const r = await api<{ summary?: { created?: number; errors?: string[] }; error?: string }>(
      `/api/admin/crew/sync?booking=${encodeURIComponent(tile.ref)}`,
      { method: 'POST', body: {} },
    )
    setBusy(false)
    if (!r.ok && r.status !== 207) {
      setMsg(r.data.error || 'Could not add it to the crew schedule.')
      return
    }
    const s = r.data.summary
    if (s?.errors?.length) setMsg(s.errors[0])
    else if (!s?.created) setMsg('Nothing was added: it may need a start time or address first, or it is already there.')
    else setMsg('Added as a draft. Publish it from the party-staff page when you are ready.')
    onChanged()
  }

  const c = tile.crew
  return (
    <CardSection title="Staffing">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-hampton-navy/70">Crew coverage</span>
        <CardBadge className={crewChip(tile).cls}>{crewChip(tile).text}</CardBadge>
      </div>
      {special.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="alert" data-special-staffing>
          <div className="flex items-center gap-2 font-semibold text-amber-900"><AlertCircle size={16} aria-hidden="true" />Special staffing</div>
          <ul className="mt-1 space-y-1">
            {special.map((sp, i) => (
              <li key={i}>
                <span className="font-semibold">{sp.label}{sp.quantity > 1 ? ` ×${sp.quantity}` : ''}</span>
                <div className="text-xs text-amber-900/80">{sp.action}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {c && c.people.length > 0 && (
        <ul className="mt-3 divide-y divide-hampton-navy/10 text-sm text-hampton-navy">
          {c.people.map((p, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
              <span>
                {p.firstName}
                <span className="text-hampton-navy/70"> · {p.role === 'lead' ? 'Party Lead' : 'Crew'}</span>
              </span>
              <span className={p.confirmed ? 'text-emerald-700' : 'text-amber-700'}>{p.confirmed ? 'Confirmed' : 'Awaiting confirmation'}</span>
            </li>
          ))}
        </ul>
      )}
      {c && c.people.length === 0 && c.status !== 'cancelled' && <p className="mt-2 text-sm text-hampton-navy/70">Nobody is on it yet.</p>}
      {!c && <p className="mt-2 text-sm text-hampton-navy/70">This booking is not on the crew schedule yet.</p>}
      <div className="mt-3 flex">
        {c ? (
          <Link href={`/admin/crew/parties/${c.partyId}`} prefetch className={`${CARD_ACTION} w-full sm:w-auto !bg-hampton-navy !text-white`}>
            Manage staff
          </Link>
        ) : (
          <button className={`${CARD_ACTION} w-full sm:w-auto`} disabled={busy} onClick={importIt}>
            {busy ? 'Adding…' : 'Add to crew schedule'}
          </button>
        )}
      </div>
      {msg && <p role="status" className="mt-2 text-sm text-hampton-navy/70">{msg}</p>}
    </CardSection>
  )
}

export default function BookingTile({ tile, open, onToggle }: { tile: Tile; open: boolean; onToggle: () => void }) {
  const detail = useAdminData<{ card: PartyCardData; venue: string | null; adminNotes: string | null }>(open ? `/api/admin/crew-app/booking/${tile.id}` : null, 120_000)
  const chip = crewChip(tile)
  // The party-staff page behind "Manage staff" is ready before it is tapped.
  const crewPartyId = tile.crew?.partyId
  useEffect(() => {
    if (open && crewPartyId) warm([`/api/admin/crew/parties/${crewPartyId}`])
  }, [open, crewPartyId])
  // What was bought that needs a particular person: a Party Helper, a face painter, a character.
  const special = detail.data ? specialStaffingOf(detail.data.card.addOns.map(l => ({ name: l.name, quantity: l.quantity, is_optional: l.optional }))) : []
  const pay = tile.paymentStatus as PaymentStatus
  const subtitle = [tile.childName ? `Hosted by ${tile.name}` : 'Booked party', tile.childAge ? `Turning ${tile.childAge}` : null].filter(Boolean).join(' · ')
  const priced = tile.totalCents > 0
  const owed = tile.balanceCents > 0

  return (
    <PartyTile
      kind="booking"
      bookingRef={tile.ref}
      title={partyTitle(tile.childName, tile.name)}
      subtitle={subtitle}
      partyType={tile.partyType}
      date={tile.partyDate}
      time={tile.partyTime}
      guests={tile.guests}
      badge={tile.stage === 'completed' || tile.stage === 'cancelled' || tile.stage === 'lost'
        ? <CardBadge className={STAGE_STYLE[tile.stage as BookingStage]}>{STAGE_LABELS[tile.stage as BookingStage]}</CardBadge>
        : <CardBadge className={PAYMENT_STYLE[pay]}>{PAYMENT_LABELS[pay] ?? tile.paymentStatus}</CardBadge>}
      amountLabel="Balance due"
      amount={!priced ? 'Not priced' : owed ? money(tile.balanceCents) : <span className="text-emerald-700">{money(0)}</span>}
      amountHint={priced ? `of ${money(tile.totalCents)}` : undefined}
      context={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${chip.cls}`}><Users size={13} aria-hidden="true" />{chip.text}</span>
          {tile.crew && tile.crew.status !== 'cancelled' && (
            <span className="text-[11px] text-hampton-navy/70">
              {tile.crew.staffed < tile.crew.needed ? `${tile.crew.needed - tile.crew.staffed} open` : tile.crew.needed > 0 ? 'All spots filled' : 'No spots set'}
            </span>
          )}
        </span>
      }
      open={open}
      onToggle={onToggle}
    >
      {detail.error && !detail.data && <Banner tone="warn">{detail.error}</Banner>}
      {detail.loading && <div role="status" className="text-sm text-hampton-navy/70">Loading party details…</div>}
      {detail.data && (
        <BookingDetails
          party={detail.data.card}
          venue={detail.data.venue}
          adminNotes={detail.data.adminNotes}
          contactActions={<ContactButtons bookingId={tile.id} phone={detail.data.card.contact.phone} email={detail.data.card.contact.email} />}
        />
      )}
      <Staffing tile={tile} special={special} onChanged={() => { void load('/api/admin/crew-app/bookings') }} />
      <PartyActions bookingId={tile.id} bookingRef={tile.ref} />
    </PartyTile>
  )
}
