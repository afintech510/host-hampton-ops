'use client'

import { useState, useEffect, useCallback } from 'react'
import { FlaskConical, AlertTriangle, Power, RefreshCw, Wand2, Archive, HelpCircle } from 'lucide-react'

/**
 * A/B content testing, and the retired `agent_memory` store (Phase 5).
 *
 * The panel is built around the thing that is easiest to get wrong when reading
 * an A/B result: **"not enough data" has to be as loud as a winner.** A
 * confident "variant B converts better" over eleven sends reads exactly like
 * one over eleven thousand, and only one of them is a fact. So the verdict line
 * is the biggest thing in each card, the refusal states both numbers (how many
 * the arm has, how many it needs), and a winner always carries the sentence
 * "nothing has been changed".
 *
 * The second thing it exists to make unmissable: a `draft` experiment does
 * nothing at all. Activating is the moment model-written copy starts reaching
 * customers, and it is the only GATED edge on this entity.
 */

interface Arm {
  variantId: string
  label: string
  isControl: boolean
  sent: number
  metricCount: number
  rate: number | null
}

interface Analysis {
  kind: 'winner' | 'no_difference' | 'not_enough_data' | 'unconfigured' | 'unavailable'
  summary: string
  arms?: Arm[]
  pValue?: number
  alpha?: number
  minPerArm?: number
  unattributed?: number
  metric?: string
}

interface Variant {
  id: string
  label: string
  is_control: boolean
  subject: string | null
  body_text: string | null
  screen_notes: string[]
  created_by: string | null
}

interface Experiment {
  id: string
  name: string
  surface: string
  target_key: string | null
  metric: string
  min_per_arm: number
  alpha: number
  hypothesis: string | null
  status: string
  outcome: string | null
  outcome_note: string | null
  concluded_at: string | null
  created_by: string | null
  created_at: string
  variants: Variant[]
  rejectedVariants: { id: string; label: string; reason: string }[]
  analysis: Analysis
}

interface UnattributedSignal {
  id: string
  kind: string
  reason: string
  meta: Record<string, unknown> | null
  created_at: string
}

interface MemoryRow {
  id: string
  namespace: string
  key: string
  description: string | null
  updated_by: string | null
  updated_at: string
  valuePreview: string
  valueChars: number
  warnings: string[]
  promoted_learning_id: string | null
}

const VERDICT_STYLE: Record<Analysis['kind'], { label: string; cls: string }> = {
  winner: { label: 'Winner', cls: 'bg-green-100 text-green-800 border-green-200' },
  no_difference: { label: 'No difference', cls: 'bg-blue-50 text-blue-800 border-blue-200' },
  not_enough_data: { label: 'Not enough data', cls: 'bg-amber-50 text-amber-900 border-amber-200' },
  unconfigured: { label: 'Not set up', cls: 'bg-gray-100 text-gray-700 border-gray-200' },
  unavailable: { label: 'Could not read', cls: 'bg-red-50 text-red-800 border-red-200' },
}

