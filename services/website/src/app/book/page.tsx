'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Suspense, useState, useCallback, useEffect } from 'react'
import {
  Calendar, User, Mail, Phone, Baby, Users, Loader2, Bookmark, PartyPopper, Clock, Lock,
  X, Check, Palette, Sparkles, UtensilsCrossed, Cake, Wine, Paintbrush, Music, Gift, DollarSign, ArrowRight,
} from 'lucide-react'
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

interface ThemeItem {
  id: string
  name: string
  description: string | null
  price_cents: number
  price_label: string | null
  is_popular: boolean
}

/* ── helpers ── */

function fmt(cents: number): string {
  const d = cents / 100
  return d % 1 === 0 ? `$${d.toLocaleString()}` : `$${d.toFixed(2)}`
}

const SUMMARY_ICONS: Record<string, typeof Palette> = {
  'Theme': Palette,
  'Guests': Users,
  'Activities': Sparkles,
  'Food': UtensilsCrossed,
  'Additional Food': UtensilsCrossed,
  'Cupcakes': Cake,
  'Desserts': Cake,
  'Beverages': Wine,
  'Decor': Paintbrush,
  'Entertainment': Music,
  'Extras': Gift,
  'Party': PartyPopper,
}

function parseSummaryLines(summary: string): { label: string; value: string; isTotal: boolean }[] {
  return summary.split('\n').filter(l => l.trim()).map(line => {
    const isTotal = line.startsWith('Estimated Total')
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) return { label: '', value: line.trim(), isTotal }
    return {
      label: line.slice(0, colonIdx).trim(),
      value: line.slice(colonIdx + 1).trim(),
      isTotal,
    }
  })
}

/* ── Quote Summary Display ── */

function QuoteSummaryDisplay({ quoteData, encodedQuote, onClear }: {
  quoteData: StoredQuote
  encodedQuote: string
  onClear: () => void
}) {
  const lines = parseSummaryLines(quoteData.summary || '')
  const editLink = encodedQuote
    ? `/kids-party-menu?q=${encodedQuote}`
    : '/kids-party-menu'

  return (
    <div className="bg-white rounded-2xl border border-hampton-pink/20 shadow-sm p-6 mb-6 relative">
      <button
        type="button"
        onClick={onClear}
        className="absolute top-3 right-3 w-7 h-7 rounded-full bg-hampton-navy/5 hover:bg-hampton-navy/10 flex items-center justify-center text-hampton-navy/50 hover:text-hampton-navy transition-colors"
        title="Clear quote"
      >
        <X size={14} />
      </button>

      <p className="text-xs font-bold text-hampton-navy/40 uppercase tracking-widest mb-4">Your Party Selections</p>

      <div className="space-y-2">
        {lines.map((line, i) => {
          if (line.isTotal) {
            return (
              <div key={i} className="border-t border-hampton-pink/20 pt-3 mt-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DollarSign size={16} className="text-hampton-navy" />
                  <span className="font-bold text-hampton-navy text-sm">Estimated Total</span>
                </div>
                <span className="font-bold text-hampton-navy text-lg">{line.value}</span>
              </div>
            )
          }
          const Icon = SUMMARY_ICONS[line.label] || Gift
          return (
            <div key={i} className="flex items-start gap-2.5">
              <Icon size={15} className="text-hampton-pink mt-0.5 shrink-0" />
              <p className="text-sm text-hampton-navy">
                {line.label && <span className="font-semibold">{line.label}:</span>}{' '}
                <span className="text-hampton-navy/60">{line.value}</span>
              </p>
            </div>
          )
        })}
      </div>

      <div className="mt-4 pt-3 border-t border-hampton-pink/10">
        <Link href={editLink} className="text-xs font-semibold text-hampton-pink hover:text-hampton-navy transition-colors flex items-center gap-1">
          Edit Your Quote <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  )
}

/* ── Theme Selector ── */

