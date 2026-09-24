'use client'

/**
 * The admin screen for appointment bookings.
 *
 * ── AN EVENT PICKER, NOT A HARD-CODED DAY ──
 *
 * The tab this replaces was called "Summer Hair" and read one table for one
 * date. Three months after the event it still said Summer Hair in the sidebar.
 * This one lists every event in the registry and asks which.
 *
 * Every time, price and duration on this screen comes from
 * `@/lib/appointmentEvents`. The old tab carried its own 18-slot grid, its own
 * `endTime()`, its own `PRICE_MAP` and a literal `/18` in two summary cards —
 * four copies of things the server also knew, none of them checked against it.
 */

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, XCircle, Clock, CheckCircle2, Undo2, ChevronDown, ChevronUp, CreditCard } from 'lucide-react'
import {
  resolveAppointmentEvent,
  slotTimes,
  endLabel,
  durationLabel,
  formatAppointmentMoney,
  estimateCents,
} from '@/lib/appointmentEvents'

interface Booking {
  id: string
  event_slug: string
  name: string
  email: string
  phone: string
  slot_index: number
  time_slot: string
  slots_needed: number
  services: string[]
  party_size: number
  notes: string | null
  status: string
  estimated_total_cents: number | null
  amount_paid_cents: number
  paid_at: string | null
  created_at: string
}

interface EventSummary {
  slug: string
  name: string
  dateLabel: string
  eventDate: string
  slotCount: number
  accentHex: string
  paymentMode: string
}

