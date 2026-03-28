'use client'

import { useState } from 'react'
import { Send, Mail, MessageSquare, ChevronDown, ChevronUp, CheckCircle2, Link2, Copy } from 'lucide-react'

const CATEGORY_OPTIONS = [
  'Room Rental',
  'Party Booking',
  'Event Ticket',
  'Permanent Jewelry',
  'Custom Service',
  'Balance Due',
  'Other',
]

export default function PayLinkPanel({ headers, onLogout }: { headers: Record<string, string>; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Room Rental')
  const [channel, setChannel] = useState<'email' | 'sms' | 'both' | 'link_only'>('email')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; payUrl?: string } | null>(null)

  async function handleSend() {
    if (!name.trim() || !amount || !description.trim()) return
    if ((channel === 'email' || channel === 'both') && !email.trim()) return
    if ((channel === 'sms' || channel === 'both') && !phone.trim()) return

    setSending(true)
    setResult(null)
    try {
      const res = await fetch('/api/admin/pay-link', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          channel,
          amountDollars: amount,
          description: description.trim(),
          category,
        }),
      })
      if (res.status === 401) { onLogout(); return }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setResult({
        ok: true,
        message: data.results?.join(' & ') || 'Link created!',
        payUrl: data.payUrl,
      })
      // Don't clear fields so admin can copy link if needed
    } catch (err: any) {
      setResult({ ok: false, message: err.message || 'Failed to create pay link' })
    } finally {
      setSending(false)
    }
  }

  function handleCopyLink() {
    if (result?.payUrl) {
      navigator.clipboard.writeText(result.payUrl)
    }
  }

  function handleReset() {
    setName('')
    setEmail('')
    setPhone('')
    setAmount('')
    setDescription('')
    setCategory('Room Rental')
    setResult(null)
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#A1B5C8] to-[#1a2744] flex items-center justify-center">
            <Link2 className="w-4 h-4 text-white" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-hampton-navy">Send Pay Link</p>
            <p className="text-xs text-gray-400">Create a Stripe payment link and send it via email or text</p>
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-gray-100 pt-4 space-y-4">
          {/* Row 1: Name + Amount + Category */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Client Name *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Jane Smith"
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-blue/30"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Amount ($) *</label>
              <input
                type="number"
                min="1"
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="150.00"
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-blue/30"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-hampton-blue/30"
              >
                {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Row 2: Description */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Description *</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="2-Hour Room Rental — March 28, 2026"
              className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-blue/30"
            />
          </div>

          {/* Row 3: Email + Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="jane@example.com"
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-blue/30"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+16315551234"
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-blue/30"
              />
            </div>
          </div>

          {/* Channel selector */}
          <div className="flex items-center gap-4">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Send via:</span>
            <div className="flex gap-2">
              {([
                { key: 'email' as const, icon: Mail, label: 'Email' },
                { key: 'sms' as const, icon: MessageSquare, label: 'SMS' },
                { key: 'both' as const, icon: Send, label: 'Both' },
                { key: 'link_only' as const, icon: Link2, label: 'Link Only' },
              ]).map(ch => (
                <button
                  key={ch.key}
                  type="button"
                  onClick={() => setChannel(ch.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    channel === ch.key
                      ? 'bg-hampton-navy text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <ch.icon className="w-3 h-3" />
                  {ch.label}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleSend}
              disabled={sending || !name.trim() || !amount || !description.trim() ||
                ((channel === 'email' || channel === 'both') && !email.trim()) ||
                ((channel === 'sms' || channel === 'both') && !phone.trim())
              }
              className="px-5 py-2.5 rounded-xl bg-hampton-navy text-white text-sm font-semibold disabled:opacity-50 hover:bg-hampton-navy/90 transition-colors flex items-center gap-2"
            >
              <Send className="w-3.5 h-3.5" />
              {sending ? 'Creating...' : channel === 'link_only' ? 'Generate Link' : 'Send Pay Link'}
            </button>

            {result && (
              <>
                <p className={`text-sm flex items-center gap-1.5 ${result.ok ? 'text-green-600' : 'text-red-500'}`}>
                  {result.ok && <CheckCircle2 className="w-4 h-4" />}
                  {result.message}
                </p>
                {result.payUrl && (
                  <button
                    onClick={handleCopyLink}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                    title="Copy payment link to clipboard"
                  >
                    <Copy className="w-3 h-3" />
                    Copy Link
                  </button>
                )}
                {result.ok && (
                  <button
                    onClick={handleReset}
                    className="text-xs text-gray-400 hover:text-gray-600 underline"
                  >
                    New link
                  </button>
                )}
              </>
            )}
          </div>

          {/* Show generated link */}
          {result?.payUrl && (
            <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-500 break-all font-mono">
              {result.payUrl}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
