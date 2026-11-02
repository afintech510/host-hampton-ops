'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Loader2, RotateCcw, Send, Sparkles, X } from 'lucide-react'

/**
 * /admin/assistant — the Manager chat.
 *
 * Talks to /api/admin/assistant. The assistant can look things up on its own;
 * anything that would change a booking, message a client or make a payment
 * link arrives here as a CARD, and only the Confirm button on that card does
 * it (/api/admin/assistant/confirm).
 */

const TOKEN_KEY = 'hh_admin_token'

interface Card {
  id: string
  title: string
  details: string[]
  token: string
  kind: string
  state: 'pending' | 'working' | 'done' | 'failed' | 'dismissed'
  result?: string
  links?: { label: string; url: string }[]
}

interface Line {
  role: 'user' | 'assistant' | 'note'
  text: string
  cards?: Card[]
}

const SUGGESTIONS = [
  'What parties are coming up this week?',
  'Is next Saturday free?',
  'What does HH-PTY-… still owe?',
  'Set up a slime party for 12 kids',
]

function authHeaders(): Record<string, string> {
  const t = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

export default function AssistantPage() {
  const [checking, setChecking] = useState(true)
  const [signedIn, setSignedIn] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  // The API-format history, exactly as the server returned it.
  const [history, setHistory] = useState<unknown[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/admin/auth/session')
      .then(r => r.json())
      .then(d => setSignedIn(!!d?.authenticated || !!localStorage.getItem(TOKEN_KEY)))
      .catch(() => setSignedIn(!!localStorage.getItem(TOKEN_KEY)))
      .finally(() => setChecking(false))
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, busy])

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
        body: JSON.stringify({ messages: history, text: msg }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        setSignedIn(false)
        return
      }
      if (!res.ok) {
        setError(data.error || `Error ${res.status}`)
        return
      }
      setHistory(data.messages || [])
      const cards: Card[] = (data.proposals || []).map((p: Omit<Card, 'state'>) => ({ ...p, state: 'pending' }))
      setLines(l => [...l, { role: 'assistant', text: data.reply || '', cards }])
    } catch {
      setError('Could not reach the assistant.')
    } finally {
      setBusy(false)
    }
  }

  function updateCard(id: string, patch: Partial<Card>) {
    setLines(ls => ls.map(line => (line.cards ? { ...line, cards: line.cards.map(c => (c.id === id ? { ...c, ...patch } : c)) } : line)))
  }

  async function confirm(card: Card) {
    updateCard(card.id, { state: 'working' })
    try {
      const res = await fetch('/api/admin/assistant/confirm', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ token: card.token }),
      })
      const data = await res.json().catch(() => ({}))
      const ok = res.ok && data.ok === true
      const message: string = data.message || data.error || `Error ${res.status}`
      updateCard(card.id, { state: ok ? 'done' : 'failed', result: message, links: data.links || [] })
      // Tell the assistant what happened, so its next answer is about the
      // world as it now is rather than as it was when it drew the card.
      setHistory(h => [
        ...h,
        { role: 'user', content: `[Manager ${ok ? 'confirmed' : 'tried to confirm'} "${card.title}". Result: ${message}]` },
      ])
    } catch {
      updateCard(card.id, { state: 'failed', result: 'Could not reach the server — check the Parties tab before retrying.' })
    }
  }

  function dismiss(card: Card) {
    updateCard(card.id, { state: 'dismissed' })
    setHistory(h => [...h, { role: 'user', content: `[Manager dismissed "${card.title}" — it was not done.]` }])
  }

  function reset() {
    setLines([])
    setHistory([])
    setError('')
  }

  if (checking) {
    return <div className="min-h-screen flex items-center justify-center text-hampton-navy/60">Loading…</div>
  }

  if (!signedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-4">
          <p className="text-hampton-navy">Sign in to the admin dashboard first.</p>
          <Link href="/admin" className="inline-block bg-hampton-navy text-white px-5 py-2 rounded-full text-sm font-bold">
            Go to admin
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-hampton-ivory flex flex-col">
      <header className="sticky top-0 z-10 bg-white border-b border-hampton-mauve/30">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-hampton-navy/60 hover:text-hampton-navy" aria-label="Back to admin">
              <ArrowLeft size={18} />
            </Link>
            <Sparkles size={18} className="text-hampton-navy" />
            <h1 className="font-serif text-lg text-hampton-navy">Manager assistant</h1>
          </div>
          <button
            onClick={reset}
            className="flex items-center gap-1 text-sm text-hampton-navy/60 hover:text-hampton-navy"
            disabled={busy}
          >
            <RotateCcw size={14} /> New chat
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 space-y-4">
        {lines.length === 0 && (
          <div className="text-center space-y-4 pt-10">
            <p className="text-hampton-navy/70 text-sm">
              Ask about parties, dates, prices and balances. Anything that changes a booking, messages a client or
              makes a payment link comes back as a card for you to confirm.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map(s => (
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
            <div className={`max-w-[85%] space-y-3 ${line.role === 'user' ? 'items-end' : ''}`}>
              {line.text && (
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                    line.role === 'user' ? 'bg-hampton-navy text-white' : 'bg-white text-hampton-navy border border-hampton-mauve/30'
                  }`}
                >
                  {line.text}
                </div>
              )}
              {line.cards?.map(card => (
                <div key={card.id} className="bg-white border-2 border-hampton-navy/20 rounded-xl p-4 text-sm text-hampton-navy">
                  <p className="font-bold mb-2">{card.title}</p>
                  <ul className="space-y-1 text-hampton-navy/80 mb-3">
                    {card.details.map((d, j) => (
                      <li key={j}>• {d}</li>
                    ))}
                  </ul>
                  {card.state === 'pending' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => confirm(card)}
                        className="flex items-center gap-1 bg-hampton-navy text-white px-4 py-1.5 rounded-full font-bold"
                      >
                        <Check size={14} /> Confirm
                      </button>
                      <button
                        onClick={() => dismiss(card)}
                        className="flex items-center gap-1 border border-hampton-navy/30 px-4 py-1.5 rounded-full"
                      >
                        <X size={14} /> Dismiss
                      </button>
                    </div>
                  )}
                  {card.state === 'working' && (
                    <p className="flex items-center gap-2 text-hampton-navy/70">
                      <Loader2 size={14} className="animate-spin" /> Working…
                    </p>
                  )}
                  {card.state === 'dismissed' && <p className="text-hampton-navy/50">Dismissed — nothing was done.</p>}
                  {(card.state === 'done' || card.state === 'failed') && (
                    <div className={card.state === 'done' ? 'text-green-700' : 'text-red-700'}>
                      <p>{card.result}</p>
                      {card.links?.map(l => (
                        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="underline block mt-1">
                          {l.label}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-sm text-hampton-navy/60">
            <Loader2 size={14} className="animate-spin" /> Thinking…
          </div>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div ref={endRef} />
      </main>

      <footer className="sticky bottom-0 bg-white border-t border-hampton-mauve/30">
        <form
          onSubmit={e => {
            e.preventDefault()
            send(text)
          }}
          className="max-w-3xl mx-auto px-4 py-3 flex gap-2"
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
            placeholder="Ask, or tell me what to set up…"
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
      </footer>
    </div>
  )
}
