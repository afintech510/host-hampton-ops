'use client'

import { useState, useEffect } from 'react'
import { formatMoney } from '@/lib/partyPricing'

interface PartyBookingSummary {
  id: string
  booking_ref: string
  status: string
  party_date: string
  party_time: string
  package_type: string
  guest_count_approx: number
  child_name: string | null
  contact_name: string
  contact_email: string
  contact_phone: string | null
  total_cents: number
  balance_due_cents: number
  payment_method_preference: string
  created_at: string
}

interface PartyDetail extends PartyBookingSummary {
  admin_notes: string | null
  notes: string | null
  approved_at: string | null
  paid_in_full_at: string | null
  line_items: { name: string; quantity: number; unit_price_cents: number; guest_multiplied: boolean; category: string }[]
  payments: { id: string; payment_type: string; payment_method: string; amount_cents: number; card_fee_cents: number; paid_at: string; recorded_by: string; notes: string | null }[]
  modifications: { id: string; modified_by: string; change_summary: string; created_at: string }[]
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  awaiting_deposit: { label: 'Awaiting Deposit', color: 'bg-yellow-100 text-yellow-800' },
  pending_review: { label: 'Pending Review', color: 'bg-blue-100 text-blue-800' },
  deposit_paid: { label: 'Deposit Paid', color: 'bg-blue-100 text-blue-800' },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-800' },
  modifications_locked: { label: 'Locked', color: 'bg-gray-100 text-gray-800' },
  paid_in_full: { label: 'Paid in Full', color: 'bg-emerald-100 text-emerald-800' },
  completed: { label: 'Completed', color: 'bg-purple-100 text-purple-800' },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-800' },
}

const STATUS_FILTERS = ['all', 'pending_review', 'deposit_paid', 'approved', 'modifications_locked', 'paid_in_full', 'completed', 'cancelled']

