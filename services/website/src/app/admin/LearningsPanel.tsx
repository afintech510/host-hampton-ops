'use client'

import { useState, useEffect, useCallback } from 'react'
import { GraduationCap, Plus, AlertTriangle, Power, PowerOff, RefreshCw } from 'lucide-react'

/**
 * What the agent has learned, and what it is waiting to be allowed to learn
 * (Phase 6).
 *
 * The panel is built around one fact that has to be unmissable: a rule is
 * either LIVE — in every draft the agent writes from now on — or it is inert.
 * Nothing in between, and nothing becomes live without somebody here pressing
 * a button. So live rules are listed first and separately from proposals, and
 * the count of live rules is in the heading rather than implied by a row of
 * badges you have to read one at a time.
 *
 * The refusal messages are shown verbatim. The screen in lib/agent/learnings.ts
 * is deliberately over-sensitive — it refuses "never offer a discount" because
 * it cannot tell that from "offer a discount" — and the only thing that makes
 * that tolerable is that it says exactly what it matched.
 */

interface Learning {
  id: string
  kind: string
  text: string
  confidence: number | null
  is_active: boolean
  created_by: string | null
  created_at: string
  activated_by: string | null
  activated_at: string | null
  deactivated_by: string | null
  deactivated_at: string | null
}

interface VoiceProfileRow {
  id: string
  version: number
  is_active: boolean
  confidence: string | null
  corpus_notes: string | null
  created_by: string | null
  created_at: string
}

interface DistillRun {
  id: string
  actor: string | null
  created_at: string
  meta: Record<string, unknown> | null
}

const KIND_TONE: Record<string, string> = {
  style: 'bg-purple-100 text-purple-800',
  rule: 'bg-blue-100 text-blue-800',
  fact: 'bg-emerald-100 text-emerald-800',
  pricing: 'bg-amber-100 text-amber-800',
}

function who(actor: string | null): string {
  if (!actor) return 'unknown'
  return actor.startsWith('admin:') ? actor.slice(6) : actor
}

