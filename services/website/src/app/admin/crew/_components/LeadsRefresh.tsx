'use client'

/**
 * The Refresh button at the top right of Leads: check email and texts for anything new from the
 * leads and bookings, then re-read the list. It reads and records; it sends nothing. The result is
 * said in one line under the filters, including what it could NOT check, so "nothing new" is never
 * a guess.
 */

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Banner, useAdminApi } from './adminCrew'
import { load } from './adminData'
import type { EmailRefresh } from '@/app/api/admin/leads/refresh/route'
import type { TextRefresh } from '@/lib/leadsRefresh'

interface Result { email: EmailRefresh; texts: TextRefresh }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The one-line account of a refresh, and whether anything in it needs care. */
export function describeRefresh(r: Result): { text: string; warn: boolean } {
  const parts: string[] = []
  let warn = false
  if (r.email.status === 'ok') parts.push(r.email.recorded ? `${plural(r.email.recorded, 'new email')}` : 'no new email')
  else { parts.push(`email not checked (${r.email.reason ?? 'unavailable'})`); warn = true }
  const t = r.texts
  const found = t.newInbound + t.newOutbound
  if (t.unavailable && t.checked === 0) { parts.push(`texts not checked (${t.unavailable})`); warn = true }
  else {
    parts.push(found ? `${plural(t.newInbound, 'new text')} from clients${t.newOutbound ? ` and ${t.newOutbound} sent from Quo` : ''}` : 'no new texts')
    if (t.unavailable) { parts.push(t.unavailable); warn = true }
    if (t.more) { parts.push('more conversations than one refresh reads, tap again'); warn = true }
  }
  if (t.stops > 0) { parts.push(`${plural(t.stops, 'client')} texted STOP: open Quo and opt them out`); warn = true }
  const text = parts.join(' · ')
  return { text: text.charAt(0).toUpperCase() + text.slice(1) + '.', warn }
}

export function useLeadsRefresh() {
  const api = useAdminApi()
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ text: string; warn: boolean } | null>(null)

  async function run() {
    if (busy) return
    setBusy(true)
    setOutcome(null)
    const r = await api<Result & { error?: string }>('/api/admin/leads/refresh', { method: 'POST', body: {} })
    if (r.ok && r.data.email && r.data.texts) setOutcome(describeRefresh(r.data))
    else setOutcome({ text: r.data.error || 'Could not refresh.', warn: true })
    // What came in shows up in the cards: re-read them whatever the answer, a partial one included.
    await load('/api/admin/leads')
    setBusy(false)
  }
  return { busy, outcome, run }
}

export function RefreshButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label="Refresh: check email and texts for new messages"
      className="inline-flex items-center gap-1.5 h-8 rounded-full border border-hampton-navy/15 bg-white px-3 text-xs font-semibold text-hampton-navy active:bg-hampton-navy/10 disabled:cursor-wait disabled:opacity-60"
    >
      <RefreshCw size={14} aria-hidden="true" className={busy ? 'animate-spin' : ''} /> {busy ? 'Checking…' : 'Refresh'}
    </button>
  )
}

export function RefreshOutcome({ busy, outcome }: { busy: boolean; outcome: { text: string; warn: boolean } | null }) {
  if (busy) return <div role="status" className="mb-3 text-center text-xs text-hampton-navy/70">Checking email and texts for new messages…</div>
  if (!outcome) return null
  return <Banner tone={outcome.warn ? 'warn' : 'ok'}>{outcome.text}</Banner>
}
