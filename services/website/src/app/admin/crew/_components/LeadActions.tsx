'use client'

/**
 * Two things you do to a lead from its opened tile, each the Parties tab's own action:
 *
 *   Mark lost     sets the lead to Lost (it leaves this list). Sends the client nothing.
 *   Add payment   writes down money that arrived outside Stripe: cash, Zelle, the GoDaddy
 *                 card terminal, or another way. It goes through the dashboard's
 *                 record_payment action, so the books, the balance and the guards on a
 *                 cancelled or already-covered booking all apply. No receipt is sent
 *                 unless the box is ticked.
 *
 * Both ask for a confirmation first, and both refresh every screen's data afterwards.
 * GoDaddy is stored as a card payment with "GoDaddy card terminal" in its note: the
 * payments table has no GoDaddy method of its own.
 */

import { useState } from 'react'
import { CreditCard, X } from 'lucide-react'
import { BTN_PRIMARY, INPUT, useAdminApi } from './adminCrew'
import { refreshAll } from './adminData'
import { CARD_ACTION } from './PartyTile'

export const PAY_METHODS = [
  { key: 'cash', label: 'Cash', method: 'cash', note: '' },
  { key: 'zelle', label: 'Zelle', method: 'zelle', note: '' },
  { key: 'godaddy', label: 'GoDaddy', method: 'card', note: 'GoDaddy card terminal' },
  { key: 'other', label: 'Other', method: 'other', note: '' },
] as const
export type PayMethodKey = (typeof PAY_METHODS)[number]['key']

const TYPES = [
  { key: 'deposit', label: 'Deposit' },
  { key: 'partial', label: 'Payment' },
  { key: 'final', label: 'Final balance' },
] as const

/** "250", "250.5", "$1,250.00" → cents; null when it is not a positive amount. */
export function dollarsToCents(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const cents = Math.round(Number(t) * 100)
  return cents > 0 && cents <= 10_000_000 ? cents : null
}

export function paymentBody(f: { cents: number; method: PayMethodKey; type: string; note: string; receipt: boolean }) {
  const m = PAY_METHODS.find(x => x.key === f.method)!
  const notes = [m.note, f.note.trim()].filter(Boolean).join(' - ')
  return {
    action: 'record_payment',
    amount_cents: f.cents,
    payment_method: m.method,
    payment_type: f.type,
    ...(notes ? { notes } : {}),
    // Off unless asked for: recording money that already arrived should not email anyone by surprise.
    send_receipt: f.receipt,
  }
}

const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function LeadActions({ bookingId, name }: { bookingId: string; name: string }) {
  const api = useAdminApi()
  const [form, setForm] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PayMethodKey>('cash')
  const [type, setType] = useState<string>('deposit')
  const [note, setNote] = useState('')
  const [receipt, setReceipt] = useState(false)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  // Every screen's held data is re-read: the lead leaves Leads, a booking appears, the dashboard and Payments move.
  const changed = () => refreshAll()

  async function markLost() {
    if (!window.confirm(`Mark ${name} as lost? Nothing is sent to them, and they leave the leads list.`)) return
    setBusy('lost')
    setMsg(null)
    const r = await api<{ ok?: boolean; error?: string }>(`/api/admin/parties/${bookingId}`, { method: 'POST', body: { action: 'mark_lost' } })
    setBusy('')
    if (!r.ok || r.data.ok === false) {
      setMsg({ tone: 'error', text: r.data.error || 'Could not mark it lost.' })
      return
    }
    setMsg({ tone: 'ok', text: 'Marked lost.' })
    changed()
  }

  async function addPayment(e: React.FormEvent) {
    e.preventDefault()
    const cents = dollarsToCents(amount)
    if (cents === null) {
      setMsg({ tone: 'error', text: 'Enter the amount received, like 250 or 250.50.' })
      return
    }
    const m = PAY_METHODS.find(x => x.key === method)!
    if (!window.confirm(`Record ${money(cents)} ${m.label} received from ${name}? It counts toward their booking${receipt ? ' and they are emailed a receipt' : ''}.`)) return
    setBusy('pay')
    setMsg(null)
    const r = await api<{ ok?: boolean; error?: string; message?: string }>(`/api/admin/parties/${bookingId}`, {
      method: 'POST',
      body: paymentBody({ cents, method, type, note, receipt }),
    })
    setBusy('')
    if (!r.ok || r.data.ok === false) {
      setMsg({ tone: 'error', text: r.data.error || 'Could not record the payment.' })
      return
    }
    setMsg({ tone: 'ok', text: r.data.message || `${money(cents)} recorded.` })
    setForm(false)
    setAmount('')
    setNote('')
    changed()
  }

  return (
    <div className="border-t border-hampton-navy/10 pt-4" data-lead-actions>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={CARD_ACTION} disabled={!!busy} onClick={() => setForm(v => !v)} aria-expanded={form}>
          <CreditCard size={15} aria-hidden="true" />{form ? 'Close payment' : 'Add payment'}
        </button>
        <button type="button" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 disabled:opacity-50 sm:text-sm" disabled={!!busy} onClick={markLost}>
          <X size={14} aria-hidden="true" />
          {busy === 'lost' ? 'Marking…' : 'Mark lead lost'}
        </button>
      </div>

      {form && (
        <form onSubmit={addPayment} className="mt-3 space-y-2">
          <div className="flex flex-wrap justify-center gap-1.5" role="group" aria-label="How it was paid">
            {PAY_METHODS.map(m => (
              <button
                key={m.key}
                type="button"
                aria-pressed={method === m.key}
                onClick={() => setMethod(m.key)}
                className={`h-8 rounded-full px-3 text-xs font-semibold ${method === m.key ? 'bg-hampton-navy text-[#F6F1EB]' : 'bg-white text-hampton-navy border border-hampton-navy/15'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className={`${INPUT} w-full`}
              inputMode="decimal"
              placeholder="Amount, e.g. 250"
              aria-label="Amount received in dollars"
              value={amount}
              onChange={e => setAmount(e.target.value)}
            />
            <select className={INPUT} aria-label="What it covers" value={type} onChange={e => setType(e.target.value)}>
              {TYPES.map(t => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
          <input className={`${INPUT} w-full`} placeholder="Note (optional)" aria-label="Note" value={note} onChange={e => setNote(e.target.value)} maxLength={200} />
          <label className="flex items-center gap-2 text-sm text-hampton-navy/70">
            <input type="checkbox" checked={receipt} onChange={e => setReceipt(e.target.checked)} /> Email them a receipt
          </label>
          <div className="flex justify-center">
            <button type="submit" className={BTN_PRIMARY} disabled={!!busy}>
              {busy === 'pay' ? 'Recording…' : 'Record payment'}
            </button>
          </div>
        </form>
      )}

      {msg && <div className={`mt-2 text-center text-sm ${msg.tone === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</div>}
    </div>
  )
}
