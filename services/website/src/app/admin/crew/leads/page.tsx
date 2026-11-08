'use client'

/**
 * /admin/crew/leads - the open leads as tiles, phone first, in the same format as
 * Bookings: a Refresh button (check email and texts for anything new), pull buttons for the kind of party and the month and the day / weekend it is for, then a
 * tile per lead, the one in touch most recently on top. Tapping a tile opens
 * everything about the party and the buttons to copy or view the invoice, open the
 * planner, or ask the AI assistant to make a change. Nothing here changes a booking or
 * sends anything: the buttons mint a link for YOU (the same ones the Parties tab
 * makes), and the assistant, as always, only proposes cards that you confirm.
 */

import { useMemo, useState } from 'react'
import { MessageSquare, Reply } from 'lucide-react'
import type { LeadCard } from '@/lib/leadCards'
import { PARTY_TYPE_LABELS } from '@/lib/pipelineStages'
import { STAGE_LABELS, STAGE_STYLE } from '@/lib/bookingStatus'
import { etDateTime } from '@/lib/assistant/timeFormat'
import { agoLabel } from '@/lib/agoLabel'
import { etDateString } from '@/lib/partyTime'
import { countByDate, monthKeyOf, monthKeys, monthShort, passesWeekend, type WeekendKey } from '@/lib/bookingWeeks'
import { Banner, CrewFrame } from '../_components/adminCrew'
import { dollars as money } from '@/lib/assistant/dollars'
import { useAdminData } from '../_components/adminData'
import PartyTile, { CardBadge, CardField, CardSection, partyTitle } from '../_components/PartyTile'
import ContactButtons from '../_components/ContactButtons'
import LeadActions from '../_components/LeadActions'
import PartyActions from '../_components/PartyActions'
import SortMenu from '../_components/SortMenu'
import { RefreshButton, RefreshOutcome, useLeadsRefresh } from '../_components/LeadsRefresh'
import { LEAD_SORTS, sortLeads, type LeadSortKey } from '@/lib/crewAppSort'
import PartyFilters, { passesTypes, useRemembered, type TypeKey } from '../_components/PartyFilters'

interface Detail {
  package_type?: string | null
  admin_notes?: string | null
  balance_due_cents?: number | null
  party_tags?: Record<string, unknown> | null
  line_items?: Array<{ id: string; name: string; quantity: number; unit_price_cents: number; guest_multiplied: boolean }>
}

