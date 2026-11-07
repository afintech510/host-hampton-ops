'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Brain, Check, Loader2, Pencil, RotateCcw, Send, Sparkles, X } from 'lucide-react'
import MemoryPanel from './MemoryPanel'
import CopyButton from './CopyButton'
import PartyCardView from './PartyCardView'
import type { PartyCardData } from '@/lib/assistant/partyCard'
import type { MessagePreview, PreviewChannel } from '@/lib/assistant/messageCard'

/**
 * The Manager assistant's chat — ONE component, two homes: the slide-over
 * drawer (`AssistantDrawer`, mounted across /admin and on the admin-verified
 * invoice page) and the full-screen view at /admin/assistant.
 *
 * Talks to /api/admin/assistant. The conversation lives on the SERVER (one
 * thread per admin per context), so this component loads it, sends a message,
 * and draws what comes back. Anything that would change a booking, message a
 * client or make a payment link arrives as a CARD, and only the Confirm button
 * on that card does it (/api/admin/assistant/confirm).
 *
 * Not streamed — a typing indicator covers the wait (see the route).
 */

const TOKEN_KEY = 'hh_admin_token'

export interface ChatContext {
  page: 'invoice' | 'admin' | 'assistant'
  bookingRef: string | null
}

interface Card {
  id: string
  title: string
  details: string[]
  token: string
  kind: string
  state: 'pending' | 'working' | 'done' | 'failed' | 'dismissed' | 'expired'
  expiresAt?: number
  photos?: { id: string; url: string; alt: string }[]
  /** A message card: the exact wording, who it goes to and whether it would be refused now. */
  message?: MessagePreview
  /** The full card of the party a confirmed "create party" made. */
  party?: PartyCardData
  result?: string
  links?: { label: string; url: string }[]
}

/** Card kinds drawn as a labelled sheet (with a badge) rather than a bullet list. */
const KIND_BADGES: Record<string, string> = {
  create_mobile_party: 'Mobile party',
  create_studio_rental: 'Studio rental',
}

/** "Label: value" lines become a two-column sheet; any other line is a full-width note under it. */
function DetailRows({ details }: { details: string[] }) {
  const rows: { label: string; value: string }[] = []
  const notes: string[] = []
  for (const d of details) {
    const m = /^([A-Z][A-Za-z' /]{1,24}): (.+)$/.exec(d)
    if (m) rows.push({ label: m[1], value: m[2] })
    else notes.push(d)
  }
  return (
    <div className="mb-3">
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1">
        {rows.map((r, i) => (
          <div key={i} className="contents">
            <dt className="text-hampton-navy/50">{r.label}</dt>
            <dd className={r.label === 'Total' ? 'font-bold' : ''}>{r.value}</dd>
          </div>
        ))}
      </dl>
      {notes.map((n, i) => (
        <p key={i} className="mt-1.5 text-xs text-hampton-navy/60">{n}</p>
      ))}
    </div>
  )
}

/**
 * Makes a link in the assistant's reply clickable — OUR OWN pages only. A URL
 * is turned into an anchor only when it resolves to this site's origin; anything
 * else stays plain text, so a customer-supplied address that ends up in a reply is
 * never a one-click link out of the admin.
 */
function LinkedText({ text }: { text: string }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const parts = text.split(/(https?:\/\/[^\s)]+|\/admin[^\s)]*)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0 || !origin) return part
        const trimmed = part.replace(/[.,;:!?]+$/, '')
        const tail = part.slice(trimmed.length)
        let ours = false
        try {
          ours = new URL(trimmed, origin).origin === origin
        } catch {
          ours = false
        }
        if (!ours) return part
        return (
          <span key={i}>
            <a href={trimmed} target="_blank" rel="noopener noreferrer" className="underline font-medium">{trimmed}</a>
            {tail}
          </span>
        )
      })}
    </>
  )
}

