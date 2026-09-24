'use client'

/**
 * The booking form for one appointment event.
 *
 * A CLIENT CHILD of a server page, deliberately. It reads `?booked=` and
 * `?cancelled=` off the URL for the Stripe return trip, and a page that calls
 * `useSearchParams()` prerenders as its Suspense FALLBACK — so the search-param
 * read has to live down here, inside the client boundary, or the whole page
 * ships to Google as a spinner.
 *
 * ── EVERY NUMBER ON THIS PAGE COMES FROM THE REGISTRY ──
 *
 * The component this replaces carried its own copy of the service list WITH
 * PRICES, its own copy of `calcSlotsNeeded`, its own `* 20`, and a hand-written
 * price grid in the header — a fourth copy of a table that also existed in the
 * route, the admin tab and the admin price map. Nothing here writes a price, a
 * duration or a slot time; they arrive as `cfg`.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { Calendar, Clock, ChevronDown, ChevronUp, Check, Loader2 } from 'lucide-react'
import {
  type AppointmentEventConfig,
  calcSlotsNeeded,
  estimateCents,
  durationLabel,
  formatAppointmentMoney,
  priceSummaryRows,
  slotTimes,
  closingLabel,
  paymentNote,
} from '@/lib/appointmentEvents'

interface SlotInfo { time: string; index: number; available: boolean }

export default function AppointmentForm({ cfg, closed }: { cfg: AppointmentEventConfig; closed: boolean }) {
  const searchParams = useSearchParams()
  const returnedPaid = !!searchParams.get('booked')
  const returnedCancelled = !!searchParams.get('cancelled')

  const [open, setOpen] = useState(false)
  const [slots, setSlots] = useState<SlotInfo[]>([])
  const [slotsNeeded, setSlotsNeeded] = useState(1)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [partySize, setPartySize] = useState(1)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(returnedPaid)
  const [successDuration, setSuccessDuration] = useState('')
  const [error, setError] = useState(returnedCancelled ? 'Your payment was cancelled, so nothing was booked. Pick a time to try again.' : '')
  const formRef = useRef<HTMLDivElement>(null)
  const initialLoadDone = useRef(false)

  const loadSlots = useCallback(async (svcs: string[], size: number) => {
    setSlotsLoading(true)
    try {
      const params = new URLSearchParams()
      svcs.forEach(s => params.append('service', s))
      params.set('partySize', String(size))
      const res = await fetch(`/api/appointments/${cfg.slug}/book?${params}`)
      const data = await res.json()
      setSlots(data.slots || [])
      setSlotsNeeded(data.slotsNeeded || 1)
    } catch {
      setSlots([])
    } finally {
      setSlotsLoading(false)
    }
  }, [cfg.slug])

  useEffect(() => {
    if (open && !initialLoadDone.current) {
      initialLoadDone.current = true
      loadSlots(selectedServices, partySize)
    }
    if (open) {
      setTimeout(() => {
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 350)
    }
  }, [open, loadSlots, selectedServices, partySize])

  useEffect(() => {
    if (!initialLoadDone.current) return
    setSelectedIndex(null)
    loadSlots(selectedServices, partySize)
  }, [selectedServices, partySize, loadSlots])

  /**
   * Radio behaviour inside a `variantGroup`, checkbox behaviour outside it.
   *
   * Hair Wraps and Hair Wraps + Charms are the same appointment at two prices,
   * so picking one must clear the other. The old component hard-coded both ids;
   * this reads the group off the config, so a new event's variants work without
   * touching this file.
   */
  const toggleService = (id: string) => {
    const group = cfg.services.find(s => s.id === id)?.variantGroup
    setSelectedServices(prev => {
      if (group) {
        const siblings = cfg.services.filter(s => s.variantGroup === group).map(s => s.id)
        const next = prev.filter(s => !siblings.includes(s))
        if (!prev.includes(id)) next.push(id)
        return next
      }
      return prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    })
  }

  const estimatedCents = estimateCents(cfg, selectedServices, partySize)
  const localSlots = calcSlotsNeeded(cfg, selectedServices, partySize)
  const durLabel = durationLabel(cfg, selectedServices.length > 0 ? localSlots : slotsNeeded)
  const times = slotTimes(cfg)
  const payNote = paymentNote(cfg)

  const canSubmit = selectedIndex !== null && selectedServices.length > 0 && name && email && phone

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError('')

    try {
      const res = await fetch(`/api/appointments/${cfg.slug}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email, phone,
          slotIndex: selectedIndex,
          services: selectedServices,
          partySize,
          notes: notes || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        // A 409 means somebody took the slot between the page loading and this
        // press. Refresh the grid so they are not choosing from a stale picture.
        if (res.status === 409) loadSlots(selectedServices, partySize)
        return
      }

      // A paid event hands back a Stripe URL instead of a confirmation.
      if (data.url) {
        window.location.href = data.url
        return
      }

      setSuccessDuration(data.duration || (selectedIndex !== null ? times[selectedIndex] : ''))
      setSuccess(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-2">
      <div className="relative overflow-hidden rounded-2xl border-2 border-[#1e3a5f]/20 bg-white shadow-md">
        <div className="h-1.5" style={{ backgroundColor: cfg.accentHex }} />

        <div className="flex flex-col md:flex-row">
          {cfg.flyerSrc && (
            <div className="relative w-full md:w-[340px] shrink-0">
              <Image
                src={cfg.flyerSrc}
                alt={`${cfg.name} — ${cfg.dateLabel} at Host Hampton`}
                width={340}
                height={440}
                className="w-full h-full object-cover"
                priority
              />
            </div>
          )}

          <div className="flex-1 p-6 sm:p-8 flex flex-col justify-center">
            <span
              className="text-xs font-semibold uppercase tracking-widest mb-2"
              style={{ color: cfg.accentHex }}
            >
              By appointment
            </span>

            <h1 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-3 tracking-tight">
              {cfg.name}
            </h1>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-hampton-navy/80 mb-5">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4" />
                {cfg.dateLabel}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                {times[0]} – {closingLabel(cfg)}
              </span>
            </div>

            {/* Derived from the registry — never a second hand-written table. */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 mb-6">
              {priceSummaryRows(cfg).map((row) => (
                <div key={row.label} className="flex items-baseline justify-between border-b border-hampton-mauve/15 pb-1.5">
                  <span className="text-sm font-medium text-hampton-navy">{row.label}</span>
                  <div className="text-right">
                    <span className="text-sm font-semibold" style={{ color: cfg.accentHex }}>
                      {formatAppointmentMoney(row.priceCents)}
                    </span>
                    {row.note && (
                      <span className="block text-[10px] text-hampton-mauve">{row.note}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-xs text-hampton-mauve mb-5 italic">
              {payNote} — by appointment only
            </p>
            <p className="text-xs text-hampton-mauve mb-5">{cfg.locationLine}</p>

            {closed ? (
              <div className="rounded-xl border-2 border-hampton-mauve/20 bg-hampton-ivory/60 p-4">
                <p className="text-sm font-semibold text-hampton-navy">Booking for this day has closed.</p>
                <p className="text-xs text-hampton-mauve mt-1">
                  Call or text the studio at (631) 998-9325 and we will see what we can do.
                </p>
              </div>
            ) : (
              <button
                onClick={() => setOpen(!open)}
                className="btn-primary inline-flex items-center justify-center gap-2 w-fit px-8 py-3.5"
              >
                {success ? 'Booked!' : 'Book Your Appointment'}
                {!success && (open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />)}
              </button>
            )}
          </div>
        </div>

        {/* Slide-down booking form */}
        {!closed && (
          <div
            className="overflow-hidden transition-all duration-500 ease-in-out"
            style={{ maxHeight: open ? '3000px' : '0px' }}
          >
            <div ref={formRef} className="border-t-2 border-[#1e3a5f]/10 bg-hampton-ivory/50 p-5 sm:p-8">
              {success ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Check className="w-8 h-8 text-green-600" />
                  </div>
                  <h2 className="font-serif text-2xl text-hampton-navy mb-2">You&apos;re Booked!</h2>
                  <p className="text-hampton-navy/70 text-sm max-w-md mx-auto">
                    {email ? <>We sent a confirmation to <strong>{email}</strong>. </> : null}
                    See you on {cfg.dateLabel}{successDuration ? `, ${successDuration}` : ''}!
                  </p>
                  <p className="text-hampton-mauve text-xs mt-3">{payNote}.</p>
                </div>
              ) : (
                <div className="max-w-2xl mx-auto space-y-6">
                  {/* Step 1: Services */}
                  <div>
                    <label className="form-label mb-3 block">1. What Would You Like?</label>
                    <div className="space-y-2">
                      {cfg.services.map((svc) => (
                        <label
                          key={svc.id}
                          className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all duration-200
                            ${svc.indent ? 'ml-6' : ''}
                            ${selectedServices.includes(svc.id)
                              ? 'border-hampton-navy bg-hampton-navy/5'
                              : 'border-hampton-mauve/20 bg-white hover:border-hampton-mauve/40'
                            }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedServices.includes(svc.id)}
                            onChange={() => toggleService(svc.id)}
                            className="sr-only"
                          />
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors
                            ${selectedServices.includes(svc.id)
                              ? 'bg-hampton-navy border-hampton-navy'
                              : 'border-hampton-mauve/40 bg-white'
                            }`}
                          >
                            {selectedServices.includes(svc.id) && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <span className="text-sm font-medium text-hampton-navy flex-1">{svc.label}</span>
                          <span className="text-sm font-semibold" style={{ color: cfg.accentHex }}>
                            {formatAppointmentMoney(svc.priceCents)}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Step 2: Party Size */}
                  <div>
                    <label className="form-label mb-2 block">2. How Many People?</label>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setPartySize(Math.max(1, partySize - 1))}
                        className="w-10 h-10 rounded-lg border-2 border-hampton-mauve/25 bg-white text-hampton-navy font-bold hover:border-hampton-navy/50 transition-colors"
                      >
                        −
                      </button>
                      <span className="text-lg font-semibold text-hampton-navy w-8 text-center">{partySize}</span>
                      <button
                        onClick={() => setPartySize(Math.min(cfg.maxPartySize, partySize + 1))}
                        className="w-10 h-10 rounded-lg border-2 border-hampton-mauve/25 bg-white text-hampton-navy font-bold hover:border-hampton-navy/50 transition-colors"
                      >
                        +
                      </button>
                      {selectedServices.length > 0 && (
                        <span className="text-xs text-hampton-mauve ml-2">≈ {durLabel}</span>
                      )}
                    </div>
                  </div>

                  {/* Step 3: Time Slots */}
                  <div>
                    <label className="form-label mb-3 block">
                      3. Pick Your Start Time
                      {selectedServices.length > 0 && slotsNeeded > 1 && (
                        <span className="font-normal text-hampton-mauve ml-1">
                          ({slotsNeeded} consecutive slots needed)
                        </span>
                      )}
                    </label>
                    {slotsLoading ? (
                      <div className="flex items-center gap-2 text-sm text-hampton-mauve py-4">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading available times…
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                        {slots.map((slot) => (
                          <button
                            key={slot.index}
                            disabled={!slot.available}
                            onClick={() => setSelectedIndex(slot.index)}
                            className={`text-xs py-2.5 px-2 rounded-lg border-2 font-medium transition-all duration-200
                              ${!slot.available
                                ? 'border-hampton-mauve/15 bg-gray-50 text-hampton-mauve/40 cursor-not-allowed line-through'
                                : selectedIndex === slot.index
                                  ? 'border-hampton-navy bg-hampton-navy text-white shadow-sm'
                                  : 'border-hampton-mauve/25 bg-white text-hampton-navy hover:border-hampton-navy/50'
                              }`}
                          >
                            {slot.time}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Contact Info */}
                  <div>
                    <label className="form-label mb-3 block">4. Your Info</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="form-label">Name</label>
                        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" className="form-input" />
                      </div>
                      <div>
                        <label className="form-label">Email</label>
                        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" className="form-input" />
                      </div>
                      <div>
                        <label className="form-label">Phone</label>
                        <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 123-4567" className="form-input" />
                      </div>
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="form-label">Notes <span className="font-normal text-hampton-mauve">(optional)</span></label>
                    <input
                      type="text"
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      placeholder="Anything we should know?"
                      className="form-input"
                    />
                  </div>

                  {/* Estimated Total & Submit */}
                  {selectedServices.length > 0 && (
                    <div className="bg-white rounded-xl border-2 border-hampton-mauve/15 p-4 text-center">
                      <p className="text-xs text-hampton-mauve uppercase tracking-wider mb-1">Estimated Total</p>
                      <p className="text-2xl font-serif font-bold text-hampton-navy">
                        {formatAppointmentMoney(estimatedCents)}
                      </p>
                      <p className="text-[10px] text-hampton-mauve mt-1">{payNote} · {durLabel}</p>
                    </div>
                  )}

                  {error && (
                    <p className="text-red-600 text-sm text-center bg-red-50 rounded-lg p-3">{error}</p>
                  )}

                  <button
                    onClick={handleSubmit}
                    disabled={!canSubmit || submitting}
                    className={`btn-primary w-full py-4 flex items-center justify-center gap-2
                      ${(!canSubmit || submitting) ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Booking…
                      </>
                    ) : (
                      cfg.payment.mode === 'in_person' ? 'Confirm Booking' : 'Continue to Payment'
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
