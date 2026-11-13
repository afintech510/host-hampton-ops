'use client'

/**
 * The crew app's Bookings screen (read only, migration 100): the same tiles and filters as the admin
 * Bookings screen, with the business side taken out. A tile opens to the party's details; there is no
 * money, no contact details and nothing to press that changes anything. `This weekend` (the prep list)
 * sits above the tiles.
 */

import { useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import PartyTile, { CardBadge, CardField, CardSection, CARD_GRID } from '@/app/admin/crew/_components/PartyTile'
import PartyFilters, { passesTypes, useRemembered, type TypeKey } from '@/app/admin/crew/_components/PartyFilters'
import { etDateString } from '@/lib/partyTime'
import { countByDate, dayCaption, isUpcoming, monthKeyOf, monthKeys, monthShort, passesDateFilter, passesWeekend, type WeekendKey } from '@/lib/bookingWeeks'
import type { CrewBookingDetail, CrewBookingTile } from '@/lib/crew/bookingView'
import { useCrewData } from './useCrewData'
import WeekendPrep from './WeekendPrep'

const note = (text: string, tone: 'warn' | 'plain' = 'plain') => (
  <p role={tone === 'warn' ? 'alert' : 'status'} className={`crew-note ${tone === 'warn' ? 'crew-warn' : ''}`}>{text}</p>
)

function List({ title, lines }: { title: string; lines: string[] }) {
  if (lines.length === 0) return null
  return (
    <CardField label={title}>
      <ul className="space-y-0.5">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </CardField>
  )
}

function staffChip(t: CrewBookingTile) {
  if (!t.crew) return { text: 'Not scheduled', cls: 'bg-slate-100 text-slate-600' }
  const { needed, staffed, status } = t.crew
  if (status === 'cancelled') return { text: 'Crew cancelled', cls: 'bg-red-100 text-red-700' }
  const text = `Staff ${staffed}/${needed}`
  if (needed > 0 && staffed >= needed) return { text, cls: 'bg-emerald-100 text-emerald-800' }
  return { text, cls: staffed === 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800' }
}

function Details({ tile }: { tile: CrewBookingTile }) {
  const { data, error, loading } = useCrewData<{ detail: CrewBookingDetail }>(`/api/crew/bookings/${tile.id}`)
  const d = data?.detail
  return (
    <>
      {error && !d && note(error, 'warn')}
      {loading && <div role="status" className="text-sm text-hampton-navy/70">Loading party details…</div>}
      {d && (
        <>
          <section>
            <dl className={CARD_GRID}>
              <CardField label="Parent">{d.parent ?? 'Not provided'}</CardField>
              <CardField label="Date & time" right>{d.when ?? 'Not set'}</CardField>
              <CardField label="Celebrating">{d.child ? `${d.child}${d.childAge ? ` · turning ${d.childAge}` : ''}` : 'Not given'}</CardField>
              <CardField label="Party type" right>{d.type}</CardField>
              <CardField label="Guests">{d.guests ?? 'Not set'}</CardField>
              {d.venue ? <CardField label="Venue" right>{d.venue}</CardField> : <span />}
            </dl>
          </section>
          <CardSection title="Party plan">
            {d.theme.length + d.activities.length + d.addOns.length + d.food.length + d.desserts.length > 0 || d.extraGuests ? (
              <dl className={CARD_GRID}>
                <List title="Theme / package" lines={d.theme} />
                <List title="Activities" lines={d.activities} />
                <List title="Decor & add-ons" lines={d.addOns} />
                <List title="Food & drinks" lines={d.food} />
                <List title="Desserts" lines={d.desserts} />
                {d.extraGuests && <CardField label="Extra guests">{d.extraGuests}</CardField>}
              </dl>
            ) : <p className="text-sm text-hampton-navy/70">No selections added yet.</p>}
          </CardSection>
          {d.notes && <CardSection title="Notes for the crew"><p className="whitespace-pre-wrap break-words text-sm leading-snug text-hampton-navy/75">{d.notes}</p></CardSection>}
        </>
      )}
      <CardSection title="Staff">
        {tile.crew && tile.crew.people.length > 0 ? (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-hampton-navy">
            {tile.crew.people.map((p, i) => (
              <li key={i} className="min-w-0 leading-snug">{p.firstName}<span className="text-hampton-navy/70"> · {p.role === 'lead' ? 'Party Lead' : 'Crew'}</span></li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-hampton-navy/70">{tile.crew ? 'Nobody is on it yet.' : 'Not on the crew schedule yet.'}</p>
        )}
      </CardSection>
    </>
  )
}

function Tile({ tile, open, onToggle }: { tile: CrewBookingTile; open: boolean; onToggle: () => void }) {
  const chip = staffChip(tile)
  const title = tile.child ? (/s$/i.test(tile.child) ? `${tile.child}' Party` : `${tile.child}'s Party`) : tile.parent ? `${tile.parent}'s booking` : 'Booked party'
  const subtitle = [tile.child ? `Hosted by ${tile.parent ?? 'the family'}` : 'Booked party', tile.childAge ? `Turning ${tile.childAge}` : null].filter(Boolean).join(' · ')
  const c = tile.crew
  return (
    <PartyTile
      kind="booking"
      bookingRef=""
      title={title}
      subtitle={subtitle}
      partyType={tile.partyType}
      date={tile.partyDate}
      time={tile.partyTime}
      guests={tile.guests}
      badge={<CardBadge className={chip.cls}>{chip.text}</CardBadge>}
      amountLabel="Staff"
      amount={c && c.status !== 'cancelled' ? `${c.staffed} of ${c.needed}` : 'Not set'}
      context={
        <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${chip.cls}`}>
          <Users size={13} aria-hidden="true" />{c && c.status !== 'cancelled' ? (c.staffed < c.needed ? `${c.needed - c.staffed} open` : c.needed > 0 ? 'All spots filled' : 'No spots set') : chip.text}
        </span>
      }
      open={open}
      onToggle={onToggle}
    >
      {open && <Details tile={tile} />}
    </PartyTile>
  )
}

export default function BookingsView() {
  const { data, error, loading } = useCrewData<{ bookings: CrewBookingTile[]; today: string }>('/api/crew/bookings')
  const today = data?.today ?? etDateString()
  const months = useMemo(() => monthKeys(today, 3), [today])

  const [types, setTypes] = useRemembered<TypeKey[]>('crew.bookings.types', [])
  const [month, setMonth] = useRemembered<string>('crew.bookings.month', 'all')
  const [day, setDay] = useRemembered<string | null>('crew.bookings.day', null)
  const [weekend, setWeekend] = useRemembered<WeekendKey[]>('crew.bookings.weekend', [])
  const [openId, setOpenId] = useState<string | null>(null)

  const activeMonth = month === 'all' || months.includes(month) ? month : 'all'
  const all = useMemo(() => data?.bookings ?? [], [data])
  const byType = useMemo(() => all.filter(t => passesTypes(t.partyType, types)), [all, types])
  const monthCount = (m: string) => byType.filter(t => monthKeyOf(t.partyDate ?? '') === m).length
  const upcoming = useMemo(() => byType.filter(t => isUpcoming(t.partyDate, today)), [byType, today])
  const inMonth = useMemo(
    () => (activeMonth === 'all' ? upcoming : byType.filter(t => passesDateFilter(t.partyDate, { month: activeMonth, week: null }))),
    [byType, upcoming, activeMonth],
  )
  const weekendRows = useMemo(() => inMonth.filter(t => passesWeekend(t.partyDate, weekend)), [inMonth, weekend])
  const dayCounts = useMemo(() => countByDate(weekendRows.map(t => t.partyDate)), [weekendRows])
  const activeDay = day && dayCounts[day] ? day : null
  const shown = useMemo(
    () => weekendRows.filter(t => !activeDay || t.partyDate === activeDay),
    [weekendRows, activeDay],
  )
  const periodLabel = activeMonth === 'all' ? 'from this weekend on' : `in ${monthShort(activeMonth)}`
  const months3 = [{ key: 'all', label: 'Upcoming', count: upcoming.length }, ...months.map(m => ({ key: m, label: monthShort(m), count: monthCount(m) }))]

  return (
    <div>
      <WeekendPrep />
      <h2>Booked parties</h2>
      {error && !data && note(error, 'warn')}
      {loading && <div className="crew-muted" role="status">Loading the bookings…</div>}
      {data && (
        <>
          <PartyFilters
            types={types}
            onTypes={setTypes}
            months={months3}
            month={activeMonth}
            onMonth={setMonth}
            dayCounts={activeMonth === 'all' ? null : dayCounts}
            day={activeDay}
            onDay={setDay}
            weekend={weekend}
            onWeekend={setWeekend}
          />
          <div className="crew-muted crew-small" role="status" style={{ margin: '1rem 0 .75rem' }}>{shown.length} {shown.length === 1 ? 'booking' : 'bookings'}</div>
          <div className="space-y-4">
            {shown.length === 0 && (
              <p className="crew-muted" style={{ textAlign: 'center' }}>
                Nothing booked {activeDay ? `on ${dayCaption(activeDay)}` : weekend.length ? `on ${weekend.map(k => (k === 'sat' ? 'Saturdays' : 'Sundays')).join(' or ')} ${periodLabel}` : periodLabel}
                {types.length ? ' for those kinds of party' : ''}.
              </p>
            )}
            {shown.map(t => <Tile key={t.id} tile={t} open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)} />)}
          </div>
        </>
      )}
    </div>
  )
}