/** What the recipient will read, exactly — with a hand-edit box for each part that can be reworded. */
function MessageView({
  message,
  editing,
  drafts,
  onDraft,
}: {
  message: MessagePreview
  editing: boolean
  drafts: Record<string, string>
  onDraft: (key: string, value: string) => void
}) {
  const tone = message.level === 'blocked' ? 'text-red-700' : message.level === 'warn' ? 'text-amber-700' : 'text-hampton-navy/70'
  return (
    <div className="space-y-2 mb-3">
      {message.channels.map((c: PreviewChannel) => (
        <div key={c.channel} className="border border-hampton-mauve/40 rounded-lg overflow-hidden">
          <div className="bg-hampton-ivory px-3 py-1.5 text-xs text-hampton-navy/70 flex flex-wrap gap-x-3">
            <span className="font-bold">{c.channel === 'sms' ? 'Text' : 'Email'} to {message.recipient}</span>
            <span>{c.to}</span>
            {c.sms && (
              <span>
                {c.sms.segments} segment{c.sms.segments === 1 ? '' : 's'} · {c.sms.encoding}
                {c.sms.cause ? ` (${c.sms.cause})` : ''}
              </span>
            )}
          </div>
          <div className="px-3 py-2">
            {c.subject !== undefined &&
              (editing && c.editable ? (
                <input
                  value={drafts.emailSubject ?? c.subject}
                  onChange={e => onDraft('emailSubject', e.target.value)}
                  className="w-full border border-hampton-mauve/40 rounded px-2 py-1 mb-2 font-bold"
                  aria-label="Email subject"
                />
              ) : (
                <p className="font-bold mb-1">{c.subject}</p>
              ))}
            {editing && c.editable ? (
              <textarea
                value={drafts[c.channel === 'sms' ? 'smsBody' : 'emailBody'] ?? c.template}
                onChange={e => onDraft(c.channel === 'sms' ? 'smsBody' : 'emailBody', e.target.value)}
                rows={c.channel === 'sms' ? 6 : 12}
                className="w-full border border-hampton-mauve/40 rounded px-2 py-1 font-mono text-xs"
                aria-label={c.channel === 'sms' ? 'Text message' : 'Email body'}
              />
            ) : (
              <p className="whitespace-pre-wrap break-words">{c.display}</p>
            )}
            {c.notes.map((n, i) => (
              <p key={i} className="text-xs text-hampton-navy/60 mt-1">{n}</p>
            ))}
          </div>
        </div>
      ))}
      {editing && (
        <p className="text-xs text-hampton-navy/60">
          Keep the link markers in curly braces, like {'{invite}'} or {'{photos}'} — each is replaced with the real link when it sends.
          Texts keep the &ldquo;Reply STOP&rdquo; line.
        </p>
      )}
      {message.status.map((s, i) => (
        <p key={i} className={`text-xs ${tone}`}>{s}</p>
      ))}
    </div>
  )
}

interface Line {
  role: 'user' | 'assistant' | 'note'
  text: string
  cards?: Card[]
  /** Cards for the parties this reply was about. */
  parties?: PartyCardData[]
}

