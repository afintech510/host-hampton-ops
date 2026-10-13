'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import {
  ESM_COLORS,
  ESM_PATCHES,
  ESM_PRODUCTS,
  looseKey,
  priceEsmPaperOrder,
  variantKey,
} from '@/lib/fundraiserCatalog'
import { HOME_DELIVERY_FEE_CENTS } from '@/lib/fundraiserDelivery'
import { patchPriceCents } from '@/lib/fundraiserPatches'

/**
 * Key in an order that came in on the printed form.
 *
 * The grid is the paper form's grid on purpose — product rows, colour × patch
 * columns — so an organizer keying a stack of forms is copying boxes across, not
 * translating. Only quantities are sent; the server prices them
 * (`POST /api/cm-cheer-orders`), and the total shown here comes from the same
 * `priceEsmPaperOrder`, so what is on screen is what will be saved.
 */

interface Props {
  teamSlug: string
  token: string
  personLabel: string
  /** Called with the new order number after a successful save. */
  onSaved: (orderRef: string) => void
  focusRing: string
  darkButton: string
  accentText: string
}

const EMPTY = {
  athleteName: '', teacherName: '', parentName: '', email: '', phone: '',
  deliveryMethod: 'classroom' as 'classroom' | 'home', deliveryAddress: '',
  paymentMethod: 'cash' as 'cash' | 'venmo', markPaid: true, notes: '',
}