export default function LearningsPanel({
  headers,
  onLogout,
}: {
  headers: Record<string, string>
  onLogout: () => void
}) {
  const [learnings, setLearnings] = useState<Learning[]>([])
  const [profiles, setProfiles] = useState<VoiceProfileRow[]>([])
  const [runs, setRuns] = useState<DistillRun[]>([])
  const [kinds, setKinds] = useState<string[]>(['style', 'rule', 'fact', 'pricing'])
  const [maxChars, setMaxChars] = useState(400)
  const [loadErrors, setLoadErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [newKind, setNewKind] = useState('style')
  const [newText, setNewText] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/learnings', { headers })
      if (res.status === 401) { onLogout(); return }
      const data = await res.json()
      setLearnings(data.learnings || [])
      setProfiles(data.voiceProfiles || [])
      setRuns(data.distillRuns || [])
      if (Array.isArray(data.kinds) && data.kinds.length) setKinds(data.kinds)
      if (typeof data.maxChars === 'number') setMaxChars(data.maxChars)
      setLoadErrors(data.errors || [])
    } catch (err) {
      console.error('Failed to load learnings:', err)
      setLoadErrors(['Could not reach the server — the list below may be out of date.'])
    } finally {
      setLoading(false)
    }
  }, [headers, onLogout])

  useEffect(() => { load() }, [load])

  async function post(key: string, body: Record<string, unknown>, okMessage: string) {
    setBusy(key); setError(null); setNotice(null)
    try {
      const res = await fetch('/api/admin/learnings', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.status === 401) { onLogout(); return }
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Something went wrong'); return }
      setNotice(okMessage)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(null)
    }
  }

  const active = learnings.filter(l => l.is_active)
  // A proposal is one nobody has ruled on yet. A retired rule (deactivated_at
  // set) stays in the table so the weekly distiller cannot re-propose it, but it
  // is not work waiting for anybody, so it does not sit in the queue.
  const proposed = learnings.filter(l => !l.is_active && !l.deactivated_at)
  const retired = learnings.filter(l => !l.is_active && l.deactivated_at)
  const lastRun = runs[0]

  function row(l: Learning) {
    return (
      <div key={l.id} className="px-4 py-3 flex flex-wrap items-start gap-2">
        <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${KIND_TONE[l.kind] || 'bg-gray-100 text-gray-600'}`}>
          {l.kind}
        </span>
        <p className="text-sm text-gray-800 flex-1 min-w-[16rem]">{l.text}</p>
        <span className="text-[11px] text-gray-400 shrink-0">
          {l.is_active
            ? `live · turned on by ${who(l.activated_by)}`
            : l.deactivated_at
              ? `retired by ${who(l.deactivated_by)}`
              : `proposed by ${who(l.created_by)}`}
          {l.confidence != null && ` · ${Math.round(l.confidence * 100)}%`}
        </span>
        <button
          onClick={() =>
            post(
              l.id,
              { action: l.is_active ? 'deactivate' : 'activate', id: l.id },
              l.is_active
                ? 'Retired. It is out of the prompt from the next draft.'
                : 'Live. Every draft from now on follows it.',
            )
          }
          disabled={busy === l.id}
          className={`text-xs px-2.5 py-1 rounded-lg inline-flex items-center gap-1 shrink-0 disabled:opacity-50 ${
            l.is_active
              ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              : 'bg-hampton-navy text-white hover:opacity-90'
          }`}
        >
          {l.is_active ? <><PowerOff className="w-3 h-3" /> Retire</> : <><Power className="w-3 h-3" /> Make live</>}
        </button>
      </div>
    )
  }

  return (
    <section>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-hampton-navy mb-3">
        <GraduationCap className="w-4 h-4" /> What the agent has learned ({active.length} live)
        <button
          onClick={load}
          className="ml-auto p-1.5 text-gray-400 hover:text-hampton-navy hover:bg-gray-100 rounded-lg"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </h3>

      {loadErrors.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3 mb-3">
          <AlertTriangle className="w-4 h-4 inline mr-1.5 -mt-0.5" />
          {loadErrors.join(' · ')} — check that migration 041 has been applied.
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 mb-3">{error}</div>}
      {notice && <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-4 py-3 mb-3">{notice}</div>}

      {/* ── Add a rule by hand ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={newKind}
            onChange={e => setNewKind(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-2 py-1.5"
          >
            {kinds.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <input
            value={newText}
            onChange={e => setNewText(e.target.value.slice(0, maxChars))}
            placeholder="e.g. Always name the birthday child in the first line"
            className="flex-1 min-w-[16rem] text-sm border border-gray-300 rounded-lg px-3 py-1.5"
          />
          <button
            onClick={() => post('add', { action: 'add', kind: newKind, text: newText }, 'Added and live.').then(() => setNewText(''))}
            disabled={busy === 'add' || newText.trim().length < 8}
            className="text-sm px-3 py-1.5 rounded-lg bg-hampton-navy text-white hover:opacity-90 inline-flex items-center gap-1 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" /> Add rule
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          A rule you add here goes live immediately and is used on every draft. It may not contain a price, a
          discount, a link or an email address — those come from the plan and the pricing catalogue, never from a rule.
        </p>
      </div>

      {/* ── Live ── */}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 mb-3">
        {active.length === 0 && (
          <p className="text-sm text-gray-400 p-4">
            Nothing live yet — the agent is drafting from the base prompt and the voice profile alone.
          </p>
        )}
        {active.map(row)}
      </div>

      {/* ── Proposals ── */}
      {proposed.length > 0 && (
        <>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Proposed by the weekly review ({proposed.length}) — none of these are in use
          </h4>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 mb-3">
            {proposed.map(row)}
          </div>
        </>
      )}

      {/* ── Voice profiles ── */}
      {profiles.length > 0 && (
        <>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Voice profile</h4>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 mb-3">
            {profiles.map(p => (
              <div key={p.id} className="px-4 py-2.5 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-hampton-navy">v{p.version}</span>
                {p.is_active
                  ? <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-800">live</span>
                  : <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">proposed</span>}
                <span className="text-gray-400">{p.confidence} confidence</span>
                <span className="text-gray-400 flex-1 min-w-[10rem]">{p.corpus_notes}</span>
                {!p.is_active && (
                  <button
                    onClick={() => post(p.id, { action: 'activate_voice', id: p.id }, `Voice profile v${p.version} is live.`)}
                    disabled={busy === p.id}
                    className="text-xs px-2.5 py-1 rounded-lg bg-hampton-navy text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Make live
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── The weekly run ── */}
      <p className="text-[11px] text-gray-400">
        {lastRun
          ? `Weekly review last ran ${new Date(lastRun.created_at).toLocaleString()} — ${String(
              (lastRun.meta as { edited?: unknown })?.edited ?? 0,
            )} edited draft(s) considered, ${String((lastRun.meta as { proposed?: unknown })?.proposed ?? 0)} proposed${
              Array.isArray((lastRun.meta as { refused?: unknown })?.refused) &&
              ((lastRun.meta as { refused: unknown[] }).refused.length > 0)
                ? `, ${(lastRun.meta as { refused: unknown[] }).refused.length} refused by the screen`
                : ''
            }.`
          : 'The weekly review has not run yet.'}
        {retired.length > 0 && ` ${retired.length} retired rule(s) are kept so they cannot be proposed again.`}
      </p>
    </section>
  )
}
