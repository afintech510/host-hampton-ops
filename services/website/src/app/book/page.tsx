'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useState, useCallback, useEffect } from 'react'
import { Lock, User, Mail, Phone, Baby, Users, Loader2, Bookmark } from 'lucide-react'
import UniversalCalendar from '@/components/UniversalCalendar'
import type { CalendarSelection } from '@/components/UniversalCalendar/types'

const LS_KEY = 'hh_quote_data'

interface StoredQuote {
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
  summary?: string
  totalCents?: number
}

function BookingForm() {
  const params = useSearchParams()
  const packageName = params.get('package') ?? ''
  const cancelled = params.get('cancelled')
  const defaultType = params.get('type') || ''
  const fromQuote = params.get('from') === 'quote'

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState<CalendarSelection | null>(null)
  const [quoteData, setQuoteData] = useState<StoredQuote | null>(null)
  const [form, setForm] = useState({
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    childName: '',
    childAge: '',
    guestCount: '',
    packageName,
    notes: '',
  })

  // Read quote data from localStorage when coming from quote builder
  useEffect(() => {
    if (!fromQuote) return
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const data: StoredQuote = JSON.parse(raw)
      setQuoteData(data)
      setForm(prev => ({
        ...prev,
        contactName: data.contactName || prev.contactName,
        contactEmail: data.contactEmail || prev.contactEmail,
        contactPhone: data.contactPhone || prev.contactPhone,
        guestCount: data.guestCount ? String(data.guestCount) : prev.guestCount,
        packageName: data.themeName || prev.packageName,
        notes: data.summary || prev.notes,
      }))
    } catch { /* ignore parse errors */ }
  }, [fromQuote])

  function update(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleCalendarSelect = useCallback((sel: CalendarSelection) => {
    setSelection(sel)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selection?.date || !selection?.timeSlot) {
      setError('Please select a date and time from the calendar above')
      return
    }
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          partyDate: selection.date,
          partyTime: selection.timeSlot.start,
          eventType: selection.bookingType?.slug || 'other',
          bookingTypeSlug: selection.bookingType?.slug,
          partyTags: {
            theme: form.packageName || undefined,
          },
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Checkout failed')
      if (data.url) window.location.href = data.url
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  const bookingType = selection?.bookingType
  const hasDeposit = bookingType ? bookingType.requires_deposit && bookingType.deposit_cents > 0 : true
  const depositDollars = bookingType ? Math.round(bookingType.deposit_cents / 100) : 250
  const showChildFields = bookingType?.tags?.some(t => ['kids-party', 'childrens'].includes(t)) ?? true

  return (
    <div className="min-h-screen">
      <section className="py-14 text-center px-4">
        <Lock size={28} className="text-hampton-pink mx-auto mb-3" />
        <h1 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-3">Reserve Your Date</h1>
        <p className="text-hampton-navy text-base max-w-md mx-auto">
          {hasDeposit
            ? `Pay the $${depositDollars} deposit to lock in your date. All details can be changed up to 1 week before.`
            : 'Select your preferred date and time to book your appointment.'}
        </p>
      </section>

      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
        {cancelled && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3 mb-6 text-sm text-red-700">
            Payment was cancelled. You can try again below.
          </div>
        )}

        {/* Calendar */}
        <div className="bg-white rounded-2xl border border-hampton-pink/20 shadow-sm p-6 mb-6">
          <UniversalCalendar
            mode="booking"
            defaultBookingType={defaultType || undefined}
            expandable={false}
            initialExpanded={true}
            showSummary={false}
            onSelect={handleCalendarSelect}
          />
        </div>

        {/* Contact form — appears when date & time selected */}
        {selection?.timeSlot && (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-hampton-pink/20 shadow-sm p-8 space-y-6">
            {/* Selected slot display */}
            <div className="bg-hampton-pink/10 rounded-xl px-5 py-3 text-center">
              <p className="text-hampton-navy text-sm font-semibold">
                {bookingType?.label || 'Booking'} &middot;{' '}
                {new Date(selection.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                {' at '}
                {(() => {
                  const [h, m] = selection.timeSlot!.start.split(':').map(Number)
                  const ampm = h >= 12 ? 'PM' : 'AM'
                  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
                  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
                })()}
              </p>
            </div>

            {/* Quote summary when coming from quote builder */}
            {fromQuote && quoteData?.summary ? (
              <div className="bg-hampton-pink/10 border border-hampton-pink/20 rounded-xl px-5 py-4">
                <p className="text-hampton-navy text-xs font-semibold uppercase tracking-wider mb-2">Your Party Selections</p>
                <pre className="text-hampton-navy/70 text-xs whitespace-pre-wrap font-sans leading-relaxed">{quoteData.summary}</pre>
              </div>
            ) : packageName ? (
              <div className="bg-hampton-pink/20 rounded-xl px-5 py-3 text-center">
                <p className="text-hampton-navy text-sm font-semibold">
                  Selected Package: <span className="text-hampton-navy">{packageName}</span>
                </p>
              </div>
            ) : null}

            {/* Contact Info */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label flex items-center gap-2">
                  <User size={14} className="text-hampton-navy" /> Your Name *
                </label>
                <input type="text" required placeholder="Jane Smith" value={form.contactName}
                       onChange={e => update('contactName', e.target.value)} className="form-input" />
              </div>
              <div>
                <label className="form-label flex items-center gap-2">
                  <Mail size={14} className="text-hampton-navy" /> Email *
                </label>
                <input type="email" required placeholder="jane@email.com" value={form.contactEmail}
                       onChange={e => update('contactEmail', e.target.value)} className="form-input" />
              </div>
            </div>

            <div>
              <label className="form-label flex items-center gap-2">
                <Phone size={14} className="text-hampton-navy" /> Phone *
              </label>
              <input type="tel" required placeholder="(631) 555-1234" value={form.contactPhone}
                     onChange={e => update('contactPhone', e.target.value)} className="form-input" />
            </div>

            {/* Child & Guest Info (show for kid parties) */}
            {showChildFields && (
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="form-label flex items-center gap-2">
                    <Baby size={14} className="text-hampton-navy" /> Child&apos;s Name
                  </label>
                  <input type="text" placeholder="Emma" value={form.childName}
                         onChange={e => update('childName', e.target.value)} className="form-input" />
                </div>
                <div>
                  <label className="form-label flex items-center gap-2">
                    <Baby size={14} className="text-hampton-navy" /> Child&apos;s Age
                  </label>
                  <input type="number" min="1" max="18" placeholder="7" value={form.childAge}
                         onChange={e => update('childAge', e.target.value)} className="form-input" />
                </div>
                <div>
                  <label className="form-label flex items-center gap-2">
                    <Users size={14} className="text-hampton-navy" /> Guest Count
                  </label>
                  <input type="number" min="1" max="50" placeholder="10" value={form.guestCount}
                         onChange={e => update('guestCount', e.target.value)} className="form-input" />
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="form-label">Special Requests or Notes</label>
              <textarea rows={3} placeholder="Dietary needs, theme preferences, special requests..."
                        value={form.notes} onChange={e => update('notes', e.target.value)}
                        className="form-input resize-none" />
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Save success */}
            {saveSuccess && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
                Quote saved! Check your email for a link to continue editing anytime.
              </div>
            )}

            {/* Action buttons */}
            <div className={`flex gap-3 ${fromQuote && quoteData ? '' : 'flex-col'}`}>
              {/* Save Party — only when coming from quote builder */}
              {fromQuote && quoteData && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    if (!form.contactEmail) return
                    setSaving(true)
                    setSaveSuccess(false)
                    try {
                      await fetch('/api/quote/save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          name: form.contactName,
                          email: form.contactEmail,
                          phone: form.contactPhone,
                          quoteData,
                          summary: quoteData.summary || '',
                          partyDate: selection?.date || null,
                          partyTime: selection?.timeSlot?.start || null,
                        }),
                      })
                      setSaveSuccess(true)
                    } catch { /* silent */ }
                    setSaving(false)
                  }}
                  className="flex-1 border-2 border-hampton-navy text-hampton-navy font-semibold py-4 px-6 rounded-full hover:bg-hampton-navy/5 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <><Loader2 size={16} className="animate-spin" /> Saving...</>
                  ) : (
                    <><Bookmark size={16} /> Save Party</>
                  )}
                </button>
              )}

              {/* Pay Deposit / Book */}
              <button type="submit" disabled={loading}
                      className={`${fromQuote && quoteData ? 'flex-1' : 'w-full'} bg-hampton-navy text-hampton-ivory font-semibold py-4 px-8 rounded-full hover:bg-opacity-90 transition-all disabled:opacity-60 flex items-center justify-center gap-2`}>
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    {hasDeposit ? 'Redirecting to Stripe...' : 'Booking...'}
                  </>
                ) : hasDeposit ? (
                  <>
                    <Lock size={16} />
                    Pay ${depositDollars} Deposit
                  </>
                ) : (
                  'Book Appointment'
                )}
              </button>
            </div>

            {hasDeposit && (
              <p className="text-center text-hampton-navy text-xs">
                Secure payment via Stripe. Your ${depositDollars} deposit is applied toward your total balance.
                <br />You can change all details up to 1 week before your event.
              </p>
            )}
          </form>
        )}
      </section>
    </div>
  )
}

export default function BookPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-hampton-navy">Loading...</p></div>}>
      <BookingForm />
    </Suspense>
  )
}
