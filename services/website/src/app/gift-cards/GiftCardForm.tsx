'use client'

import { useState } from 'react'

const PRESET_AMOUNTS = [2500, 5000, 7500, 10000, 15000, 25000] // cents

export default function GiftCardForm() {
  const [amountCents, setAmountCents] = useState(5000)
  const [customAmount, setCustomAmount] = useState('')
  const [isCustom, setIsCustom] = useState(false)
  const [purchaserName, setPurchaserName] = useState('')
  const [purchaserEmail, setPurchaserEmail] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [personalMessage, setPersonalMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function selectPreset(cents: number) {
    setAmountCents(cents)
    setIsCustom(false)
    setCustomAmount('')
  }

  function handleCustom(val: string) {
    setCustomAmount(val)
    setIsCustom(true)
    const num = parseInt(val, 10)
    if (!isNaN(num) && num >= 25 && num <= 500) {
      setAmountCents(num * 100)
    }
  }

  const effectiveAmount = isCustom
    ? (parseInt(customAmount, 10) || 0) * 100
    : amountCents

  const isValid =
    effectiveAmount >= 2500 &&
    effectiveAmount <= 50000 &&
    purchaserName.trim() &&
    purchaserEmail.trim() &&
    recipientName.trim() &&
    recipientEmail.trim()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/gift-cards/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountCents: effectiveAmount,
          purchaserName: purchaserName.trim(),
          purchaserEmail: purchaserEmail.trim(),
          recipientName: recipientName.trim(),
          recipientEmail: recipientEmail.trim(),
          personalMessage: personalMessage.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Something went wrong')
      window.location.href = data.url
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-lg p-8 space-y-6">
      {/* Amount Selection */}
      <div>
        <label className="block text-xs uppercase tracking-wider text-hampton-navy/70 font-semibold mb-3">
          Select Amount
        </label>
        <div className="grid grid-cols-3 gap-3 mb-3">
          {PRESET_AMOUNTS.map((cents) => (
            <button
              key={cents}
              type="button"
              onClick={() => selectPreset(cents)}
              className={`py-3 rounded-xl text-sm font-bold transition-all ${
                !isCustom && amountCents === cents
                  ? 'bg-hampton-navy text-white shadow-md scale-[1.02]'
                  : 'bg-[#f0ece7] text-hampton-navy hover:bg-hampton-navy/10'
              }`}
            >
              ${cents / 100}
            </button>
          ))}
        </div>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-hampton-navy/50 font-bold">$</span>
          <input
            type="number"
            min={25}
            max={500}
            placeholder="Custom amount (25–500)"
            value={customAmount}
            onChange={(e) => handleCustom(e.target.value)}
            onFocus={() => setIsCustom(true)}
            className={`w-full pl-8 pr-4 py-3 rounded-xl border-2 transition-all text-sm ${
              isCustom
                ? 'border-hampton-navy bg-white'
                : 'border-transparent bg-[#f0ece7] hover:border-hampton-navy/20'
            } focus:outline-none focus:border-hampton-navy`}
          />
        </div>
      </div>

      {/* Your Info */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-hampton-navy uppercase tracking-wider">Your Info</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Your Name</label>
            <input
              type="text"
              required
              value={purchaserName}
              onChange={(e) => setPurchaserName(e.target.value)}
              className="form-input"
              placeholder="Jane Smith"
            />
          </div>
          <div>
            <label className="form-label">Your Email</label>
            <input
              type="email"
              required
              value={purchaserEmail}
              onChange={(e) => setPurchaserEmail(e.target.value)}
              className="form-input"
              placeholder="jane@example.com"
            />
          </div>
        </div>
      </div>

      {/* Recipient Info */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-hampton-navy uppercase tracking-wider">Recipient Info</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Recipient Name</label>
            <input
              type="text"
              required
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              className="form-input"
              placeholder="Sarah Johnson"
            />
          </div>
          <div>
            <label className="form-label">Recipient Email</label>
            <input
              type="email"
              required
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              className="form-input"
              placeholder="sarah@example.com"
            />
          </div>
        </div>
      </div>

      {/* Personal Message */}
      <div>
        <label className="form-label">Personal Message (optional)</label>
        <textarea
          value={personalMessage}
          onChange={(e) => setPersonalMessage(e.target.value)}
          maxLength={300}
          rows={3}
          className="form-input resize-none"
          placeholder="Happy Birthday! Can't wait to celebrate with you..."
        />
        <p className="text-xs text-hampton-navy/40 mt-1">{personalMessage.length}/300</p>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={!isValid || loading}
        className="w-full py-4 rounded-xl font-bold text-base transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-hampton-navy text-white hover:bg-hampton-navy/90 shadow-md"
      >
        {loading
          ? 'Redirecting to checkout...'
          : `Purchase $${(effectiveAmount / 100).toFixed(0)} Gift Card`}
      </button>

      <p className="text-xs text-center text-hampton-navy/40">
        The gift card will be emailed to the recipient immediately after purchase. A confirmation copy will be sent to you.
      </p>
    </form>
  )
}
