'use client'

import { useEffect, useState } from 'react'
import { Loader2, X, Mail, KeyRound, LogOut, Plus } from 'lucide-react'

interface MyBooking {
  id: string
  booking_ref: string
  bucket: 'past' | 'upcoming' | 'draft'
  status_raw: string
  party_date: string | null
  party_time: string | null
  package_type: string | null
  child_name: string | null
  catchy_party_name: string | null
  total_cents: number
  balance_due_cents: number
  paid_in_full_at: string | null
}

type Step = 'enter-email' | 'enter-code' | 'signed-in'

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US')}`
}

function fmtDate(s: string | null): string {
  if (!s) return 'Date TBD'
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

const BUCKET_LABELS: Record<MyBooking['bucket'], { label: string; color: string }> = {
  upcoming: { label: 'Upcoming', color: 'bg-green-100 text-green-800' },
  past: { label: 'Past', color: 'bg-gray-100 text-gray-700' },
  draft: { label: 'Draft', color: 'bg-amber-100 text-amber-800' },
}

export default function MyPartiesModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('enter-email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [bookings, setBookings] = useState<MyBooking[]>([])
  const [signedInEmail, setSignedInEmail] = useState('')
  const [info, setInfo] = useState('')

  // On open: if the email cookie is already set, jump straight to the list.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/portal/my-bookings')
      .then(async r => {
        if (cancelled) return
        if (r.ok) {
          const data = await r.json()
          setSignedInEmail(data.email || '')
          setBookings(data.bookings || [])
          setStep('signed-in')
        } else {
          setStep('enter-email')
        }
      })
      .catch(() => { if (!cancelled) setStep('enter-email') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  async function sendCode() {
    setError('')
    setInfo('')
    if (!email || !email.includes('@')) { setError('Enter a valid email'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/portal/email-auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Could not send code'); return }
      setStep('enter-code')
      setInfo(`We sent a 6-digit code to ${email}. It expires in 15 minutes.`)
    } finally {
      setLoading(false)
    }
  }

  async function verifyCode() {
    setError('')
    if (!/^\d{6}$/.test(code)) { setError('Enter the 6-digit code'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/portal/email-auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Could not verify code'); return }
      // Now load the list
      const listRes = await fetch('/api/portal/my-bookings')
      const listData = await listRes.json().catch(() => ({}))
      setSignedInEmail(listData.email || email)
      setBookings(listData.bookings || [])
      setStep('signed-in')
      setCode('')
      setInfo('')
    } finally {
      setLoading(false)
    }
  }

  async function pickBooking(ref: string) {
    setLoading(true)
    try {
      const res = await fetch('/api/portal/my-bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_ref: ref }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Could not load that party')
        return
      }
      // Reload the page so the planner picks up the new per-booking cookie
      window.location.reload()
    } finally {
      setLoading(false)
    }
  }

  async function startNew() {
    // The per-booking cookie is HttpOnly — clear it server-side, then reload
    // the planner so it boots fresh (email-session cookie stays intact so the
    // user can still pick another saved party).
    setLoading(true)
    try {
      await fetch('/api/portal/clear', { method: 'POST' })
    } finally {
      window.location.assign('/party-planner')
    }
  }

  async function signOut() {
    setLoading(true)
    try {
      await fetch('/api/portal/my-bookings', { method: 'DELETE' })
      setSignedInEmail('')
      setBookings([])
      setStep('enter-email')
      setEmail('')
    } finally {
      setLoading(false)
    }
  }

  const grouped = {
    upcoming: bookings.filter(b => b.bucket === 'upcoming'),
    draft: bookings.filter(b => b.bucket === 'draft'),
    past: bookings.filter(b => b.bucket === 'past'),
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/40 px-2 sm:px-4 py-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-hampton-mauve/15">
          <h3 className="font-serif text-lg font-bold text-hampton-navy">My Parties</h3>
          <button onClick={onClose} className="text-hampton-navy/40 hover:text-hampton-navy p-1" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {step === 'enter-email' && (
            <div className="space-y-4">
              <div className="text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-hampton-blue/15 flex items-center justify-center mb-3">
                  <Mail size={20} className="text-hampton-navy" />
                </div>
                <p className="font-serif text-base text-hampton-navy mb-1">Sign in to see your parties</p>
                <p className="text-xs text-hampton-navy/60">We&apos;ll email a 6-digit code — no password needed.</p>
              </div>

              <div>
                <label className="text-xs font-semibold text-hampton-navy/60 uppercase tracking-wider">Email</label>
                <input
                  type="email"
                  autoFocus
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') sendCode() }}
                  placeholder="you@email.com"
                  className="form-input mt-1"
                />
              </div>

              {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

              <button
                onClick={sendCode}
                disabled={loading || !email}
                className="w-full bg-hampton-navy text-white font-bold py-3 rounded-full text-sm hover:bg-opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : 'Send Sign-In Code'}
              </button>
            </div>
          )}

          {step === 'enter-code' && (
            <div className="space-y-4">
              <div className="text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-hampton-pink/15 flex items-center justify-center mb-3">
                  <KeyRound size={20} className="text-hampton-navy" />
                </div>
                <p className="font-serif text-base text-hampton-navy mb-1">Enter your code</p>
                {info && <p className="text-xs text-hampton-navy/60">{info}</p>}
              </div>

              <div>
                <label className="text-xs font-semibold text-hampton-navy/60 uppercase tracking-wider">6-digit code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoFocus
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={e => { if (e.key === 'Enter') verifyCode() }}
                  placeholder="123456"
                  className="form-input mt-1 text-center text-2xl tracking-[0.5em] font-mono"
                />
              </div>

              {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

              <button
                onClick={verifyCode}
                disabled={loading || code.length !== 6}
                className="w-full bg-hampton-navy text-white font-bold py-3 rounded-full text-sm hover:bg-opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : 'Verify & Sign In'}
              </button>

              <div className="flex items-center justify-between text-xs">
                <button onClick={() => { setStep('enter-email'); setCode(''); setError(''); setInfo('') }}
                  className="text-hampton-navy/50 hover:text-hampton-navy underline">
                  Use a different email
                </button>
                <button onClick={sendCode} disabled={loading}
                  className="text-hampton-navy/50 hover:text-hampton-navy underline">
                  Resend code
                </button>
              </div>
            </div>
          )}

          {step === 'signed-in' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-hampton-navy/60">
                <span>Signed in as <strong className="text-hampton-navy">{signedInEmail}</strong></span>
                <button onClick={signOut} className="flex items-center gap-1 hover:text-red-700">
                  <LogOut size={12} /> Sign out
                </button>
              </div>

              {loading && (
                <div className="text-center py-8"><Loader2 size={20} className="animate-spin mx-auto text-hampton-navy/40" /></div>
              )}

              {!loading && bookings.length === 0 && (
                <div className="text-center py-8 text-sm text-hampton-navy/60">
                  No parties found for this email yet.
                </div>
              )}

              {!loading && (['upcoming', 'draft', 'past'] as const).map(bucket => {
                const list = grouped[bucket]
                if (!list.length) return null
                return (
                  <div key={bucket}>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-hampton-navy/50 mb-2">{BUCKET_LABELS[bucket].label}</p>
                    <div className="space-y-2">
                      {list.map(b => (
                        <button
                          key={b.id}
                          onClick={() => pickBooking(b.booking_ref)}
                          className="w-full text-left p-3 rounded-xl border border-hampton-mauve/25 hover:border-hampton-navy bg-white transition-all"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-serif font-bold text-hampton-navy text-sm truncate">
                                {b.catchy_party_name || (b.child_name ? `${b.child_name}'s Party` : (b.package_type || 'Party Plan'))}
                              </p>
                              <p className="text-xs text-hampton-navy/60 mt-0.5">{fmtDate(b.party_date)}</p>
                              <p className="text-[11px] text-hampton-navy/40 mt-0.5">{b.booking_ref}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${BUCKET_LABELS[bucket].color}`}>
                                {BUCKET_LABELS[bucket].label}
                              </span>
                              <p className="text-xs font-bold text-hampton-navy mt-1.5">{fmtMoney(b.total_cents)}</p>
                              {b.balance_due_cents > 0 && (
                                <p className="text-[10px] text-hampton-navy/50">{fmtMoney(b.balance_due_cents)} due</p>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}

              {error && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

              <button
                onClick={startNew}
                className="w-full border-2 border-hampton-navy text-hampton-navy font-bold py-3 rounded-full text-sm hover:bg-hampton-navy/5 flex items-center justify-center gap-2"
              >
                <Plus size={16} /> Start a new party plan
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
