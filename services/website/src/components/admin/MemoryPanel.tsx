'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pencil, Trash2 } from 'lucide-react'

const TOKEN_KEY = 'hh_admin_token'

function authHeaders(): Record<string, string> {
  const t = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

interface SavedMemory {
  id: string
  scope: 'personal' | 'business'
  body: string
}

/**
 * What the assistant remembers. Your own preferences and the studio rules, with
 * add, reword and forget. This is a person's own click, so it writes directly
 * through the Memory route (the same one the assistant's Remember card replays);
 * the route re-checks every sentence either way.
 */
export default function MemoryPanel() {
  const [items, setItems] = useState<SavedMemory[] | null>(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [scope, setScope] = useState<'personal' | 'business'>('personal')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/assistant/memory', { headers: authHeaders() })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Error ${res.status}`)
        return
      }
      setError('')
      setItems([
        ...(data.business ?? []).map((m: SavedMemory) => ({ ...m, scope: 'business' as const })),
        ...(data.personal ?? []).map((m: SavedMemory) => ({ ...m, scope: 'personal' as const })),
      ])
    } catch {
      setError('Could not reach the server.')
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  async function call(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/admin/assistant/memory', { method, headers: authHeaders(), body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok !== true) {
        setError(data.error || `Error ${res.status}`)
        return false
      }
      await load()
      return true
    } catch {
      setError('Could not reach the server.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const group = (s: 'business' | 'personal', title: string) => {
    const rows = (items ?? []).filter(i => i.scope === s)
    return (
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-hampton-navy/60 mb-1">{title}</p>
        {rows.length === 0 && <p className="text-sm text-hampton-navy/50">Nothing saved.</p>}
        <ul className="space-y-1">
          {rows.map(m => (
            <li key={m.id} className="flex items-start gap-2 text-sm text-hampton-navy">
              {editing?.id === m.id ? (
                <>
                  <input
                    value={editing.text}
                    onChange={e => setEditing({ id: m.id, text: e.target.value })}
                    className="flex-1 border border-hampton-mauve/40 rounded px-2 py-1"
                    aria-label="Reword this preference"
                  />
                  <button
                    disabled={busy}
                    onClick={async () => { if (await call('PATCH', { id: m.id, text: editing.text })) setEditing(null) }}
                    className="text-xs border border-hampton-navy rounded-full px-2 py-1"
                  >
                    Save
                  </button>
                  <button onClick={() => setEditing(null)} className="text-xs text-hampton-navy/60 px-1">Cancel</button>
                </>
              ) : (
                <>
                  <span className="flex-1">{m.body}</span>
                  <button onClick={() => setEditing({ id: m.id, text: m.body })} aria-label="Reword" className="text-hampton-navy/50 hover:text-hampton-navy">
                    <Pencil size={13} />
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => { if (window.confirm('Forget this preference?')) call('DELETE', { id: m.id }) }}
                    aria-label="Forget"
                    className="text-hampton-navy/50 hover:text-red-700"
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {items === null && !error && (
        <p className="flex items-center gap-2 text-sm text-hampton-navy/60"><Loader2 size={14} className="animate-spin" /> Loading…</p>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {items !== null && (
        <div className="grid gap-3 sm:grid-cols-2">
          {group('personal', 'Just you')}
          {group('business', 'Whole studio')}
        </div>
      )}
      <form
        onSubmit={async e => {
          e.preventDefault()
          if (draft.trim() && (await call('POST', { scope, text: draft }))) setDraft('')
        }}
        className="flex flex-wrap gap-2"
      >
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          maxLength={300}
          placeholder="Add a preference, e.g. Show times in 12-hour New York time"
          className="flex-1 min-w-[12rem] border border-hampton-mauve/40 rounded-lg px-3 py-1.5 text-sm"
        />
        <select value={scope} onChange={e => setScope(e.target.value as 'personal' | 'business')} className="border border-hampton-mauve/40 rounded-lg px-2 text-sm" aria-label="Who it applies to">
          <option value="personal">Just me</option>
          <option value="business">Whole studio</option>
        </select>
        <button type="submit" disabled={busy || !draft.trim()} className="bg-hampton-navy text-white rounded-lg px-3 text-sm disabled:opacity-40">
          Save
        </button>
      </form>
      <p className="text-[11px] text-hampton-navy/50">You can also just tell the assistant &ldquo;remember to…&rdquo; and confirm the card.</p>
    </div>
  )
}

