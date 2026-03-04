'use client'

import { useState } from 'react'
import { trackContact } from '@/lib/gtag'

const c = {
  oat:      '#F5F0EB',
  cream:    '#FDFBF9',
  espresso: '#3C2A21',
  rose:     '#C9A5A5',
  roseLight:'#E8D5D5',
  warmGray: '#8C7B72',
}

const eventTypes = [
  'Brand Activation',
  'Corporate Event',
  'Product Launch',
  'Holiday Party',
  'Trade Show',
  'Private Event',
  'Other',
]

export default function InquiryForm() {
  const [submitted, setSubmitted] = useState(false)

  if (submitted) {
    return (
      <div
        className="rounded-3xl p-12 text-center"
        style={{ background: c.cream, border: `1px solid ${c.roseLight}` }}
      >
        <p
          className="text-3xl mb-4"
          style={{ fontFamily: 'var(--font-cormorant), serif', fontWeight: 500, color: c.espresso }}
        >
          Thank You
        </p>
        <p className="text-base" style={{ color: c.warmGray, fontWeight: 300 }}>
          We&apos;ve received your inquiry. Our team will be in touch within 24 hours to discuss your vision.
        </p>
      </div>
    )
  }

  return (
    <form
      className="rounded-3xl p-8 md:p-10 space-y-6"
      style={{ background: c.cream, border: `1px solid ${c.roseLight}` }}
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.currentTarget
        const data = new FormData(form)
        const subject = `Atelier Brim Inquiry — ${data.get('company') || 'New Lead'}`
        const body = [
          `Name: ${data.get('name')}`,
          `Email: ${data.get('email')}`,
          `Company: ${data.get('company')}`,
          `Event Type: ${data.get('eventType')}`,
          `Estimated Date: ${data.get('date')}`,
          `Guest Count: ${data.get('guests')}`,
          ``,
          `The Vision:`,
          `${data.get('vision')}`,
        ].join('\n')
        window.location.href = `mailto:hosthampton295@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
        setSubmitted(true)
        trackContact('inquiry_form')
      }}
    >
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="block text-xs tracking-[0.15em] uppercase mb-2" style={{ color: c.warmGray, fontWeight: 500 }}>
            Your Name *
          </label>
          <input
            name="name"
            type="text"
            required
            placeholder="Jane Smith"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
            style={{ border: `1px solid ${c.roseLight}`, background: c.oat, color: c.espresso }}
          />
        </div>
        <div>
          <label className="block text-xs tracking-[0.15em] uppercase mb-2" style={{ color: c.warmGray, fontWeight: 500 }}>
            Email *
          </label>
          <input
            name="email"
            type="email"
            required
            placeholder="jane@agency.com"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
            style={{ border: `1px solid ${c.roseLight}`, background: c.oat, color: c.espresso }}
          />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="block text-xs tracking-[0.15em] uppercase mb-2" style={{ color: c.warmGray, fontWeight: 500 }}>
            Company / Brand
          </label>
          <input
            name="company"
            type="text"
            placeholder="Agency or brand name"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
            style={{ border: `1px solid ${c.roseLight}`, background: c.oat, color: c.espresso }}
          />
        </div>
        <div>
          <label className="block text-xs tracking-[0.15em] uppercase mb-2" style={{ color: c.warmGray, fontWeight: 500 }}>
            Event Type
          </label>
          <select
            name="eventType"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all appearance-none"
            style={{ border: `1px solid ${c.roseLight}`, background: c.oat, color: c.espresso }}
          >
            <option value="">Select...</option>
            {eventTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="block text-xs tracking-[0.15em] uppercase mb-2" style={{ color: c.warmGray, fontWeight: 500 }}>
            Estimated Date
          </label>
          <input
            name="date"
            type="text"
            placeholder="e.g. March 2026 or TBD"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
            style={{ border: `1px solid ${c.roseLight}`, background: c.oat, color: c.espresso }}
          />
        </div>
        <div>
          <label className="block text-xs tracking-[0.15em] uppercase mb-2" style={{ color: c.warmGray, fontWeight: 500 }}>
            Expected Guests
          </label>
          <input
            name="guests"
            type="text"
            placeholder="e.g. 50-100"
            className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all"
            style={{ border: `1px solid ${c.roseLight}`, background: c.oat, color: c.espresso }}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs tracking-[0.15em] uppercase mb-2" style={{ color: c.warmGray, fontWeight: 500 }}>
          The Vision
        </label>
        <textarea
          name="vision"
          rows={4}
          placeholder="Tell us about the mood, the aesthetic, and the experience you're envisioning. Think moodboard energy — we'll take it from there."
          className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all resize-none"
          style={{ border: `1px solid ${c.roseLight}`, background: c.oat, color: c.espresso }}
        />
      </div>

      <button
        type="submit"
        className="w-full py-4 rounded-full text-sm tracking-[0.15em] uppercase transition-all hover:opacity-90"
        style={{ background: c.espresso, color: c.cream, fontWeight: 600 }}
      >
        Send Inquiry
      </button>

      <p className="text-center text-xs" style={{ color: `${c.warmGray}99` }}>
        We respond within 24 hours. No commitment required.
      </p>
    </form>
  )
}
