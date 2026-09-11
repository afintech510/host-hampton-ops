'use client'

import { useMemo, useState } from 'react'
import type { TimelineItem } from '@/lib/agent/threadTimeline'
import { TONE_PRESETS } from '@/lib/agent/tonePresets'
import { smsSegmentInfo } from '@/lib/smsSegments'

/**
 * The lead thread: timeline, chat composer, inline editor, Approve & send.
 * Plan §11.2–§11.5.
 *
 * Every mutation here posts to `/api/admin/agent`, which is where the existing
 * actions already live and where `approved`/`sent` go through `advance()`. This
 * component owns no transition logic of its own — it is a surface on top of the
 * one guarded path, not a second one.
 *
 * The state this file works hardest to make unmistakable is "nothing has gone
 * to the customer yet". That is true of a draft, of a revision, of an edit and
 * of a test send, and it stays true until someone presses one button and
 * confirms a named recipient. A UI that leaves that ambiguous is a UI that gets
 * someone to press the button to find out.
 */

export interface LeadDraft {
  id: string
  review_code: string | null
  status: string
  party_type: string | null
  contact_path: string | null
  draft_kind: string | null
  channel: string | null
  subject: string | null
  email_draft: string | null
  sms_draft: string | null
  error: string | null
  reviewer_note: string | null
  approved_at: string | null
  approved_by: string | null
  sent_at: string | null
  created_at: string
  updated_at: string | null
}

interface Props {
  timeline: TimelineItem[]
  drafts: LeadDraft[]
  activeDraftId: string | null
  /** Recipient shown in the confirm dialog. Named, never "the customer". */
  recipient: { name: string | null; email: string | null; phone: string | null }
  headers: Record<string, string>
  onChanged: () => void
  /** Draft ids the plan panel has marked stale this session. */
  staleDraftIds: string[]
}

/* ── Small presentational helpers ───────────────────────────────────────── */

function when(at: string): string {
  const d = new Date(at)
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : at
}

function Rule({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'green' | 'amber' }) {
  const colour =
    tone === 'green' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-gray-400'
  return (
    <div className="flex items-center gap-3 my-1">
      <div className="h-px flex-1 bg-gray-200" />
      <span className={`text-[11px] ${colour} whitespace-nowrap`}>{children}</span>
      <div className="h-px flex-1 bg-gray-200" />
    </div>
  )
}

function Bubble({
  side,
  header,
  children,
}: {
  side: 'inbound' | 'outbound'
  header: React.ReactNode
  children: React.ReactNode
}) {
  const inbound = side === 'inbound'
  return (
    <div className={`flex ${inbound ? 'justify-start' : 'justify-end'} my-2`}>
      <div
        className={`max-w-[85%] rounded-2xl border px-4 py-3 ${
          inbound ? 'bg-white border-gray-200' : 'bg-hampton-navy/5 border-hampton-navy/20'
        }`}
      >
        <div className="text-[11px] text-gray-400 mb-1">{header}</div>
        <div className="whitespace-pre-wrap text-sm text-gray-800 leading-relaxed break-words">{children}</div>
      </div>
    </div>
  )
}

/** A one-line summary of a ledger row — the thin rules between messages. */
function ledgerLine(item: Extract<TimelineItem, { kind: 'ledger' }>): { text: string; tone: 'gray' | 'green' | 'amber' } | null {
  const who = item.actor === 'ADMIN' ? 'an admin (shared login)' : item.actor?.replace(/^admin:/, '') || 'system'
  const job = (item.meta?.job as string) || ''
  if (item.action === 'transition' && item.toStatus) {
    const tone = item.toStatus === 'sent' ? 'green' : item.toStatus === 'cancelled' ? 'amber' : 'gray'
    return { text: `${item.fromStatus ?? '—'} → ${item.toStatus} · ${who}`, tone }
  }
  if (item.action === 'spend') {
    return { text: `model call · $${(item.costUsd ?? 0).toFixed(4)} · ${item.tokens ?? 0} tokens`, tone: 'gray' }
  }
  if (job === 'plan_edit') {
    const fields = Object.keys((item.meta?.fields as Record<string, unknown>) ?? {})
    return { text: `plan edited (${fields.join(', ') || 'no change'}) · ${who}`, tone: 'amber' }
  }
  if (job === 'plan_changed') return { text: 'the plan changed after this draft was written', tone: 'amber' }
  if (item.action === 'note') return { text: `${job || 'note'} · ${who}`, tone: 'gray' }
  return { text: `${item.action} · ${who}`, tone: 'gray' }
}

/* ── The SMS segment ruler ──────────────────────────────────────────────── */

/**
 * The 160/320 marks plan §11.4 asks for, drawn from the carrier's arithmetic
 * rather than `length / 160` — see lib/smsSegments.ts for why a single curly
 * apostrophe changes the answer.
 */
