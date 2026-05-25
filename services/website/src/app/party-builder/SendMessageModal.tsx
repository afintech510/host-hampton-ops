'use client'

import { useState } from 'react'
import { X, Loader2, Send, Check, AlertCircle } from 'lucide-react'

export default function SendMessageModal({
  open,
  onClose,
  bookingRef,
}: {
  open: boolean
  onClose: () => void
  bookingRef?: string
}) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  async function handleSend() {
    setError('')
    if (message.trim().length < 3) { setError('Type a quick message'); return }
    setSending(true)
    try {
      const res = await fetch('/api/portal/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Failed to send'); return }
      setSent(true)
      setMessage('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  function handleClose() {
    setSent(false)
    setError('')
    setMessage('')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/40 px-2 sm:px-4 py-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-hampton-mauve/15">
          <div>
            <h3 className="font-serif text-lg font-bold text-hampton-navy">Message Host Hampton</h3>
            {bookingRef && <p className="text-xs text-hampton-navy/50">Booking {bookingRef}</p>}
          </div>
          <button onClick={handleClose} disabled={sending} className="text-hampton-navy/40 hover:text-hampton-navy p-1" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 sm:p-6">
          {sent ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-3">
                <Check size={20} className="text-green-700" />
              </div>
              <p className="font-serif text-base text-hampton-navy mb-1">Got it!</p>
              <p className="text-sm text-hampton-navy/60">We&apos;ll reply by email shortly.</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-hampton-navy/60 mb-3">
                Need to make a special request, ask a question, or share allergies? Send a quick note — we usually reply within a few hours.
              </p>
              <textarea
                autoFocus
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Hi! We were thinking..."
                rows={5}
                className="form-input resize-none w-full"
                maxLength={5000}
                disabled={sending}
              />
              <p className="text-[10px] text-hampton-navy/40 text-right mt-1">{message.length}/5000</p>
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-xs text-red-700 mt-3 flex items-start gap-2">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-hampton-mauve/15 flex gap-2">
          {sent ? (
            <button
              onClick={handleClose}
              className="flex-1 py-2.5 rounded-full bg-hampton-navy text-white text-sm font-semibold hover:bg-opacity-90"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={handleClose}
                disabled={sending}
                className="flex-1 py-2.5 rounded-full border-2 border-hampton-navy/20 text-hampton-navy text-sm font-semibold hover:bg-hampton-navy/5 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending || message.trim().length < 3}
                className="flex-1 py-2.5 rounded-full bg-hampton-navy text-white text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {sending
                  ? <><Loader2 size={14} className="animate-spin" /> Sending…</>
                  : <><Send size={14} /> Send</>
                }
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