export default function ExperimentsPanel({
  headers,
  onLogout,
}: {
  headers: Record<string, string>
  onLogout?: () => void
}) {
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [signals, setSignals] = useState<UnattributedSignal[]>([])
  const [memory, setMemory] = useState<MemoryRow[]>([])
  const [memoryNote, setMemoryNote] = useState<string>('')
  const [errors, setErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [showMemory, setShowMemory] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/experiments', { headers })
      if (res.status === 401) {
        onLogout?.()
        return
      }
      const json = await res.json()
      setExperiments(json.experiments ?? [])
      setSignals(json.unattributedSignals ?? [])
      setErrors(json.errors ?? [])
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'could not load experiments'])
    } finally {
      setLoading(false)
    }
  }, [headers, onLogout])

  const loadMemory = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/memory', { headers })
      const json = await res.json()
      if (!res.ok) {
        setMessage({ kind: 'err', text: json.error ?? 'could not read agent_memory' })
        return
      }
      setMemory(json.rows ?? [])
      setMemoryNote(json.note ?? '')
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'could not read agent_memory' })
    }
  }, [headers])

  useEffect(() => {
    load()
  }, [load])

  async function post(body: Record<string, unknown>, key: string) {
    setBusy(key)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/experiments', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        // Verbatim. The refusals here name exactly what they matched, and that
        // is the only thing that makes an over-sensitive screen tolerable.
        setMessage({ kind: 'err', text: json.error ?? `Request failed (${res.status})` })
        return
      }
      setMessage({ kind: 'ok', text: json.note ?? json.appliedNote ?? 'Done.' })
      await load()
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'request failed' })
    } finally {
      setBusy(null)
    }
  }

  async function generate(id: string) {
    setBusy(`gen-${id}`)
    setMessage(null)
    try {
      const res = await fetch(`/api/admin/experiments/${id}/variants`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 1 }),
      })
      const json = await res.json()
      if (!res.ok || json.ok === false) {
        setMessage({ kind: 'err', text: json.error ?? `Generation failed (${res.status})` })
        return
      }
      const refused = (json.refused ?? []) as { label: string; reason: string }[]
      setMessage({
        kind: refused.length ? 'err' : 'ok',
        text:
          `Generated ${json.inserted ?? 0} variant(s)` +
          (json.costUsd ? ` for $${Number(json.costUsd).toFixed(4)}` : '') +
          (refused.length ? ` — REFUSED: ${refused.map(r => `${r.label} (${r.reason})`).join('; ')}` : '') +
          ((json.notes ?? []).length ? ` — ${(json.notes as string[]).join('; ')}` : ''),
      })
      await load()
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'generation failed' })
    } finally {
      setBusy(null)
    }
  }

  const live = experiments.filter(e => e.status === 'active')

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-hampton-navy" />
        <h3 className="text-sm font-semibold text-hampton-navy">
          Content tests — {live.length} live
        </h3>
        <button
          onClick={load}
          className="ml-auto text-xs text-gray-500 hover:text-hampton-navy flex items-center gap-1"
          disabled={loading}
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {errors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {errors.map((e, i) => (
            <p key={i} className="flex items-start gap-2">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {e}
            </p>
          ))}
        </div>
      )}

      {message && (
        <div
          className={`rounded-lg border p-3 text-xs ${
            message.kind === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      <CreateForm
        onCreate={(body, key) => post({ action: 'create', ...body }, key)}
        busy={busy === 'create'}
      />

      {!loading && experiments.length === 0 && (
        <p className="text-sm text-gray-400 bg-white rounded-xl border border-gray-200 p-4">
          No content tests yet. A test compares the live copy of one automated email against a variant COPY writes, and
          measures which one gets clicked. Nothing sends on its own and nothing is changed by a result.
        </p>
      )}

      <div className="space-y-3">
        {experiments.map(e => {
          const verdict = VERDICT_STYLE[e.analysis?.kind ?? 'unconfigured'] ?? VERDICT_STYLE.unconfigured
          return (
            <div key={e.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-hampton-navy">{e.name}</p>
                  <p className="text-xs text-gray-500">
                    {e.surface.replace(/_/g, ' ')} · metric: {e.metric} · needs {e.min_per_arm} per arm · α {e.alpha}
                    {e.target_key ? ` · ${e.target_key}` : ' · any target'}
                  </p>
                </div>
                <span
                  className={`ml-auto text-[11px] px-2 py-0.5 rounded-full border ${
                    e.status === 'active'
                      ? 'bg-green-100 text-green-800 border-green-200'
                      : 'bg-gray-100 text-gray-600 border-gray-200'
                  }`}
                >
                  {e.status}
                </span>
              </div>

              {/* THE VERDICT — the biggest thing on the card, on purpose. */}
              <div className={`rounded-lg border px-3 py-2 ${verdict.cls}`}>
                <p className="text-xs font-semibold">{verdict.label}</p>
                <p className="text-xs mt-0.5">{e.analysis?.summary}</p>
              </div>

              {e.analysis?.arms && e.analysis.arms.length > 0 && (
                <div className="text-xs">
                  <table className="w-full">
                    <thead>
                      <tr className="text-gray-400 text-left">
                        <th className="font-normal py-1">Arm</th>
                        <th className="font-normal">Sent</th>
                        <th className="font-normal">{e.analysis.metric ?? e.metric}</th>
                        <th className="font-normal">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.analysis.arms.map(a => (
                        <tr key={a.variantId} className="border-t border-gray-100">
                          <td className="py-1 font-mono">
                            {a.label}
                            {a.isControl && <span className="ml-1 text-gray-400">(control)</span>}
                          </td>
                          <td>{a.sent}</td>
                          <td>{a.metricCount}</td>
                          {/* A null rate is "—", never 0%. An arm with no sends
                              has no rate, and rendering it as 0% would say it
                              lost. */}
                          <td>{a.rate == null ? '—' : `${(a.rate * 100).toFixed(1)}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {typeof e.analysis.unattributed === 'number' && e.analysis.unattributed > 0 && (
                    <p className="mt-1 text-amber-800">
                      {e.analysis.unattributed} event(s) could not be attributed to any arm — see the unattributed
                      signals below.
                    </p>
                  )}
                </div>
              )}

              {e.rejectedVariants?.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                  <p className="font-semibold">The read-time screen dropped these arms:</p>
                  {e.rejectedVariants.map(r => (
                    <p key={r.id}>
                      {r.label} — {r.reason}
                    </p>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                {e.variants.map(v => (
                  <details key={v.id} className="text-xs border border-gray-100 rounded-lg p-2">
                    <summary className="cursor-pointer text-hampton-navy">
                      <span className="font-mono">{v.label}</span>
                      {v.is_control && <span className="ml-1 text-gray-400">(control — the live copy)</span>}
                      <span className="ml-2 text-gray-600">{v.subject}</span>
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap text-gray-600 font-sans">{v.body_text}</pre>
                    {v.screen_notes?.length > 0 && (
                      <p className="mt-1 text-amber-800">Screen changed: {v.screen_notes.join('; ')}</p>
                    )}
                  </details>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {(e.status === 'draft' || e.status === 'paused' || e.status === 'active') && (
                  <button
                    onClick={() => generate(e.id)}
                    disabled={busy === `gen-${e.id}`}
                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 flex items-center gap-1"
                  >
                    <Wand2 className="w-3 h-3" /> Generate a variant
                  </button>
                )}
                {e.status === 'draft' && (
                  <button
                    onClick={() =>
                      confirm(
                        `Activate "${e.name}"?\n\nFrom now on, contacts reaching this step get one of the variants ` +
                          `instead of only the live copy. Nothing else changes, and you can pause it at any time.`
                      ) && post({ action: 'transition', id: e.id, to: 'active' }, e.id)
                    }
                    disabled={busy === e.id}
                    className="text-xs px-3 py-1.5 rounded-lg bg-hampton-navy text-white hover:opacity-90 flex items-center gap-1"
                  >
                    <Power className="w-3 h-3" /> Activate
                  </button>
                )}
                {e.status === 'active' && (
                  <button
                    onClick={() => post({ action: 'transition', id: e.id, to: 'paused' }, e.id)}
                    disabled={busy === e.id}
                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
                  >
                    Pause
                  </button>
                )}
                {(e.status === 'active' || e.status === 'paused') && (
                  <button
                    onClick={() => post({ action: 'conclude', id: e.id }, e.id)}
                    disabled={busy === e.id}
                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
                  >
                    Record the result
                  </button>
                )}
                {e.status !== 'archived' && (
                  <button
                    onClick={() => post({ action: 'transition', id: e.id, to: 'archived' }, e.id)}
                    disabled={busy === e.id}
                    className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 flex items-center gap-1"
                  >
                    <Archive className="w-3 h-3" /> Archive
                  </button>
                )}
              </div>

              {e.outcome && (
                <p className="text-xs text-gray-500 border-t border-gray-100 pt-2">
                  Recorded {e.concluded_at ? new Date(e.concluded_at).toLocaleString() : ''}: <b>{e.outcome}</b> —{' '}
                  {e.outcome_note}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {signals.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 p-4">
          <p className="text-sm font-semibold text-amber-900 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Signals we could not attribute ({signals.length})
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Real activity that arrived without a variant to attach it to. Not counted against any arm — an
            unattributable record is a bookkeeping problem, an invisible one is a loss.
          </p>
          <div className="mt-2 divide-y divide-gray-100">
            {signals.map(s => (
              <p key={s.id} className="text-xs py-1 text-gray-600">
                <span className="text-gray-400">{new Date(s.created_at).toLocaleString()}</span> · {s.kind} · {s.reason}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* ── The retired orchestrator memory ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <button
          onClick={() => {
            setShowMemory(v => !v)
            if (!showMemory && memory.length === 0) loadMemory()
          }}
          className="text-sm font-semibold text-hampton-navy flex items-center gap-2"
        >
          <HelpCircle className="w-4 h-4" />
          Retired agent memory {memory.length > 0 ? `(${memory.length} rows)` : ''}
        </button>
        <p className="text-xs text-gray-500 mt-1">
          The old orchestrator&rsquo;s knowledge store. Nothing in the running app reads it — it is kept because some of
          it is still true, and some of it holds February prices. Promoting a row turns it into a learned rule for the
          booking agent, which arrives inactive.
        </p>

        {showMemory && (
          <div className="mt-3 space-y-2">
            {memoryNote && <p className="text-xs text-gray-500">{memoryNote}</p>}
            {memory.map(m => (
              <details key={m.id} className="text-xs border border-gray-100 rounded-lg p-2">
                <summary className="cursor-pointer">
                  <span className="font-mono text-hampton-navy">
                    {m.namespace}.{m.key}
                  </span>
                  {m.warnings.length > 0 && (
                    <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-200">
                      {m.warnings.length} warning{m.warnings.length > 1 ? 's' : ''}
                    </span>
                  )}
                  {m.promoted_learning_id && <span className="ml-2 text-green-700">promoted</span>}
                  <span className="ml-2 text-gray-400">last written {m.updated_at.slice(0, 10)}</span>
                </summary>
                {m.description && <p className="mt-1 text-gray-500">{m.description}</p>}
                {m.warnings.map((w, i) => (
                  <p key={i} className="mt-1 text-amber-800">
                    ⚠ this row {w}
                  </p>
                ))}
                <pre className="mt-2 whitespace-pre-wrap text-gray-600 font-mono text-[11px]">{m.valuePreview}</pre>
                {m.valueChars > m.valuePreview.length && (
                  <p className="text-gray-400">…{m.valueChars - m.valuePreview.length} more characters</p>
                )}
                <PromoteForm memoryId={m.id} headers={headers} onDone={loadMemory} />
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * Creating a test. `target_key` is `<sequence_id>:<step_number>` — the live
 * email the control is copied from. Everything lands as a DRAFT.
 */
function CreateForm({
  onCreate,
  busy,
}: {
  onCreate: (body: Record<string, unknown>, key: string) => void
  busy: boolean
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [targetKey, setTargetKey] = useState('')
  const [metric, setMetric] = useState('clicked')
  const [minPerArm, setMinPerArm] = useState(30)
  const [hypothesis, setHypothesis] = useState('')

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 flex items-center gap-1"
      >
        <FlaskConical className="w-3 h-3" /> New content test
      </button>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2 text-xs">
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="What is this test called?"
        className="w-full border border-gray-200 rounded px-2 py-1"
      />
      <input
        value={targetKey}
        onChange={e => setTargetKey(e.target.value)}
        placeholder="Target — <sequence_id>:<step_number>, e.g. e451bfc5-…:1"
        className="w-full border border-gray-200 rounded px-2 py-1 font-mono"
      />
      <input
        value={hypothesis}
        onChange={e => setHypothesis(e.target.value)}
        placeholder="What do you want to try? (guides what COPY writes)"
        className="w-full border border-gray-200 rounded px-2 py-1"
      />
      <div className="flex gap-2 items-center">
        <label className="text-gray-500">Metric</label>
        <select value={metric} onChange={e => setMetric(e.target.value)} className="border border-gray-200 rounded px-1 py-1">
          <option value="clicked">clicked</option>
          <option value="converted">converted (a booking)</option>
          <option value="replied">replied</option>
        </select>
        <label className="text-gray-500 ml-2">Minimum per arm</label>
        <input
          type="number"
          min={2}
          value={minPerArm}
          onChange={e => setMinPerArm(Number(e.target.value))}
          className="w-20 border border-gray-200 rounded px-2 py-1"
        />
        <span className="text-gray-400">below this it will say &ldquo;not enough data&rdquo; rather than pick a winner</span>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() =>
            onCreate(
              {
                name,
                surface: 'sequence_step',
                targetKey: targetKey || null,
                metric,
                minPerArm,
                hypothesis: hypothesis || null,
              },
              'create'
            )
          }
          disabled={busy || name.trim().length < 4}
          className="px-3 py-1.5 rounded-lg bg-hampton-navy text-white disabled:opacity-40"
        >
          Create as a draft
        </button>
        <button onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-lg border border-gray-200">
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * Promoting deliberately asks the human for the RULE TEXT rather than deriving
 * it from the stored value. The values are arbitrary jsonb of eleven different
 * shapes, and turning one into a one-line standing instruction automatically
 * would be the pipeline guessing at an input it cannot interpret — which is the
 * one thing a module whose output becomes a prompt must never do.
 */
function PromoteForm({
  memoryId,
  headers,
  onDone,
}: {
  memoryId: string
  headers: Record<string, string>
  onDone: () => void
}) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState('fact')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch('/api/admin/memory', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'promote', memoryId, kind, text }),
      })
      const json = await res.json()
      setNote(res.ok ? json.note : json.error)
      if (res.ok) {
        setText('')
        onDone()
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 border-t border-gray-100 pt-2">
      <p className="text-gray-500 mb-1">Turn this into a rule for the booking agent (it arrives inactive):</p>
      <div className="flex gap-2">
        <select value={kind} onChange={e => setKind(e.target.value)} className="text-xs border border-gray-200 rounded px-1">
          <option value="fact">fact</option>
          <option value="rule">rule</option>
          <option value="style">style</option>
          <option value="pricing">pricing</option>
        </select>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Write the rule in one sentence"
          className="flex-1 text-xs border border-gray-200 rounded px-2 py-1"
        />
        <button
          onClick={submit}
          disabled={busy || text.trim().length < 8}
          className="text-xs px-3 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
        >
          Propose
        </button>
      </div>
      {note && <p className="mt-1 text-amber-800">{note}</p>}
    </div>
  )
}