export default function PartiesTab({ headers }: { headers: HeadersInit; onLogout: () => void }) {
  const [bookings, setBookings] = useState<PartyBookingSummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('pending_review')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PartyDetail | null>(null)
  const [actionLoading, setActionLoading] = useState('')
  const [changeMessage, setChangeMessage] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('cash')
  const [payNotes, setPayNotes] = useState('')

  useEffect(() => { fetchBookings() }, [statusFilter, page])

  async function fetchBookings() {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page) })
    if (statusFilter !== 'all') params.set('status', statusFilter)
    const res = await fetch(`/api/admin/parties?${params}`, { headers })
    const data = await res.json()
    setBookings(data.bookings || [])
    setTotal(data.total || 0)
    setLoading(false)
  }

  async function fetchDetail(id: string) {
    const res = await fetch(`/api/admin/parties/${id}`, { headers })
    const data = await res.json()
    setSelected(data)
  }

  async function doAction(action: string, extra?: Record<string, unknown>) {
    if (!selected) return
    setActionLoading(action)
    await fetch(`/api/admin/parties/${selected.id}`, {
      method: 'POST',
      headers: { ...Object.fromEntries(new Headers(headers).entries()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    })
    await fetchDetail(selected.id)
    await fetchBookings()
    setActionLoading('')
  }

  // List view
  if (!selected) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          {STATUS_FILTERS.map(s => {
            const info = STATUS_LABELS[s] || { label: s === 'all' ? 'All' : s, color: 'bg-gray-100 text-gray-700' }
            return (
              <button
                key={s}
                onClick={() => { setStatusFilter(s); setPage(1) }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  statusFilter === s ? 'bg-[#1a2744] text-white' : info.color + ' hover:opacity-80'
                }`}
              >
                {s === 'all' ? 'All' : info.label}
              </button>
            )
          })}
        </div>

        {loading ? (
          <p className="text-gray-400 text-center py-10">Loading...</p>
        ) : bookings.length === 0 ? (
          <p className="text-gray-400 text-center py-10">No bookings found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2 pr-4">Ref</th>
                  <th className="pb-2 pr-4">Customer</th>
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Theme</th>
                  <th className="pb-2 pr-4">Guests</th>
                  <th className="pb-2 pr-4">Total</th>
                  <th className="pb-2 pr-4">Balance</th>
                  <th className="pb-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map(b => {
                  const st = STATUS_LABELS[b.status] || { label: b.status, color: 'bg-gray-100 text-gray-700' }
                  return (
                    <tr
                      key={b.id}
                      onClick={() => fetchDetail(b.id)}
                      className="border-b hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="py-3 pr-4 font-mono text-xs">{b.booking_ref}</td>
                      <td className="py-3 pr-4">
                        {b.contact_name}
                        {b.child_name && <span className="text-gray-400 text-xs ml-1">({b.child_name})</span>}
                      </td>
                      <td className="py-3 pr-4">{b.party_date || '—'}</td>
                      <td className="py-3 pr-4">{b.package_type || '—'}</td>
                      <td className="py-3 pr-4 text-center">{b.guest_count_approx || '—'}</td>
                      <td className="py-3 pr-4">{formatMoney(b.total_cents || 0)}</td>
                      <td className="py-3 pr-4 font-medium">{formatMoney(b.balance_due_cents || 0)}</td>
                      <td className="py-3 pr-4">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${st.color}`}>{st.label}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {total > 25 && (
          <div className="flex justify-center gap-2 mt-4">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 text-sm border rounded disabled:opacity-30">Prev</button>
            <span className="px-3 py-1 text-sm text-gray-500">{page} / {Math.ceil(total / 25)}</span>
            <button disabled={page >= Math.ceil(total / 25)} onClick={() => setPage(p => p + 1)} className="px-3 py-1 text-sm border rounded disabled:opacity-30">Next</button>
          </div>
        )}
      </div>
    )
  }

  // Detail view
  const st = STATUS_LABELS[selected.status] || { label: selected.status, color: 'bg-gray-100 text-gray-700' }

  return (
    <div>
      <button onClick={() => setSelected(null)} className="text-sm text-[#A1B5C8] hover:underline mb-4">&larr; Back to list</button>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <p className="font-mono text-xs text-gray-400">{selected.booking_ref}</p>
          <h2 className="text-xl font-semibold text-[#1a2744]">
            {selected.child_name ? `${selected.child_name}'s Party` : selected.package_type || 'Party Booking'}
          </h2>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-6">
          {/* Customer info */}
          <div className="bg-white rounded-xl border p-5">
            <h3 className="text-sm font-medium text-[#1a2744] mb-3">Customer</h3>
            <div className="text-sm space-y-1 text-gray-600">
              <p><strong>{selected.contact_name}</strong></p>
              <p>{selected.contact_email}</p>
              {selected.contact_phone && <p>{selected.contact_phone}</p>}
              <p className="text-gray-400">Method preference: {selected.payment_method_preference || '—'}</p>
            </div>
          </div>

          {/* Event details */}
          <div className="bg-white rounded-xl border p-5">
            <h3 className="text-sm font-medium text-[#1a2744] mb-3">Event</h3>
            <div className="text-sm space-y-1 text-gray-600">
              <p>Date: <strong>{selected.party_date || 'TBD'}</strong></p>
              <p>Time: <strong>{selected.party_time || 'TBD'}</strong></p>
              <p>Guests: <strong>{selected.guest_count_approx || '—'}</strong></p>
              <p>Theme: <strong>{selected.package_type || '—'}</strong></p>
              {selected.child_name && <p>Child: <strong>{selected.child_name}</strong></p>}
              {selected.notes && <p className="text-gray-400">Notes: {selected.notes}</p>}
            </div>
          </div>

          {/* Line items */}
          <div className="bg-white rounded-xl border p-5">
            <h3 className="text-sm font-medium text-[#1a2744] mb-3">Line Items</h3>
            {(selected.line_items || []).map((li, idx) => (
              <div key={idx} className="flex justify-between py-1 text-sm border-b border-gray-100 last:border-0">
                <span className="text-gray-600">{li.name}{li.quantity > 1 ? ` ×${li.quantity}` : ''}{li.guest_multiplied ? ' (per guest)' : ''}</span>
                <span className="text-[#1a2744]">{formatMoney(li.guest_multiplied ? li.unit_price_cents * li.quantity * (selected.guest_count_approx || 1) : li.unit_price_cents * li.quantity)}</span>
              </div>
            ))}
            <div className="flex justify-between pt-2 mt-2 border-t-2 border-[#1a2744] text-[#1a2744] font-semibold text-sm">
              <span>Total</span><span>{formatMoney(selected.total_cents || 0)}</span>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Actions */}
          <div className="bg-white rounded-xl border p-5">
            <h3 className="text-sm font-medium text-[#1a2744] mb-3">Actions</h3>
            <div className="space-y-2">
              {(selected.status === 'pending_review' || selected.status === 'deposit_paid') && (
                <button
                  onClick={() => doAction('approve')}
                  disabled={!!actionLoading}
                  className="w-full bg-green-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  {actionLoading === 'approve' ? 'Approving...' : 'Approve Booking'}
                </button>
              )}

              <div>
                <textarea
                  value={changeMessage}
                  onChange={e => setChangeMessage(e.target.value)}
                  placeholder="Message to customer..."
                  rows={2}
                  className="w-full border rounded-lg px-3 py-2 text-sm mb-1"
                />
                <button
                  onClick={() => { doAction('request_changes', { message: changeMessage }); setChangeMessage('') }}
                  disabled={!changeMessage || !!actionLoading}
                  className="w-full bg-amber-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-amber-600 disabled:opacity-50"
                >
                  Send Message to Customer
                </button>
              </div>

              <button
                onClick={() => doAction('send_portal_link')}
                disabled={!!actionLoading}
                className="w-full bg-[#A1B5C8] text-white py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {actionLoading === 'send_portal_link' ? 'Sending...' : 'Send Portal Link'}
              </button>

              {selected.status !== 'cancelled' && selected.status !== 'completed' && (
                <button
                  onClick={() => { if (confirm('Cancel this booking?')) doAction('cancel') }}
                  disabled={!!actionLoading}
                  className="w-full bg-red-100 text-red-700 py-2 rounded-lg text-sm font-medium hover:bg-red-200 disabled:opacity-50"
                >
                  Cancel Booking
                </button>
              )}
            </div>
          </div>

          {/* Balance + Record Payment */}
          <div className="bg-white rounded-xl border p-5">
            <div className="text-center mb-4">
              <p className="text-gray-400 text-xs">Balance Due</p>
              <p className="text-2xl font-bold text-[#1a2744]">{formatMoney(selected.balance_due_cents || 0)}</p>
            </div>

            {(selected.balance_due_cents || 0) > 0 && (
              <div className="space-y-2 border-t pt-4">
                <h4 className="text-xs font-medium text-gray-500">Record Payment</h4>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={payAmount}
                    onChange={e => setPayAmount(e.target.value)}
                    placeholder="Amount ($)"
                    className="flex-1 border rounded px-2 py-1.5 text-sm"
                  />
                  <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className="border rounded px-2 py-1.5 text-sm">
                    <option value="cash">Cash</option>
                    <option value="venmo">Venmo</option>
                    <option value="zelle">Zelle</option>
                    <option value="card">Card</option>
                  </select>
                </div>
                <input
                  type="text"
                  value={payNotes}
                  onChange={e => setPayNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  className="w-full border rounded px-2 py-1.5 text-sm"
                />
                <button
                  onClick={() => {
                    const cents = Math.round(Number(payAmount) * 100)
                    if (cents <= 0) return
                    doAction('record_payment', { amount_cents: cents, payment_method: payMethod, notes: payNotes })
                    setPayAmount('')
                    setPayNotes('')
                  }}
                  disabled={!payAmount || !!actionLoading}
                  className="w-full bg-[#1a2744] text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Record Payment
                </button>
              </div>
            )}
          </div>

          {/* Payment History */}
          {(selected.payments || []).length > 0 && (
            <div className="bg-white rounded-xl border p-5">
              <h3 className="text-sm font-medium text-[#1a2744] mb-3">Payments</h3>
              {selected.payments.map(p => (
                <div key={p.id} className="flex justify-between py-1.5 text-sm border-b border-gray-100 last:border-0">
                  <div>
                    <span className="capitalize text-gray-700">{p.payment_type}</span>
                    <span className="text-gray-400 text-xs ml-2">{p.payment_method}</span>
                    <span className="text-gray-300 text-xs ml-2">{new Date(p.paid_at).toLocaleDateString()}</span>
                    {p.recorded_by === 'admin' && <span className="text-xs text-amber-500 ml-1">(admin)</span>}
                  </div>
                  <span className={`font-medium ${p.payment_type === 'refund' ? 'text-red-600' : 'text-green-700'}`}>
                    {formatMoney(p.amount_cents)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Modification Log */}
          {(selected.modifications || []).length > 0 && (
            <div className="bg-white rounded-xl border p-5">
              <h3 className="text-sm font-medium text-[#1a2744] mb-3">Activity Log</h3>
              {selected.modifications.map(m => (
                <div key={m.id} className="py-1.5 text-xs border-b border-gray-100 last:border-0">
                  <span className="text-gray-400">{new Date(m.created_at).toLocaleString()}</span>
                  <span className="text-gray-500 ml-2 capitalize">[{m.modified_by}]</span>
                  <span className="text-gray-700 ml-1">{m.change_summary}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
