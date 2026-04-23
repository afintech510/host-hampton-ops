'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { calculateCardFee, calculateLineItemTotal, formatMoney, getDepositCents } from '@/lib/partyPricing'
import type { BookingLineItem, PaymentMethod } from '@/types/booking-flow'
import { PAYMENT_METHODS } from '@/types/booking-flow'

const STORAGE_KEY = 'hh_quote_data'

interface QuoteData {
  theme: string | null
  themeName: string | null
  guestCount: number
  foodChoice: string | null
  cupcakeFlavor: string | null
  activities: string[]
  food: string[]
  desserts: string[]
  decor: string[]
  entertainment: string[]
  beverages: string[]
  extras: string[]
  contactName: string
  contactEmail: string
  contactPhone: string
  summary: string
  totalCents: number
  childName?: string
  childAge?: string
  preferredDate?: string
  preferredTime?: string
  notes?: string
  lineItems?: BookingLineItem[]
}

export default function SummaryContent() {
  const router = useRouter()
  const [quote, setQuote] = useState<QuoteData | null>(null)
  const [lineItems, setLineItems] = useState<BookingLineItem[]>([])
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card')
  const [guestCount, setGuestCount] = useState(10)
  const [partyDate, setPartyDate] = useState('')
  const [partyTime, setPartyTime] = useState('')
  const [childName, setChildName] = useState('')
  const [childAge, setChildAge] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      router.push('/kids-party-menu')
      return
    }
    try {
      const data = JSON.parse(raw) as QuoteData
      setQuote(data)
      setGuestCount(data.guestCount || 10)
      setChildName(data.childName || '')
      setChildAge(data.childAge || '')
      setNotes(data.notes || '')
      if (data.preferredDate) setPartyDate(data.preferredDate)
      if (data.preferredTime) setPartyTime(data.preferredTime)

      if (data.lineItems?.length) {
        setLineItems(data.lineItems)
      } else {
        setLineItems(buildLineItemsFromQuote(data))
      }
    } catch {
      router.push('/kids-party-menu')
    }
  }, [router])

  function buildLineItemsFromQuote(data: QuoteData): BookingLineItem[] {
    const items: BookingLineItem[] = []

    if (data.themeName) {
      items.push({
        name: data.themeName,
        category: 'theme',
        quantity: 1,
        unit_price_cents: 0,
        price_type: 'flat',
        guest_multiplied: false,
      })
    }

    const allSelections = [
      ...(data.food || []).map(n => ({ name: n, category: 'food-add-on' })),
      ...(data.desserts || []).map(n => ({ name: n, category: 'dessert-add-on' })),
      ...(data.activities || []).map(n => ({ name: n, category: 'activity-add-on' })),
      ...(data.decor || []).map(n => ({ name: n, category: 'decor-add-on' })),
      ...(data.entertainment || []).map(n => ({ name: n, category: 'entertainment-add-on' })),
      ...(data.beverages || []).map(n => ({ name: n, category: 'beverage-add-on' })),
      ...(data.extras || []).map(n => ({ name: n, category: 'extra' })),
    ]

    for (const sel of allSelections) {
      items.push({
        name: sel.name,
        category: sel.category,
        quantity: 1,
        unit_price_cents: 0,
        price_type: 'flat',
        guest_multiplied: false,
      })
    }

    return items
  }

  const depositCents = getDepositCents()
  const subtotalCents = calculateLineItemTotal(lineItems, guestCount)
  const cardFeeCents = paymentMethod === 'card' ? calculateCardFee(depositCents) : 0
  const balanceDueCents = Math.max(0, subtotalCents - depositCents)

  async function handleSubmit() {
    if (!partyDate || !partyTime) {
      setError('Please select a date and time for your party.')
      return
    }
    if (!quote?.contactName || !quote?.contactEmail) {
      setError('Contact information is missing. Please go back to the builder.')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/party-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineItems,
          contactName: quote.contactName,
          contactEmail: quote.contactEmail,
          contactPhone: quote.contactPhone,
          childName,
          childAge,
          guestCount,
          partyDate,
          partyTime,
          packageType: quote.themeName || 'Kids Party',
          paymentMethod,
          notes,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Checkout failed')

      localStorage.removeItem(STORAGE_KEY)
      window.location.href = data.url
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  if (!quote) {
    return <div className="min-h-screen bg-[#F6F1EB]" />
  }

  const categoryOrder = ['theme', 'food-add-on', 'dessert-add-on', 'activity-add-on', 'decor-add-on', 'entertainment-add-on', 'beverage-add-on', 'extra']
  const groupedItems = categoryOrder.reduce((acc, cat) => {
    const items = lineItems.filter(i => i.category === cat)
    if (items.length) acc.push({ category: cat, items })
    return acc
  }, [] as { category: string; items: BookingLineItem[] }[])

  const categoryLabels: Record<string, string> = {
    theme: 'Theme',
    'food-add-on': 'Food',
    'dessert-add-on': 'Desserts',
    'activity-add-on': 'Activities',
    'decor-add-on': 'Decor',
    'entertainment-add-on': 'Entertainment',
    'beverage-add-on': 'Beverages',
    extra: 'Extras',
  }

  return (
    <div className="min-h-screen bg-[#F6F1EB]">
      <div className="max-w-5xl mx-auto px-4 py-10 md:py-16">
        <h1 className="font-display text-3xl md:text-4xl text-[#1a2744] text-center mb-2">
          Review Your Party
        </h1>
        <p className="text-gray-500 text-center mb-10">
          Confirm your selections, pick a date, and place your deposit.
        </p>

        <div className="grid md:grid-cols-5 gap-8">
          {/* Left: Line items */}
          <div className="md:col-span-3 space-y-6">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="font-display text-xl text-[#1a2744] mb-4">Your Selections</h2>

              {groupedItems.map(group => (
                <div key={group.category} className="mb-4">
                  <h3 className="text-xs font-semibold text-[#A1B5C8] uppercase tracking-wider mb-2">
                    {categoryLabels[group.category] || group.category}
                  </h3>
                  {group.items.map((item, idx) => {
                    const itemTotal = item.guest_multiplied
                      ? item.unit_price_cents * item.quantity * guestCount
                      : item.unit_price_cents * item.quantity
                    return (
                      <div key={idx} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                        <div>
                          <span className="text-[#1a2744] text-sm">{item.name}</span>
                          {item.quantity > 1 && (
                            <span className="text-gray-400 text-xs ml-1">x{item.quantity}</span>
                          )}
                          {item.guest_multiplied && (
                            <span className="text-gray-400 text-xs ml-1">(per guest)</span>
                          )}
                        </div>
                        <span className="text-[#1a2744] text-sm font-medium">
                          {itemTotal > 0 ? formatMoney(itemTotal) : 'Included'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ))}

              {/* Guest count adjuster */}
              <div className="flex items-center justify-between pt-4 border-t border-gray-200 mt-4">
                <span className="text-[#1a2744] font-medium">Guest Count</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setGuestCount(Math.max(1, guestCount - 1))}
                    className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-500 hover:bg-gray-50"
                  >
                    -
                  </button>
                  <span className="text-[#1a2744] font-semibold w-8 text-center">{guestCount}</span>
                  <button
                    onClick={() => setGuestCount(guestCount + 1)}
                    className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center text-gray-500 hover:bg-gray-50"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Totals */}
              <div className="mt-6 pt-4 border-t-2 border-[#1a2744] space-y-2">
                <div className="flex justify-between text-[#1a2744]">
                  <span className="font-semibold">Subtotal</span>
                  <span className="font-semibold">{formatMoney(subtotalCents)}</span>
                </div>
                <div className="flex justify-between text-gray-500 text-sm">
                  <span>Deposit (due now)</span>
                  <span>{formatMoney(depositCents)}</span>
                </div>
                {cardFeeCents > 0 && (
                  <div className="flex justify-between text-gray-500 text-sm">
                    <span>Card processing fee (3%)</span>
                    <span>{formatMoney(cardFeeCents)}</span>
                  </div>
                )}
                <div className="flex justify-between text-gray-500 text-sm">
                  <span>Remaining balance</span>
                  <span>{formatMoney(balanceDueCents)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Date/Time + Payment + Contact */}
          <div className="md:col-span-2 space-y-6">
            {/* Date & Time */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="font-display text-xl text-[#1a2744] mb-4">Date & Time</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Party Date</label>
                  <input
                    type="date"
                    value={partyDate}
                    onChange={e => setPartyDate(e.target.value)}
                    min={new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#A1B5C8] focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Party Time</label>
                  <select
                    value={partyTime}
                    onChange={e => setPartyTime(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#A1B5C8] focus:border-transparent outline-none"
                  >
                    <option value="">Select a time</option>
                    <option value="10:00 AM">10:00 AM</option>
                    <option value="11:00 AM">11:00 AM</option>
                    <option value="12:00 PM">12:00 PM</option>
                    <option value="1:00 PM">1:00 PM</option>
                    <option value="2:00 PM">2:00 PM</option>
                    <option value="3:00 PM">3:00 PM</option>
                    <option value="4:00 PM">4:00 PM</option>
                    <option value="5:00 PM">5:00 PM</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Child Info */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="font-display text-xl text-[#1a2744] mb-4">Birthday Child</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Child&apos;s Name</label>
                  <input
                    type="text"
                    value={childName}
                    onChange={e => setChildName(e.target.value)}
                    placeholder="e.g. Emma"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#A1B5C8] focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Age</label>
                  <input
                    type="text"
                    value={childAge}
                    onChange={e => setChildAge(e.target.value)}
                    placeholder="e.g. 7"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#A1B5C8] focus:border-transparent outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="font-display text-xl text-[#1a2744] mb-4">Notes</h2>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="Allergies, special requests, etc."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#A1B5C8] focus:border-transparent outline-none resize-none"
              />
            </div>

            {/* Payment Method */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="font-display text-xl text-[#1a2744] mb-4">Payment Method</h2>
              <div className="space-y-2">
                {PAYMENT_METHODS.map(pm => (
                  <label
                    key={pm.value}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      paymentMethod === pm.value
                        ? 'border-[#1a2744] bg-[#1a2744]/5'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="paymentMethod"
                      value={pm.value}
                      checked={paymentMethod === pm.value}
                      onChange={e => setPaymentMethod(e.target.value as PaymentMethod)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-sm font-medium text-[#1a2744]">
                        {pm.label}
                        {pm.feeLabel && (
                          <span className="text-xs text-gray-400 ml-2">{pm.feeLabel}</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">{pm.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Contact summary */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="font-display text-xl text-[#1a2744] mb-4">Contact</h2>
              <p className="text-sm text-gray-600">{quote.contactName}</p>
              <p className="text-sm text-gray-500">{quote.contactEmail}</p>
              {quote.contactPhone && (
                <p className="text-sm text-gray-500">{quote.contactPhone}</p>
              )}
              <button
                onClick={() => router.push('/kids-party-menu')}
                className="text-xs text-[#A1B5C8] hover:underline mt-2"
              >
                Edit in builder
              </button>
            </div>

            {/* Submit */}
            <div className="bg-[#1a2744] rounded-xl p-6 text-center">
              <p className="text-white/70 text-xs mb-3">
                Host Hampton will confirm all details within 24 hours.
              </p>

              {error && (
                <p className="text-red-300 text-sm mb-3">{error}</p>
              )}

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full bg-white text-[#1a2744] font-semibold py-3 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
              >
                {submitting
                  ? 'Processing...'
                  : paymentMethod === 'card'
                    ? `Pay ${formatMoney(depositCents + cardFeeCents)} Deposit`
                    : `Reserve — Pay ${formatMoney(depositCents)} via ${paymentMethod === 'venmo' ? 'Venmo' : paymentMethod === 'zelle' ? 'Zelle' : 'Cash'}`
                }
              </button>

              <p className="text-white/50 text-xs mt-3">
                {paymentMethod === 'card'
                  ? `${formatMoney(depositCents)} deposit + ${formatMoney(cardFeeCents)} processing fee`
                  : 'No card fee — pay directly'
                }
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
