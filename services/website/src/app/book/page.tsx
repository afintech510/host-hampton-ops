'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useState, useEffect, useCallback } from 'react'
import { Lock, Calendar, User, Mail, Phone, Baby, Users, Sparkles, Loader2 } from 'lucide-react'

const eventTypes = [
  { value: 'kid-party', label: 'Kids Birthday Party' },
  { value: 'room-rental', label: 'Room Rental' },
  { value: 'adult-event', label: 'Adult Event' },
  { value: 'communion', label: 'Communion Party' },
  { value: 'fundraiser', label: 'Fundraiser' },
  { value: 'other', label: 'Other' },
]

const timeSlots = [
  '10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM',
  '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM', '6:00 PM',
]

function BookingForm() {
  const params = useSearchParams()
  const packageName = params.get('package') ?? ''
  const cancelled = params.get('cancelled')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    childName: '',
    childAge: '',
    guestCount: '',
    partyDate: '',
    partyTime: '2:00 PM',
    eventType: 'kid-party',
    packageName,
    notes: '',
  })

  const [blockedDates, setBlockedDates] = useState<Set<string>>(new Set())

  const fetchAvailability = useCallback(async (dateStr: string) => {
    const month = dateStr.slice(0, 7) // YYYY-MM
    try {
      const res = await fetch(`/api/availability?month=${month}`)
      const data = await res.json()
      if (data.blockedDates) setBlockedDates(new Set(data.blockedDates))
    } catch { /* silently degrade — all dates available */ }
  }, [])

  useEffect(() => {
    // Fetch current month availability on mount
    const now = new Date()
    fetchAvailability(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`)
  }, [fetchAvailability])

  function update(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
    if (field === 'partyDate' && value) fetchAvailability(value)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
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

  // Minimum date = tomorrow
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const minDate = tomorrow.toISOString().split('T')[0]

  return (
    <div className="min-h-screen bg-hampton-ivory">
      <section className="bg-hampton-navy py-14 text-center px-4">
        <Lock size={28} className="text-hampton-pink mx-auto mb-3" />
        <h1 className="font-serif text-3xl md:text-4xl text-white mb-3">Reserve Your Date</h1>
        <p className="text-hampton-blue/80 text-base max-w-md mx-auto">
          Pay the $250 deposit to lock in your date. All party details can be changed up to 1 week before.
        </p>
      </section>

      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
        {cancelled && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3 mb-6 text-sm text-red-700">
            Payment was cancelled. You can try again below.
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-hampton-pink/20 shadow-sm p-8 space-y-6">
          {/* Package display */}
          {packageName && (
            <div className="bg-hampton-pink/20 rounded-xl px-5 py-3 text-center">
              <p className="text-hampton-navy text-sm font-semibold">
                Selected Package: <span className="text-hampton-mauve">{packageName}</span>
              </p>
            </div>
          )}

          {/* Event Type */}
          <div>
            <label className="form-label flex items-center gap-2">
              <Sparkles size={14} className="text-hampton-mauve" /> Event Type
            </label>
            <select value={form.eventType} onChange={e => update('eventType', e.target.value)} className="form-input">
              {eventTypes.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Date & Time */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label flex items-center gap-2">
                <Calendar size={14} className="text-hampton-mauve" /> Party Date *
              </label>
              <input type="date" required min={minDate} value={form.partyDate}
                     onChange={e => update('partyDate', e.target.value)} className="form-input" />
              {form.partyDate && blockedDates.has(form.partyDate) && (
                <p className="text-amber-600 text-xs mt-1">This date may already be booked. We&apos;ll confirm availability after your deposit.</p>
              )}
            </div>
            <div>
              <label className="form-label flex items-center gap-2">
                <Calendar size={14} className="text-hampton-mauve" /> Party Time *
              </label>
              <select value={form.partyTime} onChange={e => update('partyTime', e.target.value)} className="form-input">
                {timeSlots.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Contact Info */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label flex items-center gap-2">
                <User size={14} className="text-hampton-mauve" /> Your Name *
              </label>
              <input type="text" required placeholder="Jane Smith" value={form.contactName}
                     onChange={e => update('contactName', e.target.value)} className="form-input" />
            </div>
            <div>
              <label className="form-label flex items-center gap-2">
                <Mail size={14} className="text-hampton-mauve" /> Email *
              </label>
              <input type="email" required placeholder="jane@email.com" value={form.contactEmail}
                     onChange={e => update('contactEmail', e.target.value)} className="form-input" />
            </div>
          </div>

          <div>
            <label className="form-label flex items-center gap-2">
              <Phone size={14} className="text-hampton-mauve" /> Phone
            </label>
            <input type="tel" placeholder="(631) 555-1234" value={form.contactPhone}
                   onChange={e => update('contactPhone', e.target.value)} className="form-input" />
          </div>

          {/* Child & Guest Info (show for kid parties) */}
          {(form.eventType === 'kid-party' || form.eventType === 'communion') && (
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <label className="form-label flex items-center gap-2">
                  <Baby size={14} className="text-hampton-mauve" /> Child&apos;s Name
                </label>
                <input type="text" placeholder="Emma" value={form.childName}
                       onChange={e => update('childName', e.target.value)} className="form-input" />
              </div>
              <div>
                <label className="form-label flex items-center gap-2">
                  <Baby size={14} className="text-hampton-mauve" /> Child&apos;s Age
                </label>
                <input type="number" min="1" max="18" placeholder="7" value={form.childAge}
                       onChange={e => update('childAge', e.target.value)} className="form-input" />
              </div>
              <div>
                <label className="form-label flex items-center gap-2">
                  <Users size={14} className="text-hampton-mauve" /> Guest Count
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

          {/* Submit */}
          <button type="submit" disabled={loading}
                  className="w-full bg-hampton-navy text-hampton-ivory font-semibold py-4 px-8 rounded-full hover:bg-opacity-90 transition-all disabled:opacity-60 flex items-center justify-center gap-2">
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Redirecting to Stripe...
              </>
            ) : (
              <>
                <Lock size={16} />
                Pay $250 Deposit — Lock My Date
              </>
            )}
          </button>

          <p className="text-center text-hampton-mauve text-xs">
            Secure payment via Stripe. Your $250 deposit is applied toward your total balance.
            <br />You can change all party details up to 1 week before your event.
          </p>
        </form>
      </section>
    </div>
  )
}

export default function BookPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-hampton-ivory flex items-center justify-center"><p className="text-hampton-mauve">Loading...</p></div>}>
      <BookingForm />
    </Suspense>
  )
}