interface Summary {
  total: number
  confirmed: number
  pending: number
  cancelled: number
  totalPeople: number
  totalSlots: number
  slotCount: number
  estimatedCents: number
  paidCents: number
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function AppointmentsTab({ headers, onLogout }: { headers: Record<string, string>; onLogout: () => void }) {
  const [events, setEvents] = useState<EventSummary[]>([])
  const [eventSlug, setEventSlug] = useState<string>('')
  const [bookings, setBookings] = useState<Booking[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'confirmed' | 'pending_payment' | 'cancelled'>('confirmed')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string>('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const cfg = eventSlug ? resolveAppointmentEvent(eventSlug) : null

  const fetchBookings = useCallback(async () => {
    setLoading(true)
    try {
      const qs = eventSlug ? `?event=${encodeURIComponent(eventSlug)}` : ''
      const res = await fetch(`/api/admin/appointments${qs}`, { headers })
      if (res.status === 401) { onLogout(); return }
      const data = await res.json()
      setEvents(data.events || [])
      setBookings(data.bookings || [])
      setSummary(data.summary || null)
      // First load, no event chosen yet: default to the soonest one that has not
      // happened, so the tab opens on the day somebody is actually working.
      if (!eventSlug && data.events?.length) {
        const today = new Date().toISOString().slice(0, 10)
        const upcoming = (data.events as EventSummary[]).find(e => e.eventDate >= today)
        setEventSlug((upcoming ?? data.events[data.events.length - 1]).slug)
      }
    } catch (err) {
      console.error('Failed to fetch appointment bookings:', err)
    } finally {
      setLoading(false)
    }
  }, [headers, onLogout, eventSlug])

  useEffect(() => { fetchBookings() }, [fetchBookings])

  const handleAction = async (id: string, action: string, extra?: Record<string, unknown>) => {
    setActionLoading(id)
    setActionError('')
    try {
      const res = await fetch('/api/admin/appointments', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id, action, ...extra }),
      })
      if (res.status === 401) { onLogout(); return }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // A 409 here is real information — somebody took the slot while this was
        // cancelled — and swallowing it is how an admin comes to believe a
        // restore worked when it did not.
        setActionError(data.error || 'That did not work.')
        return
      }
      if (data.warning) setActionError(data.warning)
      await fetchBookings()
    } catch (err) {
      console.error('Action failed:', err)
      setActionError('Network error.')
    } finally {
      setActionLoading(null)
    }
  }

  const filtered = bookings.filter(b => filter === 'all' || b.status === filter)

  const estimate = (b: Booking) =>
    b.estimated_total_cents ?? (cfg ? estimateCents(cfg, b.services || [], b.party_size || 1) : 0)

  // The timeline grid, from the event's own config rather than a local copy.
  const times = cfg ? slotTimes(cfg) : []
  const occupiedSlots = new Map<number, Booking>()
  bookings
    .filter(b => b.status === 'confirmed' || b.status === 'pending_payment')
    .forEach(b => {
      for (let i = 0; i < (b.slots_needed || 1); i++) occupiedSlots.set(b.slot_index + i, b)
    })

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Event picker */}
      <div className="flex flex-wrap items-center gap-2">
        {events.map(e => (
          <button
            key={e.slug}
            onClick={() => { setEventSlug(e.slug); setExpandedId(null); setActionError('') }}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors border
              ${eventSlug === e.slug
                ? 'text-white border-transparent'
                : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
              }`}
            style={eventSlug === e.slug ? { backgroundColor: e.accentHex } : undefined}
          >
            {e.name}
            <span className="opacity-70 ml-1.5">{e.dateLabel}</span>
          </button>
        ))}
      </div>

      {!cfg ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          {loading ? 'Loading…' : 'Pick an event above.'}
        </div>
      ) : (
        <>
          {/* Summary cards */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
              {[
                { label: 'Confirmed', value: String(summary.confirmed), color: 'text-green-600' },
                { label: 'Awaiting Payment', value: String(summary.pending), color: 'text-amber-600' },
                { label: 'Cancelled', value: String(summary.cancelled), color: 'text-red-500' },
                { label: 'Total People', value: String(summary.totalPeople), color: 'text-hampton-navy' },
                { label: 'Slots Used', value: `${summary.totalSlots}/${summary.slotCount}`, color: 'text-hampton-navy' },
                { label: 'Slots Free', value: `${summary.slotCount - summary.totalSlots}/${summary.slotCount}`, color: 'text-blue-600' },
              ].map(c => (
                <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{c.label}</p>
                  <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Timeline view */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Day Timeline</p>
            <div className="grid grid-cols-6 sm:grid-cols-9 gap-1">
              {times.map((slot, idx) => {
                const booking = occupiedSlots.get(idx)
                const isStart = booking && booking.slot_index === idx
                return (
                  <div
                    key={slot}
                    className={`text-[10px] py-2 px-1 rounded text-center font-medium
                      ${booking
                        ? booking.status === 'pending_payment'
                          ? 'bg-amber-400 text-white'
                          : 'bg-hampton-navy text-white'
                        : 'bg-gray-50 text-gray-400 border border-gray-100'
                      }`}
                    title={booking ? `${booking.name} (${booking.party_size}p)` : 'Available'}
                  >
                    <div>{slot}</div>
                    {isStart && (
                      <div className="text-[8px] opacity-75 truncate mt-0.5">{booking.name.split(' ')[0]}</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Filter + refresh */}
          <div className="flex items-center justify-between">
            <div className="flex gap-2 flex-wrap">
              {(['confirmed', 'pending_payment', 'cancelled', 'all'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors
                    ${filter === f ? 'bg-hampton-navy text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                >
                  {f === 'pending_payment' ? 'awaiting payment' : f}
                </button>
              ))}
            </div>
            <button
              onClick={fetchBookings}
              className="p-2 text-gray-400 hover:text-hampton-navy rounded-lg hover:bg-gray-100 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {actionError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{actionError}</p>
          )}

          {/* Bookings list */}
          {loading && bookings.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">Loading bookings…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              No {filter === 'all' ? '' : filter.replace('_', ' ')} bookings yet
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(b => {
                const isExpanded = expandedId === b.id
                const n = b.slots_needed || 1
                return (
                  <div key={b.id} className={`bg-white rounded-xl border overflow-hidden transition-colors
                    ${b.status === 'cancelled' ? 'border-red-200 opacity-60' : 'border-gray-200'}`}
                  >
                    <div
                      className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50/50 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : b.id)}
                    >
                      <div className="shrink-0">
                        {b.status === 'confirmed'
                          ? <CheckCircle2 className="w-5 h-5 text-green-500" />
                          : b.status === 'pending_payment'
                            ? <CreditCard className="w-5 h-5 text-amber-500" />
                            : <XCircle className="w-5 h-5 text-red-400" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-hampton-navy">{b.name}</span>
                          <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                            {b.party_size}p
                          </span>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">{(b.services || []).join(', ')}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold text-hampton-navy">
                          {b.time_slot} – {endLabel(cfg, b.slot_index, n)}
                        </div>
                        <div className="text-[10px] text-gray-400 flex items-center justify-end gap-1">
                          <Clock className="w-3 h-3" />
                          {durationLabel(cfg, n)}
                        </div>
                      </div>
                      <div className="text-right shrink-0 w-20">
                        <span className="text-sm font-bold text-green-600">
                          {formatAppointmentMoney(estimate(b))}
                        </span>
                        {b.amount_paid_cents > 0 && (
                          <span className="block text-[10px] text-gray-400">
                            {formatAppointmentMoney(b.amount_paid_cents)} paid
                          </span>
                        )}
                      </div>
                      {isExpanded
                        ? <ChevronUp className="w-4 h-4 text-gray-300 shrink-0" />
                        : <ChevronDown className="w-4 h-4 text-gray-300 shrink-0" />
                      }
                    </div>

                    {isExpanded && (
                      <div className="border-t border-gray-100 p-4 bg-gray-50/30 space-y-4">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div>
                            <p className="text-gray-400 font-medium uppercase tracking-wider mb-0.5">Email</p>
                            <a href={`mailto:${b.email}`} className="text-hampton-navy underline">{b.email}</a>
                          </div>
                          <div>
                            <p className="text-gray-400 font-medium uppercase tracking-wider mb-0.5">Phone</p>
                            <a href={`tel:${b.phone}`} className="text-hampton-navy underline">{b.phone}</a>
                          </div>
                          <div>
                            <p className="text-gray-400 font-medium uppercase tracking-wider mb-0.5">Booked</p>
                            <p className="text-gray-600">{fmtDate(b.created_at)}</p>
                          </div>
                          <div>
                            <p className="text-gray-400 font-medium uppercase tracking-wider mb-0.5">Services</p>
                            <p className="text-gray-600">{(b.services || []).join(', ')}</p>
                          </div>
                        </div>

                        {b.notes && (
                          <div className="text-xs">
                            <p className="text-gray-400 font-medium uppercase tracking-wider mb-0.5">Notes</p>
                            <p className="text-gray-600 bg-white rounded-lg border border-gray-100 p-2">{b.notes}</p>
                          </div>
                        )}

                        {/* Duration adjust. Both directions maintain the slot holds
                            server-side; a grow that collides comes back as a 409. */}
                        {b.status !== 'cancelled' && (
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">Duration:</span>
                            <div className="flex items-center gap-2">
                              <button
                                disabled={actionLoading === b.id || n <= 1}
                                onClick={(e) => { e.stopPropagation(); handleAction(b.id, 'adjust_duration', { slotsNeeded: n - 1 }) }}
                                className="w-7 h-7 rounded border border-gray-200 bg-white text-gray-500 text-xs font-bold hover:border-gray-400 disabled:opacity-30 transition-colors"
                              >
                                −
                              </button>
                              <span className="text-sm font-semibold text-hampton-navy w-28 text-center">
                                {durationLabel(cfg, n)}
                              </span>
                              <button
                                disabled={actionLoading === b.id || b.slot_index + n >= cfg.slotCount}
                                onClick={(e) => { e.stopPropagation(); handleAction(b.id, 'adjust_duration', { slotsNeeded: n + 1 }) }}
                                className="w-7 h-7 rounded border border-gray-200 bg-white text-gray-500 text-xs font-bold hover:border-gray-400 disabled:opacity-30 transition-colors"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="flex gap-2 pt-1">
                          {b.status !== 'cancelled' ? (
                            <button
                              disabled={actionLoading === b.id}
                              onClick={(e) => { e.stopPropagation(); handleAction(b.id, 'cancel') }}
                              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 font-medium transition-colors disabled:opacity-50"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Cancel Booking
                            </button>
                          ) : (
                            <button
                              disabled={actionLoading === b.id}
                              onClick={(e) => { e.stopPropagation(); handleAction(b.id, 'restore') }}
                              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 font-medium transition-colors disabled:opacity-50"
                            >
                              <Undo2 className="w-3.5 h-3.5" />
                              Restore Booking
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
