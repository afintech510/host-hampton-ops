'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { formatMoney } from '@/lib/partyPricing'
import type { PartyBooking } from '@/types/booking-flow'

interface PortalData {
  booking: PartyBooking
  permissions: {
    canEditFull: boolean
    canEditGuestCount: boolean
    fullReason?: string
    guestCountReason?: string
  }
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  awaiting_deposit: { label: 'Awaiting Deposit', color: 'bg-yellow-100 text-yellow-800' },
  pending_review: { label: 'Under Review', color: 'bg-blue-100 text-blue-800' },
  approved: { label: 'Confirmed', color: 'bg-green-100 text-green-800' },
  modifications_locked: { label: 'Locked', color: 'bg-gray-100 text-gray-800' },
  paid_in_full: { label: 'Paid in Full', color: 'bg-emerald-100 text-emerald-800' },
  completed: { label: 'Completed', color: 'bg-purple-100 text-purple-800' },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-800' },
}

function MyBookingInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [guestCount, setGuestCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const paymentSuccess = params.get('payment') === 'success'

  useEffect(() => {
    fetchBooking()
  }, [])

  async function fetchBooking() {
    setLoading(true)
    const res = await fetch('/api/portal/booking')
    if (res.status === 401) {
      router.push('/my-booking/login')
      return
    }
    if (!res.ok) {
      setError('Could not load your booking.')
      setLoading(false)
      return
    }
    const d = await res.json()
    setData(d)
    setGuestCount(d.booking.guest_count_approx || 0)
    setLoading(false)
  }

  async function updateGuestCount() {
    setSaving(true)
    const res = await fetch('/api/portal/booking', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest_count_approx: guestCount }),
    })
    if (!res.ok) {
      const d = await res.json()
      setError(d.error || 'Update failed')
    } else {
      await fetchBooking()
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F1EB] flex items-center justify-center">
        <div className="text-gray-400">Loading your booking...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#F6F1EB] flex items-center justify-center">
        <div className="bg-white rounded-xl p-8 max-w-md text-center">
          <p className="text-red-600 mb-4">{error || 'Something went wrong'}</p>
          <a href="/my-booking/login" className="text-[#1a2744] underline">Try logging in again</a>
        </div>
      </div>
    )
  }

  const { booking, permissions } = data
  const status = STATUS_LABELS[booking.status] || { label: booking.status, color: 'bg-gray-100 text-gray-700' }

  const partyDateFormatted = booking.party_date
    ? new Date(booking.party_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : 'TBD'

  return (
    <div className="min-h-screen bg-[#F6F1EB]">
      <div className="max-w-3xl mx-auto px-4 py-10 md:py-16">
        {paymentSuccess && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 text-center">
            <p className="text-green-800 font-medium">Payment received! Your balance has been updated.</p>
          </div>
        )}

        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs text-gray-400 font-mono">{booking.booking_ref}</p>
              <h1 className="font-display text-2xl text-[#1a2744]">
                {booking.child_name ? `${booking.child_name}'s Party` : booking.package_type || 'Your Party'}
              </h1>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${status.color}`}>
              {status.label}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 text-sm">
            <div>
              <span className="text-gray-400">Date</span>
              <p className="text-[#1a2744] font-medium">{partyDateFormatted}</p>
            </div>
            <div>
              <span className="text-gray-400">Time</span>
              <p className="text-[#1a2744] font-medium">{booking.party_time || 'TBD'}</p>
            </div>
            <div>
              <span className="text-gray-400">Guests</span>
              <p className="text-[#1a2744] font-medium">{booking.guest_count_approx || '—'}</p>
            </div>
            <div>
              <span className="text-gray-400">Theme</span>
              <p className="text-[#1a2744] font-medium">{booking.package_type || '—'}</p>
            </div>
          </div>
        </div>

        {/* Modification banner */}
        {!permissions.canEditFull && permissions.fullReason && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
            <p className="text-amber-800 text-sm">{permissions.fullReason}</p>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {/* Line Items */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="font-display text-lg text-[#1a2744] mb-4">Party Details</h2>
            {(booking.line_items || []).map((item, idx) => {
              const itemTotal = item.guest_multiplied
                ? item.unit_price_cents * item.quantity * (booking.guest_count_approx || 1)
                : item.unit_price_cents * item.quantity
              return (
                <div key={idx} className="flex justify-between py-2 border-b border-gray-100 last:border-0 text-sm">
                  <span className="text-gray-700">
                    {item.name}
                    {item.quantity > 1 && <span className="text-gray-400 ml-1">x{item.quantity}</span>}
                  </span>
                  <span className="text-[#1a2744] font-medium">
                    {itemTotal > 0 ? formatMoney(itemTotal) : 'Included'}
                  </span>
                </div>
              )
            })}
            <div className="flex justify-between pt-3 mt-2 border-t-2 border-[#1a2744] text-[#1a2744] font-semibold">
              <span>Total</span>
              <span>{formatMoney(booking.total_cents || 0)}</span>
            </div>
          </div>

          {/* Balance + Pay */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm p-6 text-center">
              <p className="text-gray-400 text-xs mb-1">Balance Due</p>
              <p className="text-3xl font-bold text-[#1a2744]">{formatMoney(booking.balance_due_cents || 0)}</p>
              {(booking.balance_due_cents || 0) > 0 && (
                <a
                  href="/my-booking/pay"
                  className="mt-4 inline-block bg-[#1a2744] text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-[#2a3754] transition-colors"
                >
                  Make a Payment
                </a>
              )}
            </div>

            {/* Guest count editor */}
            {permissions.canEditGuestCount && (
              <div className="bg-white rounded-xl shadow-sm p-6">
                <h3 className="text-sm font-medium text-[#1a2744] mb-3">Adjust Guest Count</h3>
                <div className="flex items-center gap-3 mb-3">
                  <button
                    onClick={() => setGuestCount(Math.max(1, guestCount - 1))}
                    className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center"
                  >-</button>
                  <span className="text-lg font-semibold text-[#1a2744] w-8 text-center">{guestCount}</span>
                  <button
                    onClick={() => setGuestCount(guestCount + 1)}
                    className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center"
                  >+</button>
                </div>
                {guestCount !== (booking.guest_count_approx || 0) && (
                  <button
                    onClick={updateGuestCount}
                    disabled={saving}
                    className="w-full bg-[#A1B5C8] text-white py-2 rounded-lg text-sm font-medium hover:bg-[#8fa4b7] disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Guest Count'}
                  </button>
                )}
              </div>
            )}

            {/* Payment History */}
            {(booking.payments || []).length > 0 && (
              <div className="bg-white rounded-xl shadow-sm p-6">
                <h3 className="text-sm font-medium text-[#1a2744] mb-3">Payment History</h3>
                {(booking.payments || []).map((p, idx) => (
                  <div key={idx} className="flex justify-between py-2 border-b border-gray-100 last:border-0 text-sm">
                    <div>
                      <span className="text-gray-700 capitalize">{p.payment_type}</span>
                      <span className="text-gray-400 text-xs ml-2">
                        {new Date(p.paid_at).toLocaleDateString()}
                      </span>
                    </div>
                    <span className={`font-medium ${p.payment_type === 'refund' ? 'text-red-600' : 'text-green-700'}`}>
                      {p.payment_type === 'refund' ? '-' : ''}{formatMoney(p.amount_cents)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-gray-400 text-xs mt-10">
          Questions? Call{' '}
          <a href="tel:6319989325" className="text-[#1a2744] hover:underline">(631) 998-9325</a>
        </p>
      </div>
    </div>
  )
}

export default function MyBookingContent() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F6F1EB]" />}>
      <MyBookingInner />
    </Suspense>
  )
}