function LeadTile({ lead, open, onToggle }: { lead: LeadCard; open: boolean; onToggle: () => void }) {
  // The full party, fetched the first time the tile opens (then held by the cache).
  const detailState = useAdminData<Detail>(open ? `/api/admin/parties/${lead.id}` : null, 120_000)
  const detail = detailState.data
  const total = lead.totalCents
  const priced = total !== null && total > 0
  const subtitle = [lead.childName ? `Hosted by ${lead.name}` : 'Party inquiry', lead.childAge ? `Turning ${lead.childAge}` : null].filter(Boolean).join(' · ')

  return (
    <PartyTile
      kind="lead"
      bookingRef={lead.ref}
      title={partyTitle(lead.childName, lead.name)}
      subtitle={subtitle}
      partyType={lead.partyType}
      date={lead.partyDate}
      time={lead.partyTime}
      guests={lead.guests}
      badge={<CardBadge className={STAGE_STYLE[lead.stage]}>{STAGE_LABELS[lead.stage]}</CardBadge>}
      amountLabel="Quote total"
      amount={priced ? money(total) : 'Not priced'}
      attention={lead.waitingOnUs}
      preview={lead.lastTheirs ? (
        <span className="mt-3 flex gap-2.5 text-xs leading-relaxed text-hampton-navy/70 sm:text-sm">
          <MessageSquare size={15} className="mt-0.5 shrink-0 text-hampton-navy/35" aria-hidden="true" />
          <span className="line-clamp-2" title={`Latest from client · ${etDateTime(lead.lastTheirs.at)}`}>“{lead.lastTheirs.text}”</span>
        </span>
      ) : <span className="mt-3 block text-xs text-hampton-navy/70">No customer message on record</span>}
      context={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5" title={etDateTime(lead.lastContactAt)}>
          {lead.waitingOnUs ? <span className="inline-flex items-center gap-1 font-semibold text-amber-800"><Reply size={14} aria-hidden="true" />Waiting on us</span> : <span className="text-hampton-navy/70">{lead.lastFrom === 'us' ? 'We replied' : lead.lastFrom === 'them' ? 'Client replied' : 'Inquiry received'}</span>}
          <span className="text-[11px] text-hampton-navy/70">{agoLabel(lead.lastContactAt)}</span>
        </span>
      }
      open={open}
      onToggle={onToggle}
    >
      <CardSection title="Contact">
        <dl className="mb-3 grid gap-3 sm:grid-cols-2">
          <CardField label="Host">{lead.name}</CardField>
          <CardField label="Booking reference">{lead.ref}</CardField>
          <CardField label="Phone">{lead.phone ? <a className="underline decoration-hampton-navy/25 underline-offset-4" href={`tel:${lead.phone}`}>{lead.phone}</a> : 'Not provided'}</CardField>
          <CardField label="Email">{lead.email ? <a className="underline decoration-hampton-navy/25 underline-offset-4" href={`mailto:${lead.email}`}>{lead.email}</a> : 'Not provided'}</CardField>
        </dl>
        <ContactButtons bookingId={lead.id} phone={lead.phone} email={lead.email} />
      </CardSection>
      {lead.lastTheirs && (
        <CardSection title="Latest from client">
          <blockquote className="border-l-2 border-hampton-navy/15 pl-3 text-sm leading-relaxed text-hampton-navy/75">{lead.lastTheirs.text}</blockquote>
          <p className="mt-2 text-[11px] text-hampton-navy/70">{etDateTime(lead.lastTheirs.at)}</p>
        </CardSection>
      )}
      {detailState.error && !detail && <Banner tone="warn">{detailState.error}</Banner>}
      {detailState.loading && <div role="status" className="text-sm text-hampton-navy/70">Loading party details…</div>}
      <CardSection title="Party details">
        <dl className="grid gap-3 sm:grid-cols-2">
          <CardField label="Party type">{PARTY_TYPE_LABELS[lead.partyType || 'unknown'] ?? 'Party'}</CardField>
          <CardField label="Package">{detail?.package_type || lead.packageType || 'Not chosen yet'}</CardField>
          <CardField label="First inquiry">{etDateTime(lead.createdAt)}</CardField>
          <CardField label="Payments received">{money(lead.paidCents)}</CardField>
          {typeof detail?.party_tags?.location_address === 'string' && <CardField label="Venue">{detail.party_tags.location_address}</CardField>}
        </dl>
      </CardSection>
      {detail?.line_items && detail.line_items.length > 0 && (
        <CardSection title="On the quote">
          <ul className="divide-y divide-hampton-navy/10 text-sm text-hampton-navy">
            {detail.line_items.map(li => (
              <li key={li.id} className="flex justify-between gap-3 py-2 first:pt-0">
                <span className="min-w-0 break-words">{li.name}{li.quantity > 1 ? ` ×${li.quantity}` : ''}{li.guest_multiplied ? ' (per guest)' : ''}</span>
                <span className="shrink-0 tabular-nums text-hampton-navy/70">{money(li.unit_price_cents * li.quantity)}{li.guest_multiplied ? ' ea' : ''}</span>
              </li>
            ))}
          </ul>
        </CardSection>
      )}
      {detail?.admin_notes && <CardSection title="Internal notes"><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-hampton-navy/75">{detail.admin_notes}</p></CardSection>}
      <PartyActions bookingId={lead.id} bookingRef={lead.ref} />
      <LeadActions bookingId={lead.id} name={lead.name} />
    </PartyTile>
  )
}

export default function CrewLeadsPage() {
  const { data, error, loading } = useAdminData<{ leads: LeadCard[]; truncated?: boolean }>('/api/admin/leads')
  const today = etDateString()
  const months = useMemo(() => monthKeys(today, 3), [today])
  const [types, setTypes] = useRemembered<TypeKey[]>('leads.types', [])
  const [month, setMonth] = useRemembered<string>('leads.month', 'all')
  const [day, setDay] = useRemembered<string | null>('leads.day', null)
  const [weekend, setWeekend] = useRemembered<WeekendKey[]>('leads.weekend', [])
  const [sort, setSort] = useRemembered<LeadSortKey>('leads.sort', 'contact_desc')
  const [openRef, setOpenRef] = useState<string | null>(null)
  const refresh = useLeadsRefresh()

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
  const weekendRows = useMemo(() => inMonth.filter(l => passesWeekend(l.partyDate, weekend)), [inMonth, weekend])
  // The dates are offered for a real month only; a lit date that has dropped out of them is not lit.
  const dayCounts = useMemo(
    () => (/^\d{4}-\d{2}$/.test(activeMonth) ? countByDate(weekendRows.map(l => l.partyDate)) : null),
    [weekendRows, activeMonth],
  )
  const activeDay = day && dayCounts?.[day] ? day : null
  const shown = sortLeads(weekendRows.filter(l => !activeDay || l.partyDate === activeDay), sort)

  return (
    <CrewFrame
      active="/admin/crew/leads"
      title="Leads"
      compact
      actions={
        <div className="flex items-center gap-2">
          <RefreshButton busy={refresh.busy} onClick={refresh.run} />
          <SortMenu options={LEAD_SORTS} value={sort} onChange={setSort} />
        </div>
      }
    >
      <div className="max-w-3xl mx-auto">
        {error && !data && <Banner tone="error">{error}</Banner>}
        {loading && <div className="text-center text-hampton-navy/70 py-10">Loading the leads…</div>}
        {data && (
          <>
            <RefreshOutcome busy={refresh.busy} outcome={refresh.outcome} />
            {data.truncated && <Banner tone="info">Showing the most recent 200 inquiries.</Banner>}
            <PartyFilters
              types={types}
              onTypes={setTypes}
              months={chips}
              month={activeMonth}
              onMonth={setMonth}
              dayCounts={dayCounts}
              day={activeDay}
              onDay={setDay}
              weekend={weekend}
              onWeekend={setWeekend}
            />
            <div className="mb-3 mt-5 flex items-center justify-between gap-3 text-xs text-hampton-navy/70" role="status">
              <span>{shown.length} {shown.length === 1 ? 'lead' : 'leads'}{shown.length !== leads.length ? ` of ${leads.length}` : ''}</span>
              {shown.some(l => l.waitingOnUs) && <span className="font-medium text-amber-800">{shown.filter(l => l.waitingOnUs).length} awaiting reply</span>}
            </div>
            <div className="space-y-4">
              {shown.length === 0 && <div className="text-center text-hampton-navy/70 py-10">{leads.length === 0 ? 'No open leads right now.' : 'No leads match those buttons.'}</div>}
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
