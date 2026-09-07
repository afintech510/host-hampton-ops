'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function LoginContent() {
  const params = useSearchParams()
  const errorType = params.get('error')
  const [mode, setMode] = useState<'email' | 'phone'>('email')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  const errorMessages: Record<string, string> = {
    invalid: "That link didn't work. Get a fresh one below — it takes a second.",
    not_found: "We couldn't match that link to a booking. Get a fresh one below.",
    expired: 'Your link has expired. Get a fresh one below.',
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await fetch('/api/portal/resend-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mode === 'phone' ? { phone } : { email }),
    })
    setSent(true)
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#F6F1EB] flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-8 md:p-10">
        <h1 className="font-display text-2xl text-[#1a2744] text-center mb-2">
          My Booking
        </h1>
        <p className="text-gray-500 text-sm text-center mb-6">
          Get a link to your party planner by email or text. If you have a saved quote, you&apos;ll pick up right where you left off.
        </p>

        {errorType && errorMessages[errorType] && (
          <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 mb-4">
            {errorMessages[errorType]}
          </div>
        )}

        {sent ? (
          <div className="text-center">
            <div className="text-4xl mb-4">📧</div>
            <p className="text-[#1a2744] font-medium mb-2">
              {mode === 'phone' ? 'Check your texts!' : 'Check your email!'}
            </p>
            <p className="text-gray-500 text-sm">
              If we have a booking on file for <strong>{mode === 'phone' ? phone : email}</strong>, you&apos;ll receive a secure link shortly.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-2 bg-gray-100 rounded-lg p-1">
              {(['email', 'phone'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`py-2 rounded-md text-sm font-medium transition-colors ${
                    mode === m ? 'bg-white text-[#1a2744] shadow-sm' : 'text-gray-500 hover:text-[#1a2744]'
                  }`}
                >
                  {m === 'email' ? 'Email it' : 'Text it'}
                </button>
              ))}
            </div>

            {mode === 'email' ? (
              <div>
                <label className="block text-sm text-gray-600 mb-1">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="your@email.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#A1B5C8] focus:border-transparent outline-none"
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm text-gray-600 mb-1">Mobile Number</label>
                <input
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  required
                  placeholder="(631) 555-1234"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-[#A1B5C8] focus:border-transparent outline-none"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Use the number on your booking. Msg &amp; data rates may apply.
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#1a2744] text-white py-2.5 rounded-lg font-medium hover:bg-[#2a3754] transition-colors disabled:opacity-50"
            >
              {loading ? 'Sending...' : mode === 'phone' ? 'Text Me A Link' : 'Email Me A Link'}
            </button>
          </form>
        )}

        <p className="text-center text-gray-400 text-xs mt-6">
          Questions? Call{' '}
          <a href="tel:6319989325" className="text-[#1a2744] hover:underline">(631) 998-9325</a>
        </p>
      </div>
    </div>
  )
}

export default function PortalLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F6F1EB]" />}>
      <LoginContent />
    </Suspense>
  )
}
