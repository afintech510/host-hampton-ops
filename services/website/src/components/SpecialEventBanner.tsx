'use client'

import Image from 'next/image'
import { Calendar, Clock, Sparkles, ChevronDown, ChevronUp, Check, Loader2 } from 'lucide-react'
import { useState, useRef, useEffect, useCallback } from 'react'

const SERVICES = [
  { id: 'Hair Tinsel', label: 'Hair Tinsel', price: 15 },
  { id: 'Hair Wraps', label: 'Hair Wraps', price: 35 },
  { id: 'Hair Wraps + Charms', label: 'Hair Wraps + Charms', price: 38, indent: true },
  { id: 'Hair Glitter', label: 'Hair Glitter', price: 5 },
  { id: 'Glitter Freckles', label: 'Glitter Freckles', price: 10 },
]

const WRAP_SERVICES = ['Hair Wraps', 'Hair Wraps + Charms']
const QUICK_SERVICES = ['Hair Tinsel', 'Hair Glitter', 'Glitter Freckles']

function calcSlotsNeeded(services: string[], partySize: number): number {
  const hasWraps = services.some(s => WRAP_SERVICES.includes(s))
  const hasQuick = services.some(s => QUICK_SERVICES.includes(s))
  if (hasWraps) return partySize
  if (hasQuick) return Math.ceil(partySize / 4)
  return 1
}

interface SlotInfo { time: string; available: boolean }

const EXPIRY_DATE = new Date('2026-07-05T23:59:59-04:00')