export default function PaperOrderForm(p: Props) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState(EMPTY)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [lastRef, setLastRef] = useState('')

  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setF(prev => ({ ...prev, [k]: v }))
  const setQ = (key: string, v: string) => setQty(prev => ({ ...prev, [key]: v.replace(/[^0-9]/g, '').slice(0, 2) }))

  const quantities = Object.fromEntries(
    Object.entries(qty).filter(([, v]) => v !== '' && Number(v) > 0).map(([k, v]) => [k, Number(v)]),
  )
  const priced = priceEsmPaperOrder(quantities)
  const itemsCents = priced.ok ? priced.totalCents : 0
  const totalCents = itemsCents + (priced.ok && f.deliveryMethod === 'home' ? HOME_DELIVERY_FEE_CENTS : 0)
  const loosePatches = ESM_PATCHES.reduce((n, pt) => n + (Number(qty[looseKey(pt.key)]) || 0), 0)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!priced.ok) { setError('Enter at least one item.'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/cm-cheer-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.token}` },
        body: JSON.stringify({ team: p.teamSlug, ...f, quantities }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Could not save that order.'); return }
      setLastRef(data.order_ref)
      // Keep the payment settings between forms: a stack of paper orders is
      // almost always the same payment type, and retyping it is the slow part.
      setF({ ...EMPTY, paymentMethod: f.paymentMethod, markPaid: f.markPaid })
      setQty({})
      p.onSaved(data.order_ref)
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setSaving(false)
    }
  }

  const input = `w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none ${p.focusRing}`
  const label = 'block text-[11px] font-bold text-gray-500 uppercase mb-1'
  const box = 'w-12 text-center border-2 border-gray-200 rounded-md py-1.5 text-sm font-bold focus:outline-none focus:border-slate-500'

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex items-center justify-center gap-1.5 ${p.darkButton} text-white rounded-lg px-3 py-2 text-sm transition-colors`}
      >
        <Plus size={14} /> Add paper order
      </button>
    )
  }

  return (
    <form onSubmit={save} className="bg-white rounded-xl border-2 border-slate-300 shadow-sm p-4 sm:p-5 space-y-4 w-full">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-zinc-900 text-sm uppercase tracking-wide">Add a paper order</h2>
        <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
      </div>
      {lastRef && (
        <p className="text-sm bg-green-50 border border-green-200 text-green-800 rounded-lg px-3 py-2">
          Saved <strong>{lastRef}</strong>. The form is clear for the next one.
        </p>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className={label}>{p.personLabel}&apos;s name *</label><input className={input} value={f.athleteName} onChange={e => set('athleteName', e.target.value)} required /></div>
        <div><label className={label}>Teacher *</label><input className={input} value={f.teacherName} onChange={e => set('teacherName', e.target.value)} required /></div>
        <div><label className={label}>Parent / buyer *</label><input className={input} value={f.parentName} onChange={e => set('parentName', e.target.value)} required /></div>
        <div><label className={label}>Phone</label><input className={input} type="tel" value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
        <div className="sm:col-span-2">
          <label className={label}>Email <span className="font-normal normal-case text-gray-400">— optional; no confirmation is sent for paper orders</span></label>
          <input className={input} type="email" value={f.email} onChange={e => set('email', e.target.value)} />
        </div>
      </div>

      {/* The paper form's grid: item rows, colour × patch columns. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase text-gray-500">
              <th className="text-left py-1 pr-2">Item</th>
              {ESM_COLORS.flatMap(c => ESM_PATCHES.map(pt => (
                <th key={c.key + pt.key} className="py-1 px-1 text-center font-bold">{c.label}<br />{pt.label}</th>
              )))}
            </tr>
          </thead>
          <tbody>
            {ESM_PRODUCTS.map(prod => (
              <tr key={prod.key} className="border-t border-gray-100">
                <td className="py-1.5 pr-2 font-medium whitespace-nowrap">{prod.title} <span className="text-gray-400">${prod.priceCents / 100}</span></td>
                {ESM_COLORS.flatMap(c => ESM_PATCHES.map(pt => {
                  const k = variantKey(prod.key, c.key, pt.key)
                  return (
                    <td key={k} className="py-1.5 px-1 text-center">
                      <input
                        className={box} inputMode="numeric" placeholder="QTY" aria-label={`${c.label} ${prod.title} ${pt.label}`}
                        value={qty[k] ?? ''} onChange={e => setQ(k, e.target.value)}
                      />
                    </td>
                  )
                }))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-4 bg-gray-50 rounded-lg px-3 py-2">
        <span className="text-sm font-medium">Patches on their own</span>
        {ESM_PATCHES.map(pt => (
          <label key={pt.key} className="flex items-center gap-2 text-sm">
            {pt.label}
            <input
              className={box} inputMode="numeric" placeholder="QTY" aria-label={`${pt.label} patch`}
              value={qty[looseKey(pt.key)] ?? ''} onChange={e => setQ(looseKey(pt.key), e.target.value)}
            />
          </label>
        ))}
        {loosePatches > 0 && <span className="text-xs text-gray-500">{loosePatches} patch{loosePatches === 1 ? '' : 'es'} = ${(patchPriceCents(loosePatches) / 100).toFixed(2)}</span>}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className={label}>Getting it to them</label>
          <select className={input} value={f.deliveryMethod} onChange={e => set('deliveryMethod', e.target.value as 'classroom' | 'home')}>
            <option value="classroom">Given to the child at school — free</option>
            <option value="home">Home delivery — +${HOME_DELIVERY_FEE_CENTS / 100}</option>
          </select>
        </div>
        <div>
          <label className={label}>Payment</label>
          <select className={input} value={f.paymentMethod} onChange={e => set('paymentMethod', e.target.value as 'cash' | 'venmo')}>
            <option value="cash">Cash (sent in with the form)</option>
            <option value="venmo">Venmo</option>
          </select>
        </div>
        {f.deliveryMethod === 'home' && (
          <div className="sm:col-span-2">
            <label className={label}>Delivery address *</label>
            <textarea className={input} rows={2} value={f.deliveryAddress} onChange={e => set('deliveryAddress', e.target.value)} required />
          </div>
        )}
        <div className="sm:col-span-2"><label className={label}>Note</label><input className={input} value={f.notes} onChange={e => set('notes', e.target.value)} placeholder="e.g. cash $65 in envelope" /></div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.markPaid} onChange={e => set('markPaid', e.target.checked)} className="w-4 h-4" />
        Payment is already in hand — record this order as <strong>paid</strong>
      </label>

      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm">Total <span className={`text-2xl font-black ${p.accentText}`}>${(totalCents / 100).toFixed(2)}</span></p>
        <button
          type="submit" disabled={saving || !priced.ok}
          className={`${p.darkButton} text-white px-5 py-2.5 rounded-lg text-sm font-bold disabled:opacity-40 transition-colors`}
        >
          {saving ? 'Saving…' : 'Save order'}
        </button>
      </div>
    </form>
  )
}
