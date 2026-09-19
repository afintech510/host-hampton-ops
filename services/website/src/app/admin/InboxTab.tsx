'use client'

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import {
  RefreshCw, CheckCircle2, XCircle, Pencil, Inbox, MessageSquare, Mail, Sparkles, AlertTriangle, X, Send, Clock,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { byLongestWaiting, waitingInfo } from '@/lib/leadWaiting'
import LearningsPanel from './LearningsPanel'
import ExperimentsPanel from './ExperimentsPanel'

/**
 * How long this draft has been sitting on a human, said in words.
 *
 * An absolute timestamp is not something anybody triages on — a column of them
 * all looks the same, and the four-day-old one is indistinguishable from this
 * morning's. Plan §18's lead was visible in this list the entire time it was
 * being missed.
 */
function WaitingBadge({ draft }: { draft: { sent_for_review_at: string | null; created_at: string } }) {
  const info = waitingInfo(draft)
  // No readable clock: show nothing. "Waiting just now" would be a claim.
  if (!info) return null
  const tone =
    info.severity === 'overdue'
      ? 'bg-red-100 text-red-800 font-semibold'
      : info.severity === 'waiting'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-gray-100 text-gray-500'
  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${tone}`}
      title={`Waiting since ${new Date(draft.sent_for_review_at || draft.created_at).toLocaleString()}`}
    >
      <Clock className="w-3 h-3" />
      {info.severity === 'overdue' ? `waiting ${info.label}` : info.label}
    </span>
  )
}

/* ── Types ─────────────────────────────────────────────── */

interface EventRow {
  id: string
  source: string
  external_id: string
  direction: string
  from_address: string | null
  subject: string | null
  body: string | null
  parsed: Record<string, unknown> | null
  status: string
  classification: string | null
  draft_id: string | null
  error: string | null
  created_at: string
}

/**
 * What is known about the party behind a draft, assembled server-side from the
 * plan row, the contact row and the original inbound message.
 */
interface DraftDetails {
  /** Sources that could not be READ. Never confuse these with "no value". */
  unavailable: string[]
  name: string | null
  email: string | null
  phone: string | null
  party_date: string | null
  party_time: string | null
  guest_count: number | null
  child_name: string | null
  child_age: number | null
  event_type: string | null
  package_type: string | null
  notes: string | null
  admin_notes: string | null
  source: string | null
  total_cents: number | null
  deposit_amount: number | null
  balance_due_cents: number | null
  /** Theme, location address, requested-date text — whatever intake kept. */
  tags: Record<string, unknown> | null
  /** The "customer" on this draft is one of our own addresses. */
  self_addressed?: boolean
  inquiry: {
    source: string | null
    from: string | null
    subject: string | null
    body: string | null
    truncated: boolean
    parsed: Record<string, unknown> | null
    received_at: string | null
  } | null
}

interface DraftRow {
  id: string
  review_code: string
  status: string
  party_type: string
  contact_path: string
  missing_fields: string[] | null
  subject: string | null
  email_draft: string | null
  sms_draft: string | null
  error: string | null
  booking_id: string | null
  sent_for_review_at: string | null
  created_at: string
  /** From the plan, when there is one — so the queue names people, not codes. */
  booking_ref: string | null
  contact_name: string | null
  /** The plan's pipeline status. 'cancelled' makes this draft a hazard. */
  booking_status: string | null
  /** Absent on an older payload — the panel renders nothing rather than blanks. */
  details?: DraftDetails | null
}

interface LedgerRow {
  id: string
  action: string
  actor: string
  from_status: string | null
  to_status: string | null
  cost_usd: number | null
  created_at: string
}

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800',
  claimed: 'bg-indigo-100 text-indigo-800',
  handled: 'bg-green-100 text-green-800',
  ignored: 'bg-gray-200 text-gray-500',
  error: 'bg-red-100 text-red-700',
  drafted: 'bg-gray-100 text-gray-700',
  sent_for_review: 'bg-amber-100 text-amber-800',
  revision_requested: 'bg-orange-100 text-orange-800',
  approved: 'bg-blue-100 text-blue-800',
  sent: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-200 text-gray-500',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  )
}

/**
 * A `date` column is a calendar day, not an instant. `new Date('2026-09-30')`
 * parses as midnight UTC, which in Eastern time is the EVENING OF THE 29th — so
 * the obvious formatting renders every party one day early. Build the date from
 * its own parts, and if it is not the plain Y-M-D we expect, show it verbatim.
 */
function formatPartyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

/** '14:30:00' → '2:30 PM'. Anything unexpected is shown as stored. */
function formatPartyTime(raw: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(raw)
  if (!m) return raw
  const h = Number(m[1])
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m[2]} ${suffix}`
}

/**
 * A second, admin-only spelling of `lib/planInvoice.ts`'s `money` — deliberately
 * NOT imported from there, because this is a client component and that module
 * reaches for `getSupabase` and the pricing catalog, which would drag server
 * code into the browser bundle. It carries the same sign rule ("-$250.00", not
 * "$-250.00"); it keeps its own thousands handling.
 */
function money(cents: number): string {
  return `${cents < 0 ? '-' : ''}$${Math.abs(cents / 100).toFixed(2)}`
}

/** One label/value pair. A field nobody told us is said so, not left blank. */
function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="text-xs text-gray-800 break-words">
        {value === null || value === undefined || value === '' ? (
          <span className="text-amber-600">not provided</span>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

/**
 * Everything known about the party a draft is answering.
 *
 * The reviewer's actual job on this screen is to decide whether the draft is
 * right, and that is not answerable from the draft alone — "does it have the
 * date?" needs the date. Until this panel existed the only way to see it was to
 * open the lead page for every row, which is why drafts got approved on the
 * strength of the prose reading well.
 */
function DraftDetailsPanel({ details }: { details: DraftDetails }) {
  const [showInquiry, setShowInquiry] = useState(false)
  const tags = details.tags ? Object.entries(details.tags).filter(([, v]) => v !== null && v !== '') : []
  const hasMoney =
    details.total_cents != null || details.deposit_amount != null || details.balance_due_cents != null

  return (
    <div className="rounded-lg border border-gray-200 bg-white/60 p-3 space-y-3">
      {details.unavailable.length > 0 && (
        // NOT "not provided". We failed to read it — saying the field is empty
        // would invite a reviewer to re-ask a customer for what we already have.
        <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
          Could not read the {details.unavailable.join(' and ')} for this draft just now — the fields below are
          incomplete for that reason, not because the customer left them out. Hit Refresh.
        </p>
      )}

      {details.self_addressed && (
        // This draft is a reply to ourselves. It reads exactly like a real lead
        // in the queue above — same badges, same waiting clock — and the only
        // tell is the address, which until now was not on this screen at all.
        <p className="text-xs bg-red-50 border border-red-300 text-red-800 rounded-lg px-3 py-2 font-semibold">
          ⚠ The contact on this draft is one of OUR OWN addresses. This is almost certainly our own outgoing
          mail that came back in as an inquiry — there is no customer at the other end. Dismiss it.
        </p>
      )}

      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
        <Field label="Name" value={details.name} />
        <Field
          label="Email"
          value={details.email ? <a className="underline decoration-dotted" href={`mailto:${details.email}`}>{details.email}</a> : null}
        />
        <Field
          label="Phone"
          value={details.phone ? <a className="underline decoration-dotted" href={`tel:${details.phone}`}>{details.phone}</a> : null}
        />
        <Field label="Date" value={details.party_date ? formatPartyDate(details.party_date) : null} />
        <Field label="Start time" value={details.party_time ? formatPartyTime(details.party_time) : null} />
        <Field label="Guests" value={details.guest_count} />
        <Field label="Child" value={details.child_name} />
        <Field label="Turning" value={details.child_age} />
        <Field label="Event type" value={details.event_type} />
        <Field label="Package / theme" value={details.package_type} />
        {details.source && <Field label="Came from" value={details.source} />}
      </dl>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map(([k, v]) => (
            <span key={k} className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
              <span className="text-gray-400">{k.replace(/_/g, ' ')}:</span>{' '}
              {typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v)}
            </span>
          ))}
        </div>
      )}

      {hasMoney && (
        <p className="text-xs text-gray-600">
          {details.total_cents != null && <>Total {money(details.total_cents)} · </>}
          {details.deposit_amount != null && <>Deposit ${Number(details.deposit_amount).toFixed(2)} · </>}
          {details.balance_due_cents != null && <>Balance {money(details.balance_due_cents)}</>}
        </p>
      )}

      {details.notes && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Notes</p>
          <p className="text-xs text-gray-700 whitespace-pre-wrap">{details.notes}</p>
        </div>
      )}
      {details.admin_notes && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Admin notes</p>
          <p className="text-xs text-gray-700 whitespace-pre-wrap">{details.admin_notes}</p>
        </div>
      )}

      {details.inquiry && (
        <div className="border-t border-gray-100 pt-2">
          <button
            onClick={() => setShowInquiry(v => !v)}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-hampton-navy hover:underline"
          >
            {showInquiry ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            What they actually wrote
            {details.inquiry.received_at && (
              <span className="font-normal text-gray-400">
                · {details.inquiry.source || 'message'} · {new Date(details.inquiry.received_at).toLocaleString()}
              </span>
            )}
          </button>
          {showInquiry && (
            <div className="mt-2 bg-gray-50 rounded-lg p-3 space-y-2">
              {details.inquiry.from && (
                <p className="text-[11px] text-gray-500">From {details.inquiry.from}</p>
              )}
              {details.inquiry.subject && (
                <p className="text-xs font-semibold text-hampton-navy">{details.inquiry.subject}</p>
              )}
              {/* Customer-authored text, rendered as text. */}
              <pre className="whitespace-pre-wrap font-sans text-xs text-gray-700 leading-relaxed">
                {details.inquiry.body || '(no message body)'}
              </pre>
              {details.inquiry.truncated && (
                <p className="text-[11px] text-gray-400">
                  Trimmed here — open the lead thread for the whole message.
                </p>
              )}
              {details.inquiry.parsed && Object.keys(details.inquiry.parsed).length > 0 && (
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 border-t border-gray-200 pt-2">
                  {Object.entries(details.inquiry.parsed).map(([k, v]) => (
                    <Field
                      key={k}
                      label={k.replace(/_/g, ' ')}
                      value={
                        typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
                          ? String(v)
                          : v == null
                            ? null
                            : JSON.stringify(v)
                      }
                    />
                  ))}
                </dl>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function leadLabel(e: EventRow): string {
  const p = e.parsed || {}
  const name = (p.name as string) || (p.contactName as string) || e.from_address || 'unknown'
  const route = (p.route as string) || e.source
  return `${name} · ${route}`
}

/* ── Component ─────────────────────────────────────────── */

export default function InboxTab({
  headers,
  onLogout,
  focusReviewCode,
  onFocusHandled,
}: {
  headers: Record<string, string>
  onLogout: () => void
  /** A review code to scroll to and highlight, set by another tab linking here. */
  focusReviewCode?: string | null
  onFocusHandled?: () => void
}) {
  const [events, setEvents] = useState<EventRow[]>([])
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [enabled, setEnabled] = useState(false)
  const [model, setModel] = useState('')
  const [reviewerPhoneCount, setReviewerPhoneCount] = useState(0)
  const [loadErrors, setLoadErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<DraftRow | null>(null)
  const [editEmail, setEditEmail] = useState('')
  const [editSms, setEditSms] = useState('')

  const fetchSnapshot = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/agent', { headers })
      if (res.status === 401) { onLogout(); return }
      const data = await res.json()
      setEvents(data.events || [])
      setDrafts(data.drafts || [])
      setLedger(data.ledger || [])
      setEnabled(!!data.enabled)
      setModel(data.model || '')
      setReviewerPhoneCount(data.reviewerPhoneCount || 0)
      setLoadErrors(data.errors || [])
    } catch (err) {
      console.error('Failed to fetch agent snapshot:', err)
    } finally {
      setLoading(false)
    }
  }, [headers, onLogout])

  useEffect(() => { fetchSnapshot() }, [fetchSnapshot])

  async function act(id: string, action: string, extra: Record<string, unknown> = {}) {
    setBusyId(id); setError(null); setNotice(null)
    try {
      const res = await fetch('/api/admin/agent', {
        method: 'POST',
        headers,
        body: JSON.stringify({ id, action, ...extra }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Action failed'); return false }
      const channels = [data.emailSent ? 'email' : null, data.smsSent ? 'text' : null].filter(Boolean).join(' + ')
      setNotice(
        action === 'approve'
          ? 'Approved. Nothing was sent yet — use "Send to customer".'
          : action === 'draft'
            ? `Drafted ${data.reviewCode || ''} — review it below.`
            : action === 'send'
              ? `Sent to ${data.recipient?.email || data.recipient?.phone || 'the customer'} (${channels || 'nothing went out'}).`
              : action === 'test'
                ? `Test copy sent to you (${channels || 'nothing went out'}). The customer still has nothing.`
                : 'Done.',
      )
      if (Array.isArray(data.errors) && data.errors.length) setError(data.errors.join('; '))
      await fetchSnapshot()
      return true
    } finally {
      setBusyId(null)
    }
  }

  function openEdit(d: DraftRow) {
    setEditing(d)
    setEditEmail(d.email_draft || '')
    setEditSms(d.sms_draft || '')
  }

  async function saveEdit() {
    if (!editing) return
    const ok = await act(editing.id, 'edit', { emailDraft: editEmail, smsDraft: editSms })
    if (ok) setEditing(null)
  }

  // Longest-waiting first. The queue's job is to surface the neglected one, and
  // newest-first buries it — which is how the lead in plan §18 sat in this list
  // for days while looking exactly like every other row.
  const openDrafts = drafts
    .filter(d => !['sent', 'cancelled'].includes(d.status))
    .slice()
    .sort((a, b) => byLongestWaiting(a, b))

  /**
   * Scroll the linked-to draft into view once the drafts have actually loaded —
   * the element does not exist on the render where `focusReviewCode` arrives.
   * `onFocusHandled` clears it so a later visit to this tab does not re-scroll.
   */
  const focusRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!focusReviewCode || loading) return
    focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const t = setTimeout(() => onFocusHandled?.(), 4000)
    return () => clearTimeout(t)
  }, [focusReviewCode, loading, onFocusHandled])
  const closedDrafts = drafts.filter(d => ['sent', 'cancelled'].includes(d.status))

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-500">
          Agent drafts land here for review.{' '}
          <span className="text-gray-400">Nothing reaches a customer without approval.</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${enabled ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-500'}`}>
            {enabled ? 'AGENT ON' : 'AGENT OFF'}
          </span>
          {model && <span className="text-[11px] text-gray-400">{model}</span>}
          <span className="text-[11px] text-gray-400">{reviewerPhoneCount} reviewer phone{reviewerPhoneCount === 1 ? '' : 's'}</span>
          <button onClick={fetchSnapshot} className="p-2 text-gray-500 hover:text-hampton-navy hover:bg-gray-100 rounded-lg transition-all">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loadErrors.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 inline mr-1.5 -mt-0.5" />
          {loadErrors.join(' · ')} — a table that is missing entirely usually means a migration has not been
          applied; a one-off timeout usually clears on Refresh.
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}
      {notice && <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-4 py-3">{notice}</div>}

      {/* ── Open drafts ── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-hampton-navy mb-3">
          <Sparkles className="w-4 h-4" /> Drafts awaiting review ({openDrafts.length})
        </h3>
        <div className="space-y-2">
          {openDrafts.length === 0 && <p className="text-sm text-gray-400">No drafts waiting.</p>}
          {openDrafts.map(d => {
            const isFocused = !!focusReviewCode && d.review_code === focusReviewCode
            return (
            <div
              key={d.id}
              ref={isFocused ? focusRef : undefined}
              className={`bg-white rounded-xl border p-4 space-y-3 transition-colors ${
                isFocused ? 'border-hampton-blue ring-2 ring-hampton-blue/40' : 'border-gray-200'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                {/* The review code resolves in the lead workspace too, so this
                    is the way into the full thread from the Inbox. */}
                <a
                  href={`/admin/lead/${encodeURIComponent(d.review_code)}`}
                  className="font-mono text-xs font-semibold text-hampton-navy underline decoration-dotted"
                  title="Open the lead thread"
                >
                  {d.review_code}
                </a>
                {/* Whose party this is. A queue of codes cannot be triaged. */}
                {d.contact_name && (
                  <span className="text-xs font-semibold text-hampton-navy">{d.contact_name}</span>
                )}
                <StatusBadge status={d.status} />
                <WaitingBadge draft={d} />
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                  {d.party_type.replace(/_/g, ' ')}
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                  {d.contact_path === 'quote' ? 'quote' : 'info gather'}
                </span>
                <span className="ml-auto text-xs text-gray-400">{new Date(d.created_at).toLocaleString()}</span>
              </div>

              {d.error && (
                <p className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
                  Held back: {d.error}
                </p>
              )}
              {d.booking_status === 'cancelled' && (
                // Loud, because the mistake it prevents is unrecoverable: this
                // draft would quote a customer for a party that was called off.
                <p className="text-xs bg-red-50 border border-red-300 text-red-800 rounded-lg px-3 py-2 font-semibold">
                  ⚠ The plan behind this draft ({d.booking_ref}) is CANCELLED. Sending this would quote a party
                  that was called off — usually it means the plan was a duplicate and this draft was left behind.
                  Dismiss it unless you know otherwise.
                </p>
              )}
              {d.missing_fields && d.missing_fields.length > 0 && (
                <p className="text-xs text-amber-700">Missing: {d.missing_fields.join(', ')}</p>
              )}

              {/* The inquiry this draft is answering — a draft cannot be judged
                  right or wrong without the party details in front of you. */}
              {d.details && <DraftDetailsPanel details={d.details} />}

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    <Mail className="w-3 h-3" /> {d.subject || 'no subject'}
                  </p>
                  <pre className="whitespace-pre-wrap font-sans text-xs text-gray-700 leading-relaxed">{d.email_draft}</pre>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    <MessageSquare className="w-3 h-3" /> SMS · {(d.sms_draft || '').length} chars
                  </p>
                  <pre className="whitespace-pre-wrap font-sans text-xs text-gray-700 leading-relaxed">{d.sms_draft}</pre>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  disabled={busyId === d.id}
                  onClick={() => act(d.id, 'approve')}
                  className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-hampton-navy hover:bg-gray-100 transition-all disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                </button>
                <button
                  disabled={busyId === d.id}
                  onClick={() => openEdit(d)}
                  className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-hampton-navy hover:bg-gray-100 transition-all disabled:opacity-50"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
                <button
                  disabled={busyId === d.id}
                  onClick={() => act(d.id, 'test')}
                  title="Send this to the owner's own email and phone, exactly as the customer would see it"
                  className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-hampton-navy hover:bg-gray-100 transition-all disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" /> Test to me
                </button>
                <button
                  disabled={busyId === d.id}
                  onClick={() => act(d.id, 'dismiss')}
                  className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-all disabled:opacity-50"
                >
                  <XCircle className="w-3.5 h-3.5" /> Dismiss
                </button>
                {d.status === 'approved' ? (
                  <button
                    disabled={busyId === d.id}
                    onClick={() => {
                      if (confirm(`Send ${d.review_code} to the customer now? This cannot be undone.`)) {
                        act(d.id, 'send')
                      }
                    }}
                    className="ml-auto flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-hampton-navy text-white hover:opacity-90 transition-all disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" /> Send to customer
                  </button>
                ) : (
                  <span className="ml-auto text-[11px] text-gray-400">Approve first — sending is a separate step.</span>
                )}
              </div>
            </div>
            )
          })}
        </div>
      </section>

      {/* ── Edit modal ── */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4 sm:p-8" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl mt-4 mb-8 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <span className="text-sm font-semibold text-hampton-navy">Edit {editing.review_code}</span>
              <button onClick={() => setEditing(null)} className="p-1.5 text-gray-400 hover:text-hampton-navy hover:bg-gray-100 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</label>
                <textarea
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  rows={10}
                  className="mt-1 w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-blue/40"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  SMS · {editSms.length} chars
                </label>
                <textarea
                  value={editSms}
                  onChange={e => setEditSms(e.target.value)}
                  rows={5}
                  className="mt-1 w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-hampton-blue/40"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setEditing(null)} className="text-xs font-medium px-4 py-2 rounded-lg text-gray-500 hover:bg-gray-100">
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  disabled={busyId === editing.id}
                  className="text-xs font-semibold px-4 py-2 rounded-lg bg-hampton-navy text-white hover:opacity-90 disabled:opacity-50"
                >
                  Save draft
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Inbound events ── */}
      <section>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-hampton-navy mb-3">
          <Inbox className="w-4 h-4" /> Inbound events ({events.length})
        </h3>
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {events.length === 0 && <p className="text-sm text-gray-400 p-4">Nothing has come in yet.</p>}
          {events.map(e => (
            <div key={e.id} className="px-4 py-3 flex flex-wrap items-center gap-2 text-xs">
              <StatusBadge status={e.status} />
              <span className="font-medium text-hampton-navy">{leadLabel(e)}</span>
              {e.subject && <span className="text-gray-500 truncate max-w-xs">{e.subject}</span>}
              {e.error && <span className="text-red-600 truncate max-w-xs">{e.error}</span>}
              <span className="ml-auto text-gray-400">{new Date(e.created_at).toLocaleString()}</span>
              {e.status !== 'handled' && !e.draft_id && (
                <button
                  disabled={busyId === e.id}
                  onClick={() => act(e.id, 'draft')}
                  className="flex items-center gap-1 font-medium px-2.5 py-1 rounded-lg text-hampton-navy hover:bg-gray-100 disabled:opacity-50"
                >
                  <Sparkles className="w-3 h-3" /> Draft
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Closed drafts ── */}
      {closedDrafts.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-hampton-navy mb-3">Closed drafts ({closedDrafts.length})</h3>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {closedDrafts.map(d => (
              <div key={d.id} className="px-4 py-2 flex items-center gap-3 text-xs">
                <span className="font-mono text-hampton-navy">{d.review_code}</span>
                <StatusBadge status={d.status} />
                <span className="text-gray-500">{d.party_type.replace(/_/g, ' ')}</span>
                <span className="ml-auto text-gray-400">{new Date(d.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── What the agent has learned (Phase 6) ── */}
      <LearningsPanel headers={headers} onLogout={onLogout} />

      {/* ── A/B content tests + the retired memory store (Phase 5) ── */}
      <ExperimentsPanel headers={headers} onLogout={onLogout} />

      {/* ── Agent activity ── */}
      <section>
        <h3 className="text-sm font-semibold text-hampton-navy mb-3">Agent activity</h3>
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {ledger.length === 0 && <p className="text-sm text-gray-400 p-4">No agent activity yet.</p>}
          {ledger.map(l => (
            <div key={l.id} className="px-4 py-2 flex items-center gap-3 text-xs">
              <span className="text-gray-400 w-32 shrink-0">{new Date(l.created_at).toLocaleString()}</span>
              <span className="font-medium text-hampton-navy">{l.action}</span>
              {l.from_status && <span className="text-gray-400">{l.from_status} → {l.to_status}</span>}
              {l.cost_usd != null && <span className="text-gray-400">${Number(l.cost_usd).toFixed(4)}</span>}
              <span className="ml-auto text-gray-400">{l.actor}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
