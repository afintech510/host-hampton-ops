'use client'

import { useEffect, useState } from 'react'
import { PARTY_TYPES, PARTY_TYPE_LABELS, PIPELINE_STAGES } from '@/lib/pipelineStages'

/**
 * The right rail (plan §11.6). The thread answers "what did we say"; this
 * answers "what are we selling".
 *
 * Fields here write through `PATCH /api/admin/lead/[ref]`, which holds a
 * whitelist. Money and pipeline STATUS are deliberately not on it: totals are
 * derived from the catalog and the line items, and the stage moves through
 * `advance()`. A panel that could set either would be a second writer of the
 * two things the ledger exists to explain, so this one shows them and does not
 * touch them.
 */

export interface PlanBooking {
  id: string
  booking_ref: string
  status: string | null
  party_type: string | null
  event_type: string | null
  package_type: string | null
  invoice_number: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  party_date: string | null
  party_time: string | null
  guest_count_approx: number | null
  child_name: string | null
  child_age: number | null
  notes: string | null
  admin_notes: string | null
  total_cents: number | null
  deposit_amount: number | null
  balance_due_cents: number | null
  source: string | null
}

export interface PlanLineItem {
  id: string
  name: string
  category: string
  quantity: number
  unit_price_cents: number
  guest_multiplied: boolean
}

export interface PlanEvaluation {
  path: 'quote' | 'info_gather'
  partyType: string
  needsHuman: boolean
  missing: string[]
  missingLabels: string[]
  /** False when the plan has neither an email nor a phone — nothing to send to. */
  reachable: boolean
}

interface Props {
  booking: PlanBooking | null
  lineItems: PlanLineItem[]
  evaluation: PlanEvaluation | null
  /** True when a draft is already open on this lead — the quote button defers to it. */
  openDraftCode: string | null
  headers: Record<string, string>
  refPath: string
  onSaved: (staleDraftIds: string[]) => void
  onDrafted: () => void
}

/** The pipeline header — the progression Adam likes, lit rather than inferred. */
export function PipelineHeader({ status }: { status: string | null }) {
  const idx = PIPELINE_STAGES.indexOf((status ?? '') as (typeof PIPELINE_STAGES)[number])
  return (
    <div className="flex flex-wrap items-center gap-1 text-[11px]">
      {PIPELINE_STAGES.map((stage, i) => (
        <span key={stage} className="flex items-center gap-1">
          <span
            className={`px-2 py-0.5 rounded-full ${
              i === idx
                ? 'bg-hampton-navy text-white font-semibold'
                : i < idx
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-gray-100 text-gray-400'
            }`}
          >
            {stage.replace(/_/g, ' ')}
          </span>
          {i < PIPELINE_STAGES.length - 1 && <span className="text-gray-300">›</span>}
        </span>
      ))}
      {/* `cancelled` is an exit from the pipeline, not a stage in it. */}
      {status === 'cancelled' && (
        <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">cancelled</span>
      )}
      {idx === -1 && status && status !== 'cancelled' && (
        <span className="px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">{status}</span>
      )}
    </div>
  )
}

const TEXT_FIELDS: Array<[keyof PlanBooking, string, 'text' | 'date' | 'time' | 'number' | 'area']> = [
  ['contact_name', 'Name', 'text'],
  ['contact_email', 'Email', 'text'],
  ['contact_phone', 'Phone', 'text'],
  ['party_date', 'Date', 'date'],
  ['party_time', 'Start time', 'time'],
  ['guest_count_approx', 'Guests', 'number'],
  ['child_name', 'Child', 'text'],
  ['child_age', 'Turning', 'number'],
  ['event_type', 'Event type', 'text'],
  ['package_type', 'Package', 'text'],
  ['notes', 'Notes', 'area'],
  ['admin_notes', 'Admin notes', 'area'],
]

