'use client'

/**
 * /admin/crew/leads - the open leads as tiles, phone first, in the same format as
 * Bookings: pull buttons for the kind of party and the month / week it is for, then a
 * tile per lead, the one in touch most recently on top. Tapping a tile opens
 * everything about the party and the buttons to copy or view the invoice, open the
 * planner, or ask the AI assistant to make a change. Nothing here changes a booking or
 * sends anything: the buttons mint a link for YOU (the same ones the Parties tab
 * makes), and the assistant, as always, only proposes cards that you confirm.
 */

import { useMemo, useState } from 'react'
import type { LeadCard } from '@/lib/leadCards'
import { PARTY_TYPE_LABELS } from '@/lib/pipelineStages'
import { STAGE_LABELS, STAGE_STYLE } from '@/lib/bookingStatus'
import { etDateTime } from '@/lib/assistant/timeFormat'
import { agoLabel } from '@/lib/agoLabel'
import { etDateString } from '@/lib/partyTime'
import { monthKeyOf, monthKeys, monthShort, weekNumberOf, weeksOfMonth } from '@/lib/bookingWeeks'
import { Banner, CrewFrame, money } from '../_components/adminCrew'
import { useAdminData } from '../_components/adminData'
import { DateBlock, TYPE_SHORT } from '../_components/BookingTile'
import ContactButtons from '../_components/ContactButtons'
import LeadActions from '../_components/LeadActions'
import PartyActions from '../_components/PartyActions'
import SortMenu from '../_components/SortMenu'
import { LEAD_SORTS, sortLeads, type LeadSortKey } from '@/lib/crewAppSort'
import PartyFilters, { passesTypes, useRemembered, type TypeKey } from '../_components/PartyFilters'

/** "Sat, Dec 12" from a YYYY-MM-DD, noon-anchored so the day never slips. */
function dayLabel(ymd: string | null): string {
  if (!ymd) return 'No date yet'
  const d = new Date(`${ymd}T12:00:00`)
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

interface Detail {
  package_type?: string | null
  admin_notes?: string | null
  balance_due_cents?: number | null
  party_tags?: Record<string, unknown> | null
  line_items?: Array<{ id: string; name: string; quantity: number; unit_price_cents: number; guest_multiplied: boolean }>
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <div className="w-24 shrink-0 text-hampton-navy/50">{label}</div>
      <div className="text-hampton-navy min-w-0 break-words">{children}</div>
    </div>
  )
}

