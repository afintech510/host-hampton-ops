'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function LoginContent() {
  const params = useSearchParams()
  const errorType = params.get('error')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  const errorMessages: Record<string, string> = {
    invalid: 'Invalid link. Please request a new one below.',
    not_found: 'Booking not found. Please check your email address.',
    expired: 'Your link has expired. Request a new one below.',
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await fetch('/api/portal/resend-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
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
          Enter your email to receive a secure link to your booking portal.
        </p>

        {errorType && errorMessages[errorType] && (
          <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 mb-4">
            {errorMessages[errorType]}
          </div>
        )}

        {sent ? (
          <div className="text-center">
            <div className="text-4xl mb-4">📧</div>
            <p className="text-[#1a2744] font-medium mb-2">Check your email!</p>
            <p className="text-gray-500 text-sm">
              If we have a booking on file for <strong>{email}</strong>, you&apos;ll receive a secure link shortly.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
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
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#1a2744] text-white py-2.5 rounded-lg font-medium hover:bg-[#2a3754] transition-colors disabled:opacity-50"
            >
              {loading ? 'Sending...' : 'Send Access Link'}
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