function ThemeSelector({ themes, selected, onSelect }: {
  themes: ThemeItem[]
  selected: string | null
  onSelect: (id: string, name: string) => void
}) {
  if (themes.length === 0) return null
  return (
    <div className="bg-white rounded-2xl border border-hampton-pink/20 shadow-sm p-6 mb-6">
      <p className="text-xs font-bold text-hampton-navy/40 uppercase tracking-widest mb-4">Select Your Theme</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {themes.map(t => {
          const isSelected = selected === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id, t.name)}
              className={`relative text-left p-4 rounded-xl border-2 transition-all ${
                isSelected
                  ? 'border-hampton-navy bg-hampton-navy/5 shadow-sm'
                  : 'border-hampton-mauve/20 bg-white hover:border-hampton-blue'
              }`}
            >
              {isSelected && (
                <span className="absolute top-3 right-3 w-5 h-5 bg-hampton-navy rounded-full flex items-center justify-center">
                  <Check size={12} className="text-white" />
                </span>
              )}
              {t.is_popular && (
                <span className="absolute -top-2 right-3 bg-hampton-pink text-white text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Popular
                </span>
              )}
              <p className="font-serif font-bold text-hampton-navy text-sm pr-6">{t.name}</p>
              {t.description && <p className="text-hampton-navy/50 text-xs mt-1 line-clamp-2">{t.description}</p>}
              <p className="font-bold text-hampton-navy mt-2 text-sm">{t.price_label || fmt(t.price_cents)}</p>
            </button>
          )
        })}
      </div>
      <div className="mt-4 pt-3 border-t border-hampton-pink/10">
        <Link href="/kids-party-menu" className="text-xs font-semibold text-hampton-pink hover:text-hampton-navy transition-colors flex items-center gap-1">
          Build a Full Quote <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  )
}

/* ── Main Booking Form ── */