function LeadTile({ lead, open, onToggle }: { lead: LeadCard; open: boolean; onToggle: () => void }) {
  // The full party, fetched the first time the tile opens (then held by the cache).
  const detailState = useAdminData<Detail>(open ? `/api/admin/parties/${lead.id}` : null, 120_000)
  const detail = detailState.data
  const total = lead.totalCents
  const kid = [lead.childName, lead.childAge ? `${lead.childAge}` : null].filter(Boolean).join(', ')

  return (
    <article className="bg-white rounded-2xl shadow-sm overflow-hidden" data-lead-card data-ref={lead.ref}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full text-left p-3 active:bg-[#F6F1EB] flex gap-3 items-stretch">
        <DateBlock date={lead.partyDate} time={lead.partyTime} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[17px] font-semibold text-hampton-navy leading-tight truncate">{lead.name}</div>
              {kid && <div className="text-sm text-hampton-navy/60 truncate">{kid}</div>}
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs font-semibold text-hampton-navy" title={etDateTime(lead.lastContactAt)}>{agoLabel(lead.lastContactAt)}</div>
              <div className="text-[11px] text-hampton-navy/50">
                {lead.lastFrom === 'them' ? 'they wrote' : lead.lastFrom === 'us' ? 'we wrote' : 'first asked'}
              </div>
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${STAGE_STYLE[lead.stage]}`}>{STAGE_LABELS[lead.stage]}</span>
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-hampton-navy/10 text-hampton-navy">
              {TYPE_SHORT[lead.partyType ?? ''] ?? PARTY_TYPE_LABELS[lead.partyType || 'unknown']}
            </span>
            {lead.guests ? <span className="text-[11px] text-hampton-navy/60">{lead.guests} guests</span> : null}
            {total && total > 0 ? <span className="text-[11px] font-semibold text-hampton-navy/70">{money(total)}</span> : null}
            {lead.waitingOnUs && <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-red-100 text-red-700">Waiting on us</span>}
          </div>
          <div className="mt-1.5 text-sm text-hampton-navy/60 line-clamp-2">
            {lead.lastTheirs ? `“${lead.lastTheirs.text}”` : 'No message from them on record.'}
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-hampton-navy/10 p-3 space-y-3 bg-[#FBF8F4]">
          <Row label="Reference">{lead.ref}</Row>
          <Row label="Phone">{lead.phone ? <a className="underline" href={`tel:${lead.phone}`}>{lead.phone}</a> : '—'}</Row>
          <Row label="Email">{lead.email ? <a className="underline" href={`mailto:${lead.email}`}>{lead.email}</a> : '—'}</Row>
          <Row label="Party">
            {PARTY_TYPE_LABELS[lead.partyType || 'unknown']} · {dayLabel(lead.partyDate)}{lead.partyTime ? ` at ${lead.partyTime}` : ''} · {lead.guests ?? '?'} guests
          </Row>
          {kid && <Row label="Child">{kid}</Row>}
          {(detail?.package_type || lead.packageType) && <Row label="Package">{detail?.package_type || lead.packageType}</Row>}
          {typeof detail?.party_tags?.location_address === 'string' && <Row label="Venue">{detail.party_tags.location_address}</Row>}
          <Row label="First asked">{etDateTime(lead.createdAt)}</Row>
          <Row label="Money">
            {total && total > 0 ? `${money(total)} quoted · ${money(lead.paidCents)} paid` : 'Not priced yet'}
          </Row>

          {detailState.error && !detail && <Banner tone="warn">{detailState.error}</Banner>}
          {detailState.loading && <div className="text-sm text-hampton-navy/50">Loading the rest…</div>}
          {detail?.line_items && detail.line_items.length > 0 && (
            <div>
              <div className="text-sm text-hampton-navy/50 mb-1">On the quote</div>
              <ul className="text-sm text-hampton-navy space-y-0.5">
                {detail.line_items.map(li => (
                  <li key={li.id} className="flex justify-between gap-3">
                    <span>{li.name}{li.quantity > 1 ? ` ×${li.quantity}` : ''}{li.guest_multiplied ? ' (per guest)' : ''}</span>
                    <span className="text-hampton-navy/70 shrink-0">{money(li.unit_price_cents * li.quantity)}{li.guest_multiplied ? ' ea' : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {detail?.admin_notes && <Row label="Notes">{detail.admin_notes}</Row>}

          <ContactButtons bookingId={lead.id} phone={lead.phone} email={lead.email} />
          <PartyActions bookingId={lead.id} bookingRef={lead.ref} />
          <LeadActions bookingId={lead.id} name={lead.name} />
        </div>
      )}
    </article>
  )
}

export default function CrewLeadsPage() {
  const { data, error, loading } = useAdminData<{ leads: LeadCard[]; truncated?: boolean }>('/api/admin/leads')
  const today = etDateString()
  const months = useMemo(() => monthKeys(today, 3), [today])
  const [types, setTypes] = useRemembered<TypeKey[]>('leads.types', [])
  const [month, setMonth] = useRemembered<string>('leads.month', 'all')
  const [week, setWeek] = useRemembered<number | null>('leads.week', null)
  const [sort, setSort] = useRemembered<LeadSortKey>('leads.sort', 'contact_desc')
  const [openRef, setOpenRef] = useState<string | null>(null)

  const leads = useMemo(() => data?.leads ?? [], [data])
  /** Which chip a lead's party date belongs to: a month on offer, 'later', or 'none'. */
  const bucketOf = (l: LeadCard): string => {
    if (!l.partyDate) return 'none'
    const m = monthKeyOf(l.partyDate)
    return months.includes(m) ? m : 'later'
  }

  const byType = useMemo(() => leads.filter(l => passesTypes(l.partyType, types)), [leads, types])
  const chipCount = (key: string) => (key === 'all' ? byType.length : byType.filter(l => bucketOf(l) === key).length)
  const chips = [
    { key: 'all', label: 'All', count: chipCount('all') },
    ...months.map(m => ({ key: m, label: monthShort(m), count: chipCount(m) })),
    ...(chipCount('later') ? [{ key: 'later', label: 'Later', count: chipCount('later') }] : []),
    { key: 'none', label: 'No date', count: chipCount('none') },
  ]
  const activeMonth = chips.some(c => c.key === month) ? month : 'all'
  const inMonth = byType.filter(l => activeMonth === 'all' || bucketOf(l) === activeMonth)
  const weekCounts = useMemo(() => {
    if (!/^\d{4}-\d{2}$/.test(activeMonth)) return null
    const out: Record<number, number> = {}
    for (const w of weeksOfMonth(activeMonth)) out[w.n] = 0
    for (const l of inMonth) if (l.partyDate) out[weekNumberOf(l.partyDate)] = (out[weekNumberOf(l.partyDate)] ?? 0) + 1
    return out
  }, [inMonth, activeMonth])
  const shown = sortLeads(
    inMonth.filter(l => week === null || !/^\d{4}-\d{2}$/.test(activeMonth) || (l.partyDate ? weekNumberOf(l.partyDate) === week : false)),
    sort,
  )

  return (
    <CrewFrame
      active="/admin/crew/leads"
      title="Leads"
      compact
      actions={<SortMenu options={LEAD_SORTS} value={sort} onChange={setSort} />}
    >
      <div className="max-w-3xl mx-auto">
        {error && !data && <Banner tone="error">{error}</Banner>}
        {loading && <div className="text-center text-hampton-navy/50 py-10">Loading the leads…</div>}
        {data && (
          <>
            {data.truncated && <Banner tone="info">Showing the most recent 200 inquiries.</Banner>}
            <PartyFilters
              types={types}
              onTypes={setTypes}
              months={chips}
              month={activeMonth}
              onMonth={setMonth}
              weekCounts={weekCounts}
              week={week}
              onWeek={setWeek}
            />
            <div className="mt-3 space-y-3">
              {shown.length === 0 && <div className="text-center text-hampton-navy/60 py-10">{leads.length === 0 ? 'No open leads right now.' : 'No leads match those buttons.'}</div>}
              {shown.map(l => (
                <LeadTile key={l.id} lead={l} open={openRef === l.ref} onToggle={() => setOpenRef(openRef === l.ref ? null : l.ref)} />
              ))}
            </div>
          </>
        )}
      </div>
    </CrewFrame>
  )
}
