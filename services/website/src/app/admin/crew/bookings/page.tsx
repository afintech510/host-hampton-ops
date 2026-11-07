'use client'

/**
 * /admin/crew/bookings - the booked parties as tiles, phone first.
 *
 * Pull buttons at the top (kind of party, the three months, the weeks of the month),
 * then a tile per booking. Tap a tile and it opens to everything, including who is
 * staffed and a button to the party-staff page. `?party=<id>` or `?ref=<ref>` opens
 * that booking (the assistant and the Leads tiles link here).
 *
 * The data is already in memory when you arrive (the shell warms it), so the page
 * paints at once and refreshes quietly.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { BookingTile as Tile } from '@/lib/crewAppData'
import { etDateString } from '@/lib/partyTime'
import { monthKeyOf, monthKeys, monthShort, passesDateFilter, weekNumberOf, weeksOfMonth } from '@/lib/bookingWeeks'
import { Banner, CrewFrame } from '../_components/adminCrew'
import { warm, useAdminData } from '../_components/adminData'
import BookingTile from '../_components/BookingTile'
import SortMenu from '../_components/SortMenu'
import { BOOKING_SORTS, sortBookings, type BookingSortKey } from '@/lib/crewAppSort'
import PartyFilters, { passesTypes, useRemembered, type TypeKey } from '../_components/PartyFilters'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function CrewBookingsPage() {
  const { data, error, loading } = useAdminData<{ bookings: Tile[]; today: string }>('/api/admin/crew-app/bookings')
  const today = data?.today ?? etDateString()
  const months = useMemo(() => monthKeys(today, 3), [today])

  const [types, setTypes] = useRemembered<TypeKey[]>('bookings.types', [])
  const [month, setMonth] = useRemembered<string>('bookings.month', months[0])
  const [week, setWeek] = useRemembered<number | null>('bookings.week', null)
  const [sort, setSort] = useRemembered<BookingSortKey>('bookings.sort', 'date_asc')
  const [openId, setOpenId] = useState<string | null>(null)
  const [linkId, setLinkId] = useState<string | null>(null)
  const deepLinked = useRef(false)

  // A remembered month that has scrolled out of the three on offer falls back to this one.
  const activeMonth = months.includes(month) ? month : months[0]

  const all = useMemo(() => data?.bookings ?? [], [data])
  const byType = useMemo(() => all.filter(t => passesTypes(t.partyType, types)), [all, types])
  const monthCount = (m: string) => byType.filter(t => monthKeyOf(t.partyDate ?? '') === m).length
  const inMonth = useMemo(() => byType.filter(t => passesDateFilter(t.partyDate, { month: activeMonth, week: null })), [byType, activeMonth])
  const weekCounts = useMemo(() => {
    const out: Record<number, number> = {}
    for (const w of weeksOfMonth(activeMonth)) out[w.n] = 0
    for (const t of inMonth) if (t.partyDate) out[weekNumberOf(t.partyDate)] = (out[weekNumberOf(t.partyDate)] ?? 0) + 1
    return out
  }, [inMonth, activeMonth])
  const shown = useMemo(
    () => sortBookings(inMonth.filter(t => passesDateFilter(t.partyDate, { month: activeMonth, week })), sort),
    [inMonth, activeMonth, week, sort],
  )

  // Open the booking a link points at: light the filters that contain it, then open it.
  useEffect(() => {
    if (deepLinked.current || !data) return
    const q = new URLSearchParams(window.location.search)
    const id = q.get('party') ?? ''
    const ref = q.get('ref') ?? ''
    const hit = all.find(t => (UUID.test(id) && t.id === id) || (ref && t.ref === ref))
    deepLinked.current = true
    // Not among the three months on offer (a past or cancelled party reached from Payments): fetch it on its own.
    if (!hit && UUID.test(id)) { setLinkId(id); setOpenId(id) }
    if (!hit) return
    setTypes([])
    if (hit.partyDate) {
      setMonth(monthKeyOf(hit.partyDate))
      setWeek(weekNumberOf(hit.partyDate))
    }
    setOpenId(hit.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const linked = useAdminData<{ linked: Tile | null }>(linkId ? `/api/admin/crew-app/bookings?include=${linkId}` : null, 120_000).data?.linked ?? null

  // Have the first tiles' details ready before they are opened.
  useEffect(() => {
    warm(shown.slice(0, 8).map(t => `/api/admin/crew-app/booking/${t.id}`))
  }, [shown])

  const months3 = months.map(m => ({ key: m, label: monthShort(m), count: monthCount(m) }))

  return (
    <CrewFrame active="/admin/crew/bookings" title="Bookings" compact actions={<SortMenu options={BOOKING_SORTS} value={sort} onChange={setSort} />}>
      <div className="max-w-3xl mx-auto">
        {error && !data && <Banner tone="error">{error}</Banner>}
        {loading && <div className="text-center text-hampton-navy/50 py-10">Loading the bookings…</div>}
        {data && (
          <>
            {linked && (
              <div className="mb-5">
                <div className="text-center text-xs font-bold uppercase tracking-wider text-hampton-navy/50 mb-2">Opened from a link</div>
                <BookingTile tile={linked} open={openId === linked.id} onToggle={() => setOpenId(openId === linked.id ? null : linked.id)} />
              </div>
            )}
            <PartyFilters
              types={types}
              onTypes={setTypes}
              months={months3}
              month={activeMonth}
              onMonth={setMonth}
              weekCounts={weekCounts}
              week={week}
              onWeek={setWeek}
            />
            <div className="mt-3 space-y-3">
              {shown.length === 0 && (
                <div className="text-center text-hampton-navy/60 py-10">
                  Nothing booked {week ? `in week ${week} of ${monthShort(activeMonth)}` : `in ${monthShort(activeMonth)}`}
                  {types.length ? ' for those kinds of party' : ''}.
                </div>
              )}
              {shown.map(t => (
                <BookingTile key={t.id} tile={t} open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)} />
              ))}
            </div>
          </>
        )}
      </div>
    </CrewFrame>
  )
}
