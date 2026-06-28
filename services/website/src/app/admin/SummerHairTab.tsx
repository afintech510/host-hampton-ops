'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, XCircle, Clock, Users, CheckCircle2, Undo2, ChevronDown, ChevronUp } from 'lucide-react'

interface Booking {
  id: string
  name: string
  email: string
  phone: string
  time_slot: string
  slots_needed: number
  services: string[]
  party_size: number
  notes: string | null
  status: string
  created_at: string
}

interface Summary {
  total: number
  confirmed: number
  cancelled: number
  totalPeople: number
  totalSlots: number
}

const TIME_SLOTS = Array.from({ length: 18 }, (_, i) => {
  const totalMin = 9 * 60 + i * 20
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`
})

function endTime(startSlot: string, slotsNeeded: number): string {
  const idx = TIME_SLOTS.indexOf(startSlot)
  const endIdx = idx + slotsNeeded
  if (endIdx >= TIME_SLOTS.length) return '3:00 PM'
  return TIME_SLOTS[endIdx]
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const PRICE_MAP: Record<string, number> = {
  'Hair Tinsel': 15,
  'Hair Wraps': 35,
  'Hair Wraps + Charms': 38,
  'Hair Glitter': 5,
  'Glitter Freckles': 10,
}

export default function SummerHairTab({ headers, onLogout }: { headers: Record<string, string>; onLogout: () => void }) {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'confirmed' | 'cancelled'>('confirmed')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const fetchBookings = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/summer-hair', { headers })
      if (res.status === 401) { onLogout(); return }
      const data = await res.json()
      setBookings(data.bookings || [])
      setSummary(data.summary || null)
    } catch (err) {
      console.error('Failed to fetch summer hair bookings:', err)
    } finally {
      setLoading(false)
    }
  }, [headers, onLogout])

  useEffect(() => { fetchBookings() }, [fetchBookings])

  const handleAction = async (id: string, action: string, extra?: Record<string, unknown>) => {
    setActionLoading(id)
    try {
      const res = await fetch('/api/admin/summer-hair', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id, action, ...extra }),
      })
      if (res.status === 401) { onLogout(); return }
      if (res.ok) await fetchBookings()
    } catch (err) {
      console.error('Action failed:', err)
    } finally {
      setActionLoading(null)
    }
  }

  const filtered = bookings.filter(b => filter === 'all' || b.status === filter)

  const estimateTotal = (b: Booking) =>
    b.services.reduce((sum, s) => sum + (PRICE_MAP[s] || 0), 0) * b.party_size

  // Build timeline of occupied slots for the visual grid
  const occupiedSlots = new Map<number, Booking>()
  bookings.filter(b => b.status === 'confirmed').forEach(b => {
    const startIdx = TIME_SLOTS.indexOf(b.time_slot)
    if (startIdx < 0) return
    for (let i = 0; i < (b.slots_needed || 1); i++) {
      occupiedSlots.set(startIdx + i, b)
    }
  })

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Confirmed', value: summary.confirmed, color: 'text-green-600' },
            { label: 'Cancelled', value: summary.cancelled, color: 'text-red-500' },
            { label: 'Total People', value: summary.totalPeople, color: 'text-hampton-navy' },
            { label: 'Slots Used', value: `${summary.totalSlots}/18`, color: 'text-hampton-navy' },
            { label: 'Slots Free', value: `${18 - summary.totalSlots}/18`, color: 'text-blue-600' },
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
          {TIME_SLOTS.map((slot, idx) => {
            const booking = occupiedSlots.get(idx)
            const isStart = booking && booking.time_slot === slot
            return (
              <div
                key={slot}
                className={`text-[10px] py-2 px-1 rounded text-center font-medium
                  ${booking
                    ? 'bg-hampton-navy text-white'
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
        <div className="flex gap-2">
          {(['confirmed', 'cancelled', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors capitalize
                ${filter === f
                  ? 'bg-hampton-navy text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
            >
              {f}
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

      {/* Bookings list */}
      {loading && bookings.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading bookings…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">No {filter === 'all' ? '' : filter} bookings yet</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(b => {
            const isExpanded = expandedId === b.id
            const est = estimateTotal(b)
            return (
              <div key={b.id} className={`bg-white rounded-xl border overflow-hidden transition-colors
                ${b.status === 'cancelled' ? 'border-red-200 opacity-60' : 'border-gray-200'}`}
              >
                {/* Main row */}
                <div
                  className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50/50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : b.id)}
                >
                  <div className="shrink-0">
                    {b.status === 'confirmed'
                      ? <CheckCircle2 className="w-5 h-5 text-green-500" />
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
                    <div className="text-xs text-gray-400 mt-0.5">
                      {b.services.join(', ')}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-hampton-navy">
                      {b.time_slot} – {endTime(b.time_slot, b.slots_needed || 1)}
                    </div>
                    <div className="text-[10px] text-gray-400 flex items-center justify-end gap-1">
                      <Clock className="w-3 h-3" />
                      {(b.slots_needed || 1) * 20} min
                    </div>
                  </div>
                  <div className="text-right shrink-0 w-16">
                    <span className="text-sm font-bold text-green-600">${est}</span>
                  </div>
                  {isExpanded
                    ? <ChevronUp className="w-4 h-4 text-gray-300 shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-gray-300 shrink-0" />
                  }
                </div>

                {/* Expanded details */}
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
                        <p className="text-gray-600">{b.services.join(', ')}</p>
                      </div>
                    </div>

                    {b.notes && (
                      <div className="text-xs">
                        <p className="text-gray-400 font-medium uppercase tracking-wider mb-0.5">Notes</p>
                        <p className="text-gray-600 bg-white rounded-lg border border-gray-100 p-2">{b.notes}</p>
                      </div>
                    )}

                    {/* Duration adjust */}
                    {b.status === 'confirmed' && (
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">Duration:</span>
                        <div className="flex items-center gap-2">
                          <button
                            disabled={actionLoading === b.id || (b.slots_needed || 1) <= 1}
                            onClick={(e) => { e.stopPropagation(); handleAction(b.id, 'adjust_duration', { slotsNeeded: (b.slots_needed || 1) - 1 }) }}
                            className="w-7 h-7 rounded border border-gray-200 bg-white text-gray-500 text-xs font-bold hover:border-gray-400 disabled:opacity-30 transition-colors"
                          >
                            −
                          </button>
                          <span className="text-sm font-semibold text-hampton-navy w-20 text-center">
                            {(b.slots_needed || 1) * 20} min ({b.slots_needed || 1} slot{(b.slots_needed || 1) > 1 ? 's' : ''})
                          </span>
                          <button
                            disabled={actionLoading === b.id || (b.slots_needed || 1) >= 18}
                            onClick={(e) => { e.stopPropagation(); handleAction(b.id, 'adjust_duration', { slotsNeeded: (b.slots_needed || 1) + 1 }) }}
                            className="w-7 h-7 rounded border border-gray-200 bg-white text-gray-500 text-xs font-bold hover:border-gray-400 disabled:opacity-30 transition-colors"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-1">
                      {b.status === 'confirmed' ? (
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
    </div>
  )
}