function authHeaders(): Record<string, string> {
  const t = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

function contextQuery(ctx: ChatContext): string {
  const q = new URLSearchParams({ page: ctx.page })
  if (ctx.bookingRef) q.set('booking_ref', ctx.bookingRef)
  return q.toString()
}

function suggestionsFor(ctx: ChatContext): string[] {
  if (ctx.bookingRef) {
    return [
      'What is still owed on this party?',
      'Add a balloon garland to this',
      'Send the family some slime photos',
      'Record a $250 Venmo payment',
    ]
  }
  return [
    'What parties are coming up this week?',
    'Is next Saturday free?',
    'Quote a slime party for 12 kids',
    'Set up a party for a new client',
  ]
}

export default function AssistantChat({
  context,
  variant,
  onActionDone,
  onClose,
  seed,
}: {
  context: ChatContext
  variant: 'drawer' | 'full'
  /** Called after a confirmed action succeeded, so the host page can refresh its data. */
  onActionDone?: () => void
  onClose?: () => void
  /** Text to put in the box (not send) when the chat is opened from a button; `nonce` makes a repeat count. */
  seed?: { text: string; nonce: number } | null
}) {
  const [lines, setLines] = useState<Line[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  useEffect(() => {
    if (seed?.text) setText(seed.text)
  }, [seed?.nonce, seed?.text])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [signedOut, setSignedOut] = useState(false)
  const [showMemory, setShowMemory] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const ctxQuery = contextQuery(context)

  // Load the saved thread for this context (and again if the context changes).
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    fetch(`/api/admin/assistant/thread?${ctxQuery}`, { headers: authHeaders() })
      .then(async r => {
        if (r.status === 401) {
          if (!cancelled) setSignedOut(true)
          return null
        }
        return r.ok ? r.json() : null
      })
      .then(d => {
        if (!cancelled && d) setLines(Array.isArray(d.lines) ? d.lines : [])
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ctxQuery])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, busy])

  const updateCard = useCallback((id: string, patch: Partial<Card>) => {
    setLines(ls => ls.map(line => (line.cards ? { ...line, cards: line.cards.map(c => (c.id === id ? { ...c, ...patch } : c)) } : line)))
  }, [])

  async function send(message: string) {
    const msg = message.trim()
    if (!msg || busy) return
    setError('')
    setText('')
    setLines(l => [...l, { role: 'user', text: msg }])
    setBusy(true)
    try {
      const res = await fetch('/api/admin/assistant', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ text: msg, context: { page: context.page, booking_ref: context.bookingRef } }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        setSignedOut(true)
        return
      }
      if (!res.ok) {
        setError(data.error || `Error ${res.status}`)
        return
      }
      // A reworded message replaces the pending card it was made from.
      const replaced = new Set<string>(Array.isArray(data.replaced) ? data.replaced : [])
      setLines(l => [
        ...l.map(line =>
          replaced.size && line.cards
            ? {
                ...line,
                cards: line.cards.map(c =>
                  replaced.has(c.id) && c.state === 'pending'
                    ? { ...c, state: 'dismissed' as const, result: 'Replaced by the reworded message below.' }
                    : c,
                ),
              }
            : line,
        ),
        { role: 'assistant', text: data.reply || '', cards: data.proposals || [], parties: data.parties || [] },
      ])
    } catch {
      setError('Could not reach the assistant.')
    } finally {
      setBusy(false)
    }
  }

  async function confirm(card: Card) {
    updateCard(card.id, { state: 'working' })
    try {
      const res = await fetch('/api/admin/assistant/confirm', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ token: card.token, context: { page: context.page, booking_ref: context.bookingRef } }),
      })
      const data = await res.json().catch(() => ({}))
      const ok = res.ok && data.ok === true
      const message: string = data.message || data.error || `Error ${res.status}`
      // A refusal before anything happened (quiet hours, nothing owed) leaves the
      // card confirmable: say why, and let the manager fix the cause and retry.
      if (!ok && data.retryable) updateCard(card.id, { state: 'pending', result: message })
      else updateCard(card.id, { state: ok ? 'done' : 'failed', result: message, links: data.links || [], party: data.party || undefined })
      if (ok) onActionDone?.()
    } catch {
      updateCard(card.id, { state: 'failed', result: 'Could not reach the server — check the Parties tab before retrying.' })
    }
  }

  const [editing, setEditing] = useState<{ cardId: string; drafts: Record<string, string>; saving: boolean; error: string } | null>(null)

  /** Send the hand edit; the server screens it and answers with a NEW card (new token) that replaces this one. */
  async function saveEdit(card: Card) {
    if (!editing || editing.cardId !== card.id) return
    setEditing({ ...editing, saving: true, error: '' })
    try {
      const res = await fetch('/api/admin/assistant/revise', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ token: card.token, ...editing.drafts, context: { page: context.page, booking_ref: context.bookingRef } }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok !== true) {
        setEditing(e => (e ? { ...e, saving: false, error: data.error || `Error ${res.status}` } : e))
        return
      }
      setLines(ls =>
        ls.map(line => (line.cards ? { ...line, cards: line.cards.map(c => (c.id === card.id ? (data.card as Card) : c)) } : line)),
      )
      setEditing(null)
    } catch {
      setEditing(e => (e ? { ...e, saving: false, error: 'Could not reach the server.' } : e))
    }
  }

  function dismiss(card: Card) {
    updateCard(card.id, { state: 'dismissed' })
    fetch('/api/admin/assistant/thread', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ context: { page: context.page, booking_ref: context.bookingRef }, dismiss: { id: card.id } }),
    }).catch(() => undefined)
  }

  async function reset() {
    setLines([])
    setError('')
    await fetch(`/api/admin/assistant/thread?${ctxQuery}`, { method: 'DELETE', headers: authHeaders() }).catch(() => undefined)
  }

  const full = variant === 'full'
  const wrap = full ? 'max-w-3xl mx-auto w-full' : 'w-full'

  if (signedOut) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center text-sm text-hampton-navy">
        Your admin session ended — sign in to the dashboard again.
      </div>
    )
  }

  return (
    <div className={`flex flex-col ${full ? 'min-h-screen' : 'h-full'} bg-hampton-ivory`}>
      <div className="bg-white border-b border-hampton-mauve/30">
        <div className={`${wrap} px-4 py-3 flex items-center justify-between`}>
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={18} className="text-hampton-navy shrink-0" />
            <h2 className="font-serif text-lg text-hampton-navy truncate">
              Manager assistant
              {context.bookingRef ? <span className="text-sm text-hampton-navy/60 font-sans"> · {context.bookingRef}</span> : null}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={reset}
              className="flex items-center gap-1 text-sm text-hampton-navy/60 hover:text-hampton-navy disabled:opacity-40"
              disabled={busy}
            >
              <RotateCcw size={14} /> New chat
            </button>
            <button
              onClick={() => setShowMemory(v => !v)}
              aria-pressed={showMemory}
              className={`flex items-center gap-1 text-sm hover:text-hampton-navy ${showMemory ? 'text-hampton-navy font-bold' : 'text-hampton-navy/60'}`}
            >
              <Brain size={14} /> Memory
            </button>
            {onClose && (
              <button onClick={onClose} aria-label="Close assistant" className="text-hampton-navy/60 hover:text-hampton-navy">
                <X size={20} />
              </button>
            )}
          </div>
        </div>
      </div>

      {showMemory && (
        <div className="bg-white border-b border-hampton-mauve/30">
          <div className={`${wrap} px-4 py-3`}>
            <MemoryPanel />
          </div>
        </div>
      )}

      <div className={`flex-1 overflow-y-auto ${wrap} px-4 py-4 space-y-4`}>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-hampton-navy/60">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        )}

        {!loading && lines.length === 0 && (
          <div className="text-center space-y-4 pt-6">
            <p className="text-hampton-navy/70 text-sm">
              Ask about parties, dates, prices and balances. Anything that changes a booking, messages a client or
              makes a payment link comes back as a card for you to confirm.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestionsFor(context).map(s => (
                <button
                  key={s}
                  onClick={() => setText(s)}
                  className="text-sm bg-white border border-hampton-mauve/40 rounded-full px-3 py-1.5 text-hampton-navy hover:border-hampton-navy"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {lines.map((line, i) => (
          <div key={i} className={line.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className="max-w-[92%] space-y-3">
              {line.text && (
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
                    line.role === 'user' ? 'bg-hampton-navy text-white' : 'bg-white text-hampton-navy border border-hampton-mauve/30'
                  }`}
                >
                  {line.role === 'assistant' ? <LinkedText text={line.text} /> : line.text}
                </div>
              )}
              {line.parties?.map(p => (
                <PartyCardView key={p.ref} party={p} />
              ))}
              {line.cards?.map(card => (
                <div key={card.id} className="bg-white border-2 border-hampton-navy/20 rounded-xl p-4 text-sm text-hampton-navy">
                  {KIND_BADGES[card.kind] && (
                    <span className="inline-block mb-1.5 rounded-full bg-hampton-navy/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-hampton-navy/70">
                      {KIND_BADGES[card.kind]}
                    </span>
                  )}
                  <p className="font-bold mb-2">{card.title}</p>
                  {card.photos && card.photos.length > 0 && (
                    <div className="grid grid-cols-4 gap-1.5 mb-3">
                      {card.photos.map(p => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={p.id} src={p.url} alt={p.alt || 'Party photo'} loading="lazy" className="w-full aspect-square object-cover rounded-md border border-hampton-mauve/30" />
                      ))}
                    </div>
                  )}
                  {KIND_BADGES[card.kind] ? (
                    <DetailRows details={card.details} />
                  ) : (
                    <ul className="space-y-1 text-hampton-navy/80 mb-3">
                      {card.details.map((d, j) => (
                        <li key={j}>• {d}</li>
                      ))}
                    </ul>
                  )}
                  {card.message && (
                    <MessageView
                      message={card.message}
                      editing={card.state === 'pending' && editing?.cardId === card.id}
                      drafts={editing?.cardId === card.id ? editing.drafts : {}}
                      onDraft={(k, v) => setEditing(e => (e && e.cardId === card.id ? { ...e, drafts: { ...e.drafts, [k]: v } } : e))}
                    />
                  )}
                  {card.state === 'pending' && (
                    <div>
                      {card.result && <p className="text-red-700 mb-2">{card.result}</p>}
                      {editing?.cardId === card.id ? (
                        <div>
                          {editing.error && <p className="text-red-700 mb-2">{editing.error}</p>}
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveEdit(card)}
                              disabled={editing.saving}
                              className="flex items-center gap-1 bg-hampton-navy text-white px-4 py-1.5 rounded-full font-bold disabled:opacity-50"
                            >
                              {editing.saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Use this wording
                            </button>
                            <button
                              onClick={() => setEditing(null)}
                              className="flex items-center gap-1 border border-hampton-navy/30 px-4 py-1.5 rounded-full"
                            >
                              <X size={14} /> Cancel edit
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => confirm(card)}
                            className="flex items-center gap-1 bg-hampton-navy text-white px-4 py-1.5 rounded-full font-bold"
                          >
                            <Check size={14} /> Confirm
                          </button>
                          {card.message && card.message.channels.some(c => c.editable) && (
                            <button
                              onClick={() => setEditing({ cardId: card.id, drafts: {}, saving: false, error: '' })}
                              className="flex items-center gap-1 border border-hampton-navy/30 px-4 py-1.5 rounded-full"
                            >
                              <Pencil size={14} /> Edit wording
                            </button>
                          )}
                          <button
                            onClick={() => dismiss(card)}
                            className="flex items-center gap-1 border border-hampton-navy/30 px-4 py-1.5 rounded-full"
                          >
                            <X size={14} /> Dismiss
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {card.state === 'working' && (
                    <p className="flex items-center gap-2 text-hampton-navy/70">
                      <Loader2 size={14} className="animate-spin" /> Working…
                    </p>
                  )}
                  {card.state === 'dismissed' && (
                    <p className="text-hampton-navy/50">{card.result || 'Dismissed — nothing was done.'}</p>
                  )}
                  {card.state === 'expired' && <p className="text-hampton-navy/50">This card expired — ask again for a fresh one.</p>}
                  {(card.state === 'done' || card.state === 'failed') && (
                    <div className={card.state === 'done' ? 'text-green-700' : 'text-red-700'}>
                      <p>{card.result}</p>
                      {card.links?.map(l => (
                        <div key={l.url} className="flex items-center gap-3 mt-1">
                          <a href={l.url} target="_blank" rel="noopener noreferrer" className="underline">
                            {l.label}
                          </a>
                          <CopyButton text={l.url} />
                        </div>
                      ))}
                      {card.kind === 'party_link' && card.state === 'done' && !card.links?.length && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => send(`${card.title} again`)}
                          className="mt-1 text-xs underline text-hampton-navy/70 disabled:opacity-50"
                        >
                          Link is not saved in the chat - make it again
                        </button>
                      )}
                      {card.party && (
                        <div className="mt-3 text-hampton-navy">
                          <PartyCardView party={card.party} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex justify-start" aria-live="polite">
            <div className="bg-white border border-hampton-mauve/30 rounded-2xl px-4 py-3 flex items-center gap-1" aria-label="The assistant is typing">
              <span className="w-1.5 h-1.5 rounded-full bg-hampton-navy/50 animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-hampton-navy/50 animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-hampton-navy/50 animate-bounce" />
            </div>
          </div>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div ref={endRef} />
      </div>

      <div className="bg-white border-t border-hampton-mauve/30">
        <form
          onSubmit={e => {
            e.preventDefault()
            send(text)
          }}
          className={`${wrap} px-4 py-3 flex gap-2`}
        >
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(text)
              }
            }}
            rows={1}
            placeholder={context.bookingRef ? 'Ask about this party, or tell me what to change…' : 'Ask, or tell me what to set up…'}
            className="flex-1 resize-none border border-hampton-mauve/40 rounded-xl px-3 py-2 text-sm text-hampton-navy focus:outline-none focus:border-hampton-navy"
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="bg-hampton-navy text-white rounded-xl px-4 disabled:opacity-40"
            aria-label="Send"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  )
}