function SegmentRuler({ text }: { text: string }) {
  const info = smsSegmentInfo(text)
  const over = info.segments > 1
  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex items-baseline gap-2 text-[11px]">
        <span className={over ? 'text-amber-700 font-semibold' : 'text-gray-500'}>
          {info.units} / {info.unitsInCurrentLimit}
        </span>
        <span className={over ? 'text-amber-700' : 'text-gray-400'}>
          {info.segments} segment{info.segments === 1 ? '' : 's'}
        </span>
        <span className="text-gray-400">{info.encoding}</span>
        {info.encoding === 'UCS-2' && (
          <span className="text-amber-700">
            — a non-GSM character (an emoji, a curly quote) dropped the limit to 70
          </span>
        )}
      </div>
      {/* The boundary bar: filled to the current length, ticked at each split. */}
      <div className="relative h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full ${over ? 'bg-amber-400' : 'bg-emerald-400'}`}
          style={{ width: `${Math.min(100, (info.units / (info.boundaries[3] || 1)) * 100)}%` }}
        />
        {info.boundaries.map(b => (
          <span
            key={b}
            title={`${b} characters — segment boundary`}
            className="absolute top-0 h-full w-px bg-gray-400/70"
            style={{ left: `${Math.min(100, (b / (info.boundaries[3] || 1)) * 100)}%` }}
          />
        ))}
      </div>
      <div className="text-[10px] text-gray-400">
        marks at {info.boundaries.join(' · ')} — each split is a separate billed text
      </div>
    </div>
  )
}

/* ── The component ──────────────────────────────────────────────────────── */