function BookingForm() {
  const params = useSearchParams()
  const packageName = params.get('package') ?? ''
  const cancelled = params.get('cancelled')
  const defaultType = params.get('type') || ''
  const defaultDate = params.get('date') || undefined
  const defaultTime = params.get('time') || undefined
  const fromQuote = params.get('from') === 'quote'
  const encodedQuote = params.get('q') || ''

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState<CalendarSelection | null>(null)
  const [quoteData, setQuoteData] = useState<StoredQuote | null>(null)
  const [themes, setThemes] = useState<ThemeItem[]>([])
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null)
  const [form, setForm] = useState({
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    childName: '',
    childAge: '',
    guestCount: '',
    packageName,
    notes: '',
    eventType: '',
    rentalDuration: '3',
  })

  // Read quote data from URL param (email links) or localStorage (in-app navigation)
  useEffect(() => {
    if (!fromQuote) return
    try {
      let data: StoredQuote | null = null
      if (encodedQuote) {
        const b64 = encodedQuote.replace(/-/g, '+').replace(/_/g, '/')
        const json = decodeURIComponent(escape(atob(b64)))
        data = JSON.parse(json)
      }
      if (!data) {
        const raw = localStorage.getItem(LS_KEY)
        if (raw) data = JSON.parse(raw)
      }
      if (!data) return
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
  }, [fromQuote, encodedQuote])

  // Fetch themes when kids-party is selected and no quote loaded
  const isKidsParty = selection?.bookingType?.tags?.some(t => ['kids-party', 'childrens'].includes(t))
    ?? (defaultType === 'kids-party')
  useEffect(() => {
    if (!isKidsParty || quoteData) return
    fetch('/api/pricing?category=party-theme&event_type=kids-party')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setThemes(data) })
      .catch(() => {})
  }, [isKidsParty, quoteData])

  function update(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleCalendarSelect = useCallback((sel: CalendarSelection) => {
    setSelection(sel)
  }, [])

  function handleThemeSelect(id: string, name: string) {
    setSelectedThemeId(prev => prev === id ? null : id)
    setForm(prev => ({ ...prev, packageName: prev.packageName === name ? '' : name }))
  }

  function handleClearQuote() {
    setQuoteData(null)
    localStorage.removeItem(LS_KEY)
    setForm(prev => ({ ...prev, notes: '', packageName: '' }))
  }

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
            ...(isRoomRental ? {
              eventType: form.eventType,
              rentalDuration: form.rentalDuration,
            } : {}),
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
  const isRoomRental = bookingType?.slug === 'room-rental'

  return (
    <div className="min-h-screen">
      {/* ── Hero ── */}
      <section className="py-14 text-center px-4">
        <Calendar size={28} className="text-hampton-pink mx-auto mb-3" />
        <h1 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-3">Book Your Celebration</h1>
        <p className="text-hampton-navy/70 text-base max-w-md mx-auto">
          Pick your experience, choose a date, and we&apos;ll handle the rest.
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
            defaultDate={defaultDate}
            defaultTime={defaultTime}
            expandable={false}
            initialExpanded={true}
            showSummary={false}
            selectorVariant="tiles"
            timeSlotHeading="Select Party Start Time"
            showTimePlaceholder={true}
            onSelect={handleCalendarSelect}
          />
        </div>

        {/* Party Selections — shows for kids-party bookings */}
        {isKidsParty && (
          quoteData?.summary ? (
            <QuoteSummaryDisplay
              quoteData={quoteData}
              encodedQuote={encodedQuote}
              onClear={handleClearQuote}
            />
          ) : themes.length > 0 ? (
            <ThemeSelector
              themes={themes}
              selected={selectedThemeId}
              onSelect={handleThemeSelect}
            />
          ) : null
        )}

        {/* Selected package display (for non-kids-party with package param) */}
        {!isKidsParty && packageName && !quoteData && (
          <div className="bg-white rounded-2xl border border-hampton-pink/20 shadow-sm p-5 mb-6 text-center">
            <p className="text-hampton-navy text-sm font-semibold">
              Selected Package: <span className="text-hampton-navy">{packageName}</span>
            </p>
          </div>
        )}

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

            {/* Room Rental fields */}
            {isRoomRental && (
              <div className="space-y-4 border-t border-hampton-pink/15 pt-5">
                <p className="text-xs font-semibold text-hampton-navy/50 uppercase tracking-wider">Room Rental Details</p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="form-label flex items-center gap-2">
                      <PartyPopper size={14} className="text-hampton-navy" /> What type of event? *
                    </label>
                    <input type="text" required placeholder="Birthday, baby shower, corporate..."
                           value={form.eventType} onChange={e => update('eventType', e.target.value)}
                           className="form-input" />
                  </div>
                  <div>
                    <label className="form-label flex items-center gap-2">
                      <Users size={14} className="text-hampton-navy" /> Expected Guest Count *
                    </label>
                    <input type="number" required min="1" max="70" placeholder="e.g. 30"
                           value={form.guestCount} onChange={e => update('guestCount', e.target.value)}
                           className="form-input" />
                  </div>
                </div>
                <div>
                  <label className="form-label flex items-center gap-2">
                    <Clock size={14} className="text-hampton-navy" /> Rental Duration (hours) *
                  </label>
                  <select required value={form.rentalDuration}
                          onChange={e => update('rentalDuration', e.target.value)}
                          className="form-input">
                    <option value="3">3 hours</option>
                    <option value="4">4 hours</option>
                    <option value="5">5 hours</option>
                    <option value="6">6 hours</option>
                    <option value="7">7 hours</option>
                    <option value="8">8 hours</option>
                  </select>
                  <p className="text-xs text-hampton-navy/50 mt-1.5">
                    Include time for setup and cleanup in your rental duration.
                  </p>
                </div>
              </div>
            )}

            {/* Guest Count for non-room-rental, non-child bookings */}
            {!showChildFields && !isRoomRental && (
              <div>
                <label className="form-label flex items-center gap-2">
                  <Users size={14} className="text-hampton-navy" /> Guest Count
                </label>
                <input type="number" min="1" max="50" placeholder="10" value={form.guestCount}
                       onChange={e => update('guestCount', e.target.value)} className="form-input" />
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="form-label">Special Requests or Notes</label>
              <textarea rows={3} placeholder={isRoomRental
                ? "Vendors you're bringing, decor plans, AV needs, any special requirements..."
                : "Dietary needs, theme preferences, special requests..."}
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
            <div className="flex gap-3">
              {/* Save Quote */}
              <button
                type="button"
                disabled={saving || !form.contactEmail || !form.contactName}
                onClick={async () => {
                  if (!form.contactEmail || !form.contactName) return
                  setSaving(true)
                  setSaveSuccess(false)
                  try {
                    // Build summary from quote data or selection
                    const summary = quoteData?.summary || [
                      bookingType?.label || 'Booking',
                      selection?.date ? new Date(selection.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '',
                      form.guestCount ? `${form.guestCount} guests` : '',
                      form.notes ? `Notes: ${form.notes}` : '',
                    ].filter(Boolean).join(' \u2022 ')

                    await fetch('/api/quote/save', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        name: form.contactName,
                        email: form.contactEmail,
                        phone: form.contactPhone,
                        quoteData: quoteData || {
                          bookingType: bookingType?.slug || defaultType,
                          bookingLabel: bookingType?.label || '',
                          guestCount: form.guestCount ? Number(form.guestCount) : null,
                          eventType: form.eventType || null,
                          rentalDuration: form.rentalDuration || null,
                          notes: form.notes || null,
                          contactName: form.contactName,
                          contactEmail: form.contactEmail,
                          contactPhone: form.contactPhone,
                        },
                        summary,
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
                  <><Bookmark size={16} /> Save Quote</>
                )}
              </button>

              {/* Pay Deposit / Book */}
              <button type="submit" disabled={loading}
                      className="flex-1 bg-hampton-navy text-hampton-ivory font-semibold py-4 px-8 rounded-full hover:bg-opacity-90 transition-all disabled:opacity-60 flex items-center justify-center gap-2">
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
              <p className="text-center text-hampton-navy/60 text-xs">
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