export default function PlanPanel({
  booking,
  lineItems,
  evaluation,
  openDraftCode,
  headers,
  refPath,
  onSaved,
  onDrafted,
}: Props) {
  const [draftFields, setDraftFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [quoteBusy, setQuoteBusy] = useState(false)
  const [quoteMsg, setQuoteMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    setDraftFields({})
    setMsg(null)
    setQuoteMsg(null)
  }, [booking?.id])

  if (!booking) {
    return (
      <aside className="bg-white rounded-2xl border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-hampton-navy mb-1">The plan</h2>
        <p className="text-sm text-gray-500">
          No party plan row for this lead yet. One is created when the lead is drafted through the agent, and the
          planner and invoice links appear here once it exists.
        </p>
      </aside>
    )
  }

  const value = (k: keyof PlanBooking) =>
    draftFields[k as string] ?? (booking[k] == null ? '' : String(booking[k]))
  const dirty = Object.keys(draftFields).length > 0

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(refPath, { method: 'PATCH', headers, body: JSON.stringify({ fields: draftFields }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMsg(data?.error || 'Save failed')
        return
      }
      setDraftFields({})
      const stale: string[] = data.staleDraftIds ?? []
      // A change that invalidates a live draft says so here as well as in the
      // thread — silence is what success looks like, so it cannot be the way a
      // stale quote is announced.
      setMsg(
        stale.length
          ? `Saved. ${stale.length} open draft${stale.length === 1 ? '' : 's'} now describe a plan that has changed — re-draft before sending.`
          : 'Saved.',
      )
      onSaved(stale)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  /**
   * "Send quote" (plan §11.6) — a priced quote still goes through review.
   *
   * It calls the EXISTING `draft_with_agent` action rather than a new endpoint.
   * That action already carries the three layers that stop a double-click
   * becoming two texts to a customer (a live-draft precheck, the same
   * compare-and-swap claim the cron uses, and the DB's partial unique indexes),
   * and duplicating it here would mean maintaining those three layers twice —
   * which is how one copy ends up being the one nobody remembered to guard.
   *
   * The button therefore drafts; it does not send. Whether the result is a
   * QUOTE or an info-gather reply is the gate's call, not the button's, which
   * is why the label says which one is about to happen.
   */
  async function draftQuote() {
    if (!booking) return
    const willQuote = evaluation?.path === 'quote'
    const ok = window.confirm(
      willQuote
        ? `Draft a priced quote for ${booking.contact_name || booking.booking_ref}?\n\nIt goes to review first — nothing reaches the customer until you approve it.`
        : `This plan is still missing ${(evaluation?.missingLabels ?? []).join(', ') || 'some details'}, so the agent will ask for those rather than price it.\n\nDraft that reply?`,
    )
    if (!ok) return

    setQuoteBusy(true)
    setQuoteMsg(null)
    try {
      const res = await fetch(`/api/admin/parties/${encodeURIComponent(booking.id)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'draft_with_agent',
          note: willQuote ? 'Send the priced quote for this plan.' : null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setQuoteMsg({ tone: 'error', text: data?.error || 'Could not draft' })
        return
      }
      setQuoteMsg({
        tone: 'ok',
        text: `${data.reviewCode} drafted as a ${data.draftStatus === 'drafted' ? 'held' : ''} ${
          willQuote ? 'quote' : 'reply'
        } — it is in the thread above. Nothing has gone to the customer.`.replace(/\s+/g, ' '),
      })
      onDrafted()
    } catch (err) {
      setQuoteMsg({ tone: 'error', text: err instanceof Error ? err.message : 'Could not draft' })
    } finally {
      setQuoteBusy(false)
    }
  }

  const itemsTotal = lineItems.reduce(
    (sum, li) => sum + li.unit_price_cents * (li.quantity || 1) * (li.guest_multiplied ? booking.guest_count_approx || 1 : 1),
    0,
  )

  return (
    <aside className="bg-white rounded-2xl border border-gray-200 p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-hampton-navy">The plan</h2>
        <p className="text-[11px] text-gray-400 font-mono">{booking.booking_ref}</p>
      </div>

      <label className="block">
        <span className="text-[11px] text-gray-400">Product</span>
        <select
          value={value('party_type')}
          onChange={e => setDraftFields(f => ({ ...f, party_type: e.target.value }))}
          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
        >
          <option value="">—</option>
          {PARTY_TYPES.map(t => (
            <option key={t} value={t}>
              {PARTY_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>

      {TEXT_FIELDS.map(([key, label, type]) => (
        <label key={key as string} className="block">
          <span className="text-[11px] text-gray-400">{label}</span>
          {type === 'area' ? (
            <textarea
              rows={2}
              value={value(key)}
              onChange={e => setDraftFields(f => ({ ...f, [key]: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
            />
          ) : (
            <input
              type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
              value={value(key)}
              onChange={e => setDraftFields(f => ({ ...f, [key]: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
            />
          )}
        </label>
      ))}

      <button
        disabled={!dirty || busy}
        onClick={save}
        className="w-full px-3 py-2 rounded-lg bg-hampton-navy text-white text-sm disabled:opacity-40"
      >
        {busy ? 'Saving…' : dirty ? 'Save plan' : 'No changes'}
      </button>
      {msg && <p className="text-[12px] text-gray-600">{msg}</p>}

      <div className="border-t border-gray-100 pt-3">
        <div className="text-[11px] text-gray-400 mb-1">Line items</div>
        {lineItems.length === 0 && <p className="text-sm text-gray-400">None yet — build them in the planner.</p>}
        {lineItems.map(li => (
          <div key={li.id} className="flex justify-between text-sm py-0.5">
            <span className="text-gray-700">
              {li.name}
              {li.quantity > 1 ? ` ×${li.quantity}` : ''}
              {li.guest_multiplied ? ' /guest' : ''}
            </span>
            <span className="text-gray-500">${(li.unit_price_cents / 100).toFixed(2)}</span>
          </div>
        ))}
        {lineItems.length > 0 && (
          <div className="flex justify-between text-sm font-semibold pt-1 border-t border-gray-100 mt-1">
            <span>Items total</span>
            <span>${(itemsTotal / 100).toFixed(2)}</span>
          </div>
        )}
        {/* Shown, never edited here — see the header. */}
        <div className="text-[11px] text-gray-400 mt-2">
          Saved totals: ${((booking.total_cents ?? 0) / 100).toFixed(2)} · deposit $
          {Number(booking.deposit_amount ?? 0).toFixed(2)}
          {booking.invoice_number ? ` · invoice ${booking.invoice_number}` : ''}
        </div>
      </div>

      {/* ── Quote readiness + Send quote (plan §11.6) ── */}
      {evaluation && (
        <div className="border-t border-gray-100 pt-3 space-y-2">
          {!evaluation.reachable ? (
            <p className="text-[12px] bg-red-50 border border-red-200 text-red-700 rounded-lg px-2.5 py-2">
              No email or phone on this plan — add one above before drafting anything.
            </p>
          ) : evaluation.path === 'quote' ? (
            <p className="text-[12px] bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-2.5 py-2">
              Ready to quote — everything the gate needs is here.
            </p>
          ) : (
            <p className="text-[12px] bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-2.5 py-2">
              {evaluation.needsHuman
                ? 'The party type is unclear, so this will not be auto-quoted — set the product above.'
                : `Still missing: ${evaluation.missingLabels.join(' · ')}. A draft now would ask for those, not price it.`}
            </p>
          )}

          {openDraftCode ? (
            // Deferring to the open draft rather than offering a button that
            // would only 409 — the refusal is more useful before the click.
            <p className="text-[12px] text-gray-500">
              {openDraftCode} is already open on this lead. Work that one in the thread, or dismiss it first.
            </p>
          ) : (
            <button
              disabled={quoteBusy || !evaluation.reachable || dirty}
              onClick={draftQuote}
              title={dirty ? 'Save the plan first — otherwise the draft quotes the old details' : undefined}
              className="w-full px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40"
            >
              {quoteBusy
                ? 'Drafting…'
                : dirty
                  ? 'Save the plan first'
                  : evaluation.path === 'quote'
                    ? 'Send quote →'
                    : 'Draft a reply asking for the rest →'}
            </button>
          )}
          {quoteMsg && (
            <p
              className={`text-[12px] rounded-lg px-2.5 py-2 ${
                quoteMsg.tone === 'ok'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}
            >
              {quoteMsg.text}
            </p>
          )}
          <p className="text-[10px] text-gray-400">
            Drafting only reaches review. Nothing reaches the customer until you approve it in the thread.
          </p>
        </div>
      )}

      <div className="border-t border-gray-100 pt-3 flex flex-col gap-2">
        <a
          href={`/party-planner?ref=${encodeURIComponent(booking.booking_ref)}`}
          className="text-sm text-hampton-navy underline"
        >
          Open planner →
        </a>
        <a href={`/plan/${encodeURIComponent(booking.booking_ref)}/summary`} className="text-sm text-hampton-navy underline">
          Open quote / invoice →
        </a>
      </div>
    </aside>
  )
}