export default function SpecialEventBanner() {
  const [expired, setExpired] = useState(false)
  const [open, setOpen] = useState(false)
  const [slots, setSlots] = useState<SlotInfo[]>([])
  const [slotsNeeded, setSlotsNeeded] = useState(1)
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState('')
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [partySize, setPartySize] = useState(1)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [successDuration, setSuccessDuration] = useState('')
  const [error, setError] = useState('')
  const formRef = useRef<HTMLDivElement>(null)
  const initialLoadDone = useRef(false)

  useEffect(() => {
    if (new Date() > EXPIRY_DATE) setExpired(true)
  }, [])

  const loadSlots = useCallback(async (svcs: string[], size: number) => {
    setSlotsLoading(true)
    try {
      const params = new URLSearchParams()
      svcs.forEach(s => params.append('service', s))
      params.set('partySize', String(size))
      const res = await fetch(`/api/summer-hair/book?${params}`)
      const data = await res.json()
      setSlots(data.slots || [])
      setSlotsNeeded(data.slotsNeeded || 1)
    } catch {
      setSlots([])
    } finally {
      setSlotsLoading(false)
    }
  }, [])

  // Initial load when form opens
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

  // Re-fetch when services or party size change (after initial load)
  useEffect(() => {
    if (!initialLoadDone.current) return
    setSelectedSlot('')
    loadSlots(selectedServices, partySize)
  }, [selectedServices, partySize, loadSlots])

  const toggleService = (id: string) => {
    setSelectedServices(prev => {
      if (id === 'Hair Wraps + Charms') {
        const next = prev.filter(s => s !== 'Hair Wraps' && s !== 'Hair Wraps + Charms')
        if (!prev.includes(id)) next.push(id)
        return next
      }
      if (id === 'Hair Wraps') {
        const next = prev.filter(s => s !== 'Hair Wraps' && s !== 'Hair Wraps + Charms')
        if (!prev.includes(id)) next.push(id)
        return next
      }
      return prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    })
  }

  const estimatedTotal = selectedServices.reduce((sum, id) => {
    const svc = SERVICES.find(s => s.id === id)
    return sum + (svc?.price || 0)
  }, 0) * partySize

  const durationMinutes = slotsNeeded * 20
  const durationLabel = slotsNeeded === 1 ? '20 min' : `${durationMinutes} min (${slotsNeeded} slots)`

  const canSubmit = selectedSlot && selectedServices.length > 0 && name && email && phone

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/summer-hair/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email, phone,
          timeSlot: selectedSlot,
          services: selectedServices,
          partySize,
          notes: notes || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        return
      }

      setSuccessDuration(data.duration || selectedSlot)
      setSuccess(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (expired) return null

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-2">
      <div className="relative overflow-hidden rounded-2xl border-2 border-[#1e3a5f]/20 bg-white shadow-md">
        <div className="h-1.5 bg-gradient-to-r from-[#B22234] via-white to-[#3C3B6E]" />

        <div className="flex flex-col md:flex-row">
          <div className="relative w-full md:w-[340px] shrink-0">
            <Image
              src="/images/summer-hair-flyer.png"
              alt="Summer Hair Event — July 3rd at Host Hampton"
              width={340}
              height={440}
              className="w-full h-full object-cover"
              priority
            />
          </div>

          <div className="flex-1 p-6 sm:p-8 flex flex-col justify-center">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-[#B22234]" />
              <span className="text-xs font-semibold uppercase tracking-widest text-[#B22234]">
                Special Event
              </span>
            </div>

            <h2 className="font-serif text-3xl md:text-4xl text-hampton-navy mb-3 tracking-tight">
              Summer Hair
            </h2>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-hampton-navy/80 mb-5">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4" />
                Friday, July 3
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                9:00 AM – 3:00 PM
              </span>
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-2 mb-6">
              {[
                { name: 'Hair Tinsel', price: '$15' },
                { name: 'Hair Wraps', price: '$35', note: 'add charms +$3' },
                { name: 'Hair Glitter', price: '$5' },
                { name: 'Glitter Freckles', price: '$10' },
              ].map((s) => (
                <div key={s.name} className="flex items-baseline justify-between border-b border-hampton-mauve/15 pb-1.5">
                  <span className="text-sm font-medium text-hampton-navy">{s.name}</span>
                  <div className="text-right">
                    <span className="text-sm font-semibold text-[#3C3B6E]">{s.price}</span>
                    {s.note && (
                      <span className="block text-[10px] text-hampton-mauve">{s.note}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-xs text-hampton-mauve mb-5 italic">
              All services paid in person — by appointment only
            </p>

            <button
              onClick={() => setOpen(!open)}
              className="btn-primary inline-flex items-center justify-center gap-2 w-fit px-8 py-3.5"
            >
              {success ? 'Booked!' : 'Book Your Appointment'}
              {!success && (open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />)}
            </button>
          </div>
        </div>

        {/* Slide-down booking form */}
        <div
          className="overflow-hidden transition-all duration-500 ease-in-out"
          style={{ maxHeight: open ? '1400px' : '0px' }}
        >
          <div ref={formRef} className="border-t-2 border-[#1e3a5f]/10 bg-hampton-ivory/50 p-5 sm:p-8">
            {success ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Check className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="font-serif text-2xl text-hampton-navy mb-2">You&apos;re Booked!</h3>
                <p className="text-hampton-navy/70 text-sm max-w-md mx-auto">
                  We sent a confirmation to <strong>{email}</strong>. See you on July 3rd, {successDuration}!
                </p>
                <p className="text-hampton-mauve text-xs mt-3">All services are paid in person.</p>
              </div>
            ) : (
              <div className="max-w-2xl mx-auto space-y-6">
                {/* Step 1: Services */}
                <div>
                  <label className="form-label mb-3 block">
                    1. What Would You Like?
                  </label>
                  <div className="space-y-2">
                    {SERVICES.map((svc) => (
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
                        <span className="text-sm font-semibold text-[#3C3B6E]">${svc.price}</span>
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
                      onClick={() => setPartySize(Math.min(10, partySize + 1))}
                      className="w-10 h-10 rounded-lg border-2 border-hampton-mauve/25 bg-white text-hampton-navy font-bold hover:border-hampton-navy/50 transition-colors"
                    >
                      +
                    </button>
                    {selectedServices.length > 0 && (
                      <span className="text-xs text-hampton-mauve ml-2">
                        ≈ {durationLabel}
                      </span>
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
                          key={slot.time}
                          disabled={!slot.available}
                          onClick={() => setSelectedSlot(slot.time)}
                          className={`text-xs py-2.5 px-2 rounded-lg border-2 font-medium transition-all duration-200
                            ${!slot.available
                              ? 'border-hampton-mauve/15 bg-gray-50 text-hampton-mauve/40 cursor-not-allowed line-through'
                              : selectedSlot === slot.time
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
                      <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Your name"
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label className="form-label">Email</label>
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="you@email.com"
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label className="form-label">Phone</label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={e => setPhone(e.target.value)}
                        placeholder="(555) 123-4567"
                        className="form-input"
                      />
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
                    <p className="text-2xl font-serif font-bold text-hampton-navy">${estimatedTotal}</p>
                    <p className="text-[10px] text-hampton-mauve mt-1">Payable in person · {durationLabel}</p>
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
                    'Confirm Booking'
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