export default function LeadThread({
  timeline,
  drafts,
  activeDraftId,
  recipient,
  headers,
  onChanged,
  staleDraftIds,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(activeDraftId)
  const draft = useMemo(
    () => drafts.find(d => d.id === (selectedId ?? activeDraftId)) ?? drafts[0] ?? null,
    [drafts, selectedId, activeDraftId],
  )

  const [note, setNote] = useState('')
  const [tones, setTones] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [subject, setSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [smsBody, setSmsBody] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const stale = draft ? staleDraftIds.includes(draft.id) : false
  const closed = !draft || draft.status === 'sent' || draft.status === 'cancelled'

  function startEditing() {
    if (!draft) return
    setSubject(draft.subject ?? '')
    setEmailBody(draft.email_draft ?? '')
    setSmsBody(draft.sms_draft ?? '')
    setEditing(true)
  }

  async function post(payload: Record<string, unknown>, label: string) {
    if (!draft) return
    setBusy(label)
    setMessage(null)
    try {
      const res = await fetch('/api/admin/agent', {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: draft.id, ...payload }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ tone: 'error', text: data?.error || `${label} failed` })
        return
      }
      setMessage({
        tone: 'ok',
        text: data.sentToCustomer
          ? `Sent to ${data.recipient?.name || data.recipient?.email || data.recipient?.phone || 'the customer'}.`
          : data.test
            ? 'Test copy sent to you. The customer still has nothing.'
            : `${label} done — nothing has gone to the customer.`,
      })
      setNote('')
      setTones([])
      setEditing(false)
      onChanged()
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : `${label} failed` })
    } finally {
      setBusy(null)
    }
  }

  function approveAndSend() {
    const who = recipient.name || recipient.email || recipient.phone
    if (!who) {
      setMessage({ tone: 'error', text: 'This lead has no email or phone on file — nothing to send to.' })
      return
    }
    // Named recipient, spelled out. "Send to the customer?" is a dialog people
    // click through; "Send to Jess (jess@…)?" is one they read.
    const ok = window.confirm(
      `Send this to ${recipient.name ? `${recipient.name} ` : ''}${recipient.email || recipient.phone}?\n\n` +
        `This goes to the real customer and cannot be pulled back.`,
    )
    if (!ok) return
    if (!draft) return

    // Two calls, as everywhere else: approve is the gate, send is the act. They
    // are run here rather than through post() twice because a failed approve
    // must NOT be followed by a send — and post() reports success on its own,
    // which would have said "approved" and then sent anyway.
    void (async () => {
      setBusy('Send')
      setMessage(null)
      try {
        if (draft.status !== 'approved') {
          const res = await fetch('/api/admin/agent', {
            method: 'POST',
            headers,
            body: JSON.stringify({ id: draft.id, action: 'approve' }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) {
            setMessage({ tone: 'error', text: `${data?.error || 'Approve failed'} — nothing was sent.` })
            return
          }
        }
        const res = await fetch('/api/admin/agent', {
          method: 'POST',
          headers,
          body: JSON.stringify({ id: draft.id, action: 'send' }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) {
          setMessage({
            tone: 'error',
            text: `${(data?.errors || []).join('; ') || data?.error || 'Send failed'}. The draft is approved but NOT sent.`,
          })
          return
        }
        setMessage({
          tone: 'ok',
          text: `Sent to ${data.recipient?.name || data.recipient?.email || data.recipient?.phone || who}.`,
        })
      } catch (err) {
        setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Send failed' })
      } finally {
        setBusy(null)
        onChanged()
      }
    })()
  }

  return (
    <div className="space-y-4">
      {/* ── The timeline ── */}
      <section className="bg-[#fafbfc] rounded-2xl border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-hampton-navy mb-2">The thread</h2>
        {timeline.length === 0 && <p className="text-sm text-gray-400">Nothing on this lead yet.</p>}
        {timeline.map(item => {
          if (item.kind === 'message') {
            return (
              <Bubble
                key={item.id}
                side={item.side === 'outbound' ? 'outbound' : 'inbound'}
                header={
                  <>
                    {item.source} · {item.from || 'unknown sender'} · {when(item.at)}
                    {item.classification ? ` · ${item.classification}` : ''}
                    {item.subject ? ` · ${item.subject}` : ''}
                  </>
                }
              >
                {item.body || '(no body)'}
              </Bubble>
            )
          }

          if (item.kind === 'draft_version') {
            // A note-only entry is the instruction, not a version.
            if (item.version === 0) {
              return (
                <Rule key={item.id} tone="gray">
                  {item.author} asked: “{item.note}” · {when(item.at)}
                </Rule>
              )
            }
            const open = expanded === item.id
            return (
              <div key={item.id}>
                <Bubble
                  side="outbound"
                  header={
                    <button className="underline decoration-dotted" onClick={() => setExpanded(open ? null : item.id)}>
                      draft v{item.version} · {item.author}
                      {item.note ? ` · ${item.note}` : ''} · {when(item.at)} — never sent
                    </button>
                  }
                >
                  {open ? (
                    <div className="space-y-3">
                      {item.previousSmsDraft && (
                        <div>
                          <div className="text-[11px] text-gray-400 mb-0.5">previous SMS</div>
                          <div className="text-xs text-gray-500 line-through whitespace-pre-wrap">
                            {item.previousSmsDraft}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="text-[11px] text-gray-400 mb-0.5">SMS</div>
                        {item.smsDraft || '(empty)'}
                      </div>
                      <div>
                        <div className="text-[11px] text-gray-400 mb-0.5">
                          Email{item.subject ? ` — ${item.subject}` : ''}
                        </div>
                        {item.emailDraft || '(empty)'}
                      </div>
                    </div>
                  ) : (
                    <span className="text-gray-500">{(item.smsDraft || item.emailDraft || '').slice(0, 160)}…</span>
                  )}
                </Bubble>
              </div>
            )
          }

          if (item.kind === 'payment') {
            return (
              <Rule key={item.id} tone="green">
                {item.paymentType} paid — ${(item.amountCents / 100).toFixed(2)} by {item.paymentMethod} ·{' '}
                {when(item.at)}
              </Rule>
            )
          }

          if (item.kind === 'interaction') {
            return (
              <Rule key={item.id}>
                {item.type.replace(/_/g, ' ')}
                {item.summary ? ` — ${item.summary}` : ''} · {when(item.at)}
              </Rule>
            )
          }

          const line = ledgerLine(item)
          if (!line) return null
          return (
            <Rule key={item.id} tone={line.tone}>
              {line.text} · {when(item.at)}
            </Rule>
          )
        })}
      </section>

      {/* ── The working draft ── */}
      {drafts.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {drafts.map(d => (
            <button
              key={d.id}
              onClick={() => setSelectedId(d.id)}
              className={`text-[11px] px-2 py-1 rounded-full border ${
                draft?.id === d.id ? 'bg-hampton-navy text-white border-hampton-navy' : 'bg-white border-gray-200 text-gray-600'
              }`}
            >
              {d.review_code || d.id.slice(0, 8)} · {d.status}
            </button>
          ))}
        </div>
      )}

      {!draft && (
        <p className="text-sm text-gray-500 bg-white rounded-2xl border border-gray-200 p-4">
          No draft on this lead yet. Draft one from Admin → Inbox, and it will appear here.
        </p>
      )}

      {draft && (
        <section className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-hampton-navy">
              {draft.review_code || draft.id.slice(0, 8)}
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">{draft.status}</span>
            {draft.contact_path && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {draft.contact_path === 'quote' ? 'quote path' : 'info gather'}
              </span>
            )}
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full ${
                draft.sent_at ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {draft.sent_at ? `sent ${when(draft.sent_at)}` : 'nothing sent to the customer'}
            </span>
          </div>

          {draft.error && (
            <p className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
              Held back: {draft.error}
            </p>
          )}
          {stale && (
            <p className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
              The plan changed after this draft was written — re-draft before sending it, or it will quote
              something that no longer matches.
            </p>
          )}

          {/* ── Inline editing (plan §11.4) ── */}
          {!editing ? (
            <>
              <div>
                <div className="text-[11px] text-gray-400">Subject</div>
                <div className="text-sm text-gray-800">{draft.subject || '(none)'}</div>
              </div>
              <div>
                <div className="text-[11px] text-gray-400">Email</div>
                <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">
                  {draft.email_draft || '(empty)'}
                </pre>
              </div>
              <div>
                <div className="text-[11px] text-gray-400">SMS</div>
                <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">
                  {draft.sms_draft || '(empty)'}
                </pre>
                <SegmentRuler text={draft.sms_draft || ''} />
              </div>
              {!closed && (
                <button onClick={startEditing} className="text-sm text-hampton-navy underline">
                  Edit this text
                </button>
              )}
            </>
          ) : (
            <>
              <label className="block">
                <span className="text-[11px] text-gray-400">Subject</span>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-gray-400">Email</span>
                <textarea
                  value={emailBody}
                  onChange={e => setEmailBody(e.target.value)}
                  rows={10}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-sans"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-gray-400">SMS</span>
                <textarea
                  value={smsBody}
                  onChange={e => setSmsBody(e.target.value)}
                  rows={4}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-sans"
                />
              </label>
              <SegmentRuler text={smsBody} />
              <p className="text-[11px] text-gray-500">
                Saving un-approves the draft — the approval was for the old words — and retires the old preview
                link.
              </p>
              <div className="flex gap-2">
                <button
                  disabled={!!busy}
                  onClick={() => post({ action: 'edit', subject, emailDraft: emailBody, smsDraft: smsBody, note: 'edited in the lead workspace' }, 'Save')}
                  className="px-3 py-1.5 rounded-lg bg-hampton-navy text-white text-sm disabled:opacity-50"
                >
                  {busy === 'Save' ? 'Saving…' : 'Save text'}
                </button>
                <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm">
                  Cancel
                </button>
              </div>
            </>
          )}

          {/* ── The chat composer (plan §11.3) ── */}
          {!closed && (
            <div className="border-t border-gray-100 pt-3 space-y-2">
              <div className="text-[11px] text-gray-400">Tell me what to change</div>
              <div className="flex flex-wrap gap-1.5">
                {TONE_PRESETS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setTones(t => (t.includes(p.id) ? t.filter(x => x !== p.id) : [...t, p.id]))}
                    className={`text-[11px] px-2.5 py-1 rounded-full border ${
                      tones.includes(p.id)
                        ? 'bg-hampton-navy text-white border-hampton-navy'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                placeholder="e.g. mention that we bring the tables, and ask if there's parking"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
              <button
                disabled={!!busy || (!note.trim() && tones.length === 0)}
                onClick={() => post({ action: 'revise', note, toneIds: tones }, 'Re-draft')}
                className="px-3 py-1.5 rounded-lg bg-hampton-navy text-white text-sm disabled:opacity-40"
              >
                {busy === 'Re-draft' ? 'Re-drafting…' : 'Re-draft'}
              </button>
              <p className="text-[11px] text-gray-400">
                Same re-draft the SMS loop runs — your note lands in the draft’s history either way.
              </p>
            </div>
          )}

          {/* ── Accept (plan §11.5) ── */}
          {!closed && (
            <div className="border-t border-gray-100 pt-3 flex flex-wrap gap-2 items-center">
              <button
                disabled={!!busy}
                onClick={approveAndSend}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50"
              >
                {busy === 'Send' || busy === 'Approve' ? 'Sending…' : 'Approve & send'}
              </button>
              <button
                disabled={!!busy}
                onClick={() => post({ action: 'test' }, 'Test')}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm disabled:opacity-50"
              >
                Test to me
              </button>
              <button
                disabled={!!busy}
                onClick={() => {
                  if (window.confirm('Drop this draft? Nothing has been sent, and it stays as an audit record.')) {
                    void post({ action: 'dismiss', note: 'dismissed in the lead workspace' }, 'Dismiss')
                  }
                }}
                className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 disabled:opacity-50"
              >
                Dismiss
              </button>
              <span className="text-[11px] text-gray-500">
                to {recipient.name || '—'} {recipient.email ? `· ${recipient.email}` : ''}{' '}
                {recipient.phone ? `· ${recipient.phone}` : ''}
              </span>
            </div>
          )}

          {message && (
            <p
              className={`text-sm rounded-lg px-3 py-2 ${
                message.tone === 'ok'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}
            >
              {message.text}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
