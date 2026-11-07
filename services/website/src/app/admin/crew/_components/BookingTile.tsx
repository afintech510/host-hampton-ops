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
import PartyCardView from '@/components/admin/PartyCardView'
import type { PartyCardData } from '@/lib/assistant/partyCard'
import type { BookingTile as Tile } from '@/lib/crewAppData'
import { PARTY_TYPE_LABELS } from '@/lib/pipelineStages'
import { specialStaffingOf, type SpecialStaffing } from '@/lib/crew/specialStaffing'
import { PAYMENT_LABELS, PAYMENT_STYLE, type PaymentStatus } from '@/lib/bookingStatus'
import { BTN_GHOST, Banner, money, useAdminApi } from './adminCrew'
import { load, useAdminData, warm } from './adminData'
import ContactButtons from './ContactButtons'
import PartyActions from './PartyActions'

export const TYPE_SHORT: Record<string, string> = {
  in_studio_theme: 'Theme Party',
  mobile_party: 'Mobile',
  studio_rental: 'Studio Rental',
}

/** "Sat", "Nov 7" from a YYYY-MM-DD, noon-anchored so the day never slips. */
export function dateBlock(ymd: string | null): { dow: string; md: string } {
  if (!ymd) return { dow: '—', md: 'No date' }
  const d = new Date(`${ymd}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return { dow: '—', md: ymd }
  return {
    dow: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    md: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  }
}

export function DateBlock({ date, time }: { date: string | null; time?: string | null }) {
  const { dow, md } = dateBlock(date)
  return (
    <div className="shrink-0 w-[4.25rem] rounded-xl bg-[#F6F1EB] py-2 text-center leading-tight">
      <div className="text-[11px] font-bold uppercase tracking-wide text-hampton-navy/60">{dow}</div>
      <div className="text-[15px] font-bold text-hampton-navy">{md}</div>
      {time && <div className="mt-0.5 text-[11px] text-hampton-navy/60">{time}</div>}
    </div>
  )
}

function crewChip(t: Tile) {
  if (!t.crew) return { text: 'Not in crew app', cls: 'bg-slate-100 text-slate-600' }
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
    <div className="rounded-xl bg-white border border-hampton-navy/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-wide text-hampton-navy/60">Staffing</div>
        <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${crewChip(tile).cls}`}>{crewChip(tile).text}</span>
      </div>
      {special.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="alert" data-special-staffing>
          <div className="font-bold text-amber-900">⚠ Special staffing</div>
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
        <ul className="mt-2 space-y-1 text-sm text-hampton-navy">
          {c.people.map((p, i) => (
            <li key={i} className="flex items-center justify-between gap-3">
              <span>
                {p.firstName}
                <span className="text-hampton-navy/50"> · {p.role === 'lead' ? 'Party Lead' : 'Crew'}</span>
              </span>
              <span className={p.confirmed ? 'text-emerald-700' : 'text-amber-700'}>{p.confirmed ? '✓ confirmed' : 'not confirmed'}</span>
            </li>
          ))}
        </ul>
      )}
      {c && c.people.length === 0 && c.status !== 'cancelled' && <p className="mt-2 text-sm text-hampton-navy/60">Nobody is on it yet.</p>}
      {!c && <p className="mt-2 text-sm text-hampton-navy/60">This booking is not on the crew schedule yet.</p>}
      <div className="mt-3 flex justify-center">
        {c ? (
          <Link href={`/admin/crew/parties/${c.partyId}`} prefetch className="inline-flex items-center justify-center text-sm font-semibold rounded-full px-5 py-2 min-h-[40px] bg-hampton-navy text-[#F6F1EB]">
            Manage staff
          </Link>
        ) : (
          <button className={BTN_GHOST} disabled={busy} onClick={importIt}>
            {busy ? 'Adding…' : 'Add to crew schedule'}
          </button>
        )}
      </div>
      {msg && <p className="mt-2 text-center text-sm text-hampton-navy/70">{msg}</p>}
    </div>
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
  const kid = tile.childName ? (/s$/i.test(tile.childName) ? `${tile.childName}' Party` : `${tile.childName}'s Party`) : null
  const owed = tile.balanceCents > 0

  return (
    <article className="bg-white rounded-2xl shadow-sm overflow-hidden" data-booking-tile data-ref={tile.ref}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full text-left p-3 active:bg-[#F6F1EB] flex gap-3 items-stretch">
        <DateBlock date={tile.partyDate} time={tile.partyTime} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[17px] font-semibold text-hampton-navy leading-tight truncate">{kid ?? tile.name}</div>
              {kid && <div className="text-sm text-hampton-navy/60 truncate">{tile.name}</div>}
            </div>
            <div className="text-right shrink-0">
              {owed ? (
                <div className="text-sm font-bold text-hampton-navy">{money(tile.balanceCents)}<span className="font-normal text-hampton-navy/50"> due</span></div>
              ) : (
                <div className="text-sm font-bold text-emerald-700">Paid</div>
              )}
              <div className="text-[11px] text-hampton-navy/50">of {money(tile.totalCents)}</div>
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-hampton-navy/10 text-hampton-navy">
              {TYPE_SHORT[tile.partyType ?? ''] ?? PARTY_TYPE_LABELS[tile.partyType || 'unknown'] ?? 'Party'}
            </span>
            {tile.guests ? <span className="text-[11px] text-hampton-navy/60">{tile.guests} guests</span> : null}
            <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${PAYMENT_STYLE[pay] ?? ''}`}>{PAYMENT_LABELS[pay] ?? tile.paymentStatus}</span>
            <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${chip.cls}`}>{chip.text}</span>
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-hampton-navy/10 p-3 space-y-3 bg-[#FBF8F4]">
          {detail.error && !detail.data && <Banner tone="warn">{detail.error}</Banner>}
          {detail.loading && <div className="text-sm text-hampton-navy/50 text-center">Loading the details…</div>}
          {detail.data && (
            <>
              <PartyCardView party={detail.data.card} />
              {detail.data.venue && (
                <div className="text-sm text-hampton-navy">
                  <span className="font-semibold">Venue:</span> {detail.data.venue}
                </div>
              )}
              {detail.data.adminNotes && (
                <div className="text-sm text-hampton-navy">
                  <span className="font-semibold">Notes:</span> {detail.data.adminNotes}
                </div>
              )}
            </>
          )}
          {detail.data && <ContactButtons bookingId={tile.id} phone={detail.data.card.contact.phone} email={detail.data.card.contact.email} />}
          <Staffing tile={tile} special={special} onChanged={() => { void load('/api/admin/crew-app/bookings') }} />
          <PartyActions bookingId={tile.id} bookingRef={tile.ref} />
        </div>
      )}
    </article>
  )
}
