'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatMoney, calculateCardFee } from '@/lib/partyPricing'
import type { PaymentMethod } from '@/types/booking-flow'
import { PAYMENT_METHODS } from '@/types/booking-flow'

export default function PayPage() {
  const router = useRouter()
  const [balanceCents, setBalanceCents] = useState(0)
  const [amountCents, setAmountCents] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [instructions, setInstructions] = useState('')

  useEffect(() => {
    fetch('/api/portal/booking')
      .then(r => {
        if (r.status === 401) { router.push('/my-booking/login'); return null }
        return r.json()
      })
      .then(d => {
        if (!d) return
        setBalanceCents(d.booking.balance_due_cents || 0)
        setAmountCents(d.booking.balance_due_cents || 0)
        setLoading(false)
      })
  }, [router])

  const cardFee = paymentMethod === 'card' ? calculateCardFee(amountCents) : 0

  async function handleSubmit() {
    if (amountCents < 5000) {
      setError('Minimum payment is $50')
      return
    }
    setSubmitting(true)
    setError('')
    setInstructions('')

    const res = await fetch('/api/portal/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCents, paymentMethod }),
    })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Payment failed')
      setSubmitting(false)
      return
    }

    if (data.url) {
      window.location.href = data.url
    } else {
      setInstructions(data.instructions || '')
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="min-h-screen bg-[#F6F1EB] flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>
  }

  return (
    <div className="min-h-screen bg-[#F6F1EB] flex items-center justify-center px-4 py-16">
      <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8">
        <h1 className="font-display text-2xl text-[#1a2744] text-center mb-2">Make a Payment</h1>
        <p className="text-gray-500 text-sm text-center mb-6">
          Balance due: <strong className="text-[#1a2744]">{formatMoney(balanceCents)}</strong>
        </p>

        {instructions ? (
          <div className="bg-[#F6F1EB] rounded-xl p-6 text-center">
            <p className="text-[#1a2744] font-medium mb-2">Payment Instructions</p>
            <p className="text-gray-600 text-sm">{instructions}</p>
            <button
              onClick={() => router.push('/my-booking')}
              className="mt-4 bg-[#1a2744] text-white px-6 py-2 rounded-lg text-sm"
            >
              Back to Booking
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Amount */}
            <div>
              <label className="block text-sm text-gray-600 mb-1">Amount</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={(amountCents / 100).toFixed(0)}
                  onChange={e => setAmountCents(Math.round(Number(e.target.value) * 100))}
                  min={50}
                  max={balanceCents / 100}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <button
                  onClick={() => setAmountCents(balanceCents)}
                  className="text-xs text-[#A1B5C8] hover:underline px-2"
                >
                  Full Balance
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Minimum $50</p>
            </div>

            {/* Method */}
            <div>
              <label className="block text-sm text-gray-600 mb-2">Payment Method</label>
              <div className="space-y-2">
                {PAYMENT_METHODS.map(pm => (
                  <label
                    key={pm.value}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer text-sm ${
                      paymentMethod === pm.value ? 'border-[#1a2744] bg-[#1a2744]/5' : 'border-gray-200'
                    }`}
                  >
                    <input
                      type="radio"
                      name="pm"
                      value={pm.value}
                      checked={paymentMethod === pm.value}
                      onChange={e => setPaymentMethod(e.target.value as PaymentMethod)}
                      className="mt-0.5"
                    />
                    <div>
                      <span className="font-medium text-[#1a2744]">{pm.label}</span>
                      {pm.feeLabel && <span className="text-gray-400 text-xs ml-2">{pm.feeLabel}</span>}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Total */}
            <div className="bg-[#F6F1EB] rounded-lg p-4">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Payment</span>
                <span>{formatMoney(amountCents)}</span>
              </div>
              {cardFee > 0 && (
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Processing fee (3%)</span>
                  <span>{formatMoney(cardFee)}</span>
                </div>
              )}
              <div className="flex justify-between text-[#1a2744] font-semibold mt-2 pt-2 border-t border-gray-300">
                <span>Total</span>
                <span>{formatMoney(amountCents + cardFee)}</span>
              </div>
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full bg-[#1a2744] text-white py-3 rounded-lg font-medium hover:bg-[#2a3754] disabled:opacity-50"
            >
              {submitting ? 'Processing...' : paymentMethod === 'card' ? `Pay ${formatMoney(amountCents + cardFee)}` : `Get ${paymentMethod === 'venmo' ? 'Venmo' : paymentMethod === 'zelle' ? 'Zelle' : 'Cash'} Instructions`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
