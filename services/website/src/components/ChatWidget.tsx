'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { TENANT } from '@/tenant'
import { chatHiddenOn } from '@/lib/chat/chrome'
import { imageSrc, linkSegments, onSitePath, sameOriginUrl } from '@/lib/chat/links'

/**
 * Host Assistant — the website chat.
 *
 * Mounted once in the root layout, and INVISIBLE until the server says the chat
 * exists (`GET /api/chat/config`). The layout is prerendered at build time, when
 * the runtime environment is not there, so the switch cannot be read in the
 * layout; the widget asks once per tab and caches the answer.
 *
 * What it holds: a signed session token (sessionStorage) and what it has DRAWN.
 * It never sends history, roles, prices or tool results — the server keeps the
 * conversation. The booking card's button posts a server-signed token back to
 * `/api/chat/confirm`; nothing in this file can create a booking by itself.
 *
 * Reply transport is plain JSON with a typing indicator (the provider seam is
 * request/response, and a reply is a few sentences), not a stream.
 *
 * Never rendered on the paths in lib/chat/chrome.ts (admin, crew, plan, my-booking,
 * checkout…). That check runs AFTER every hook: Nav lives in the root layout and
 * survives client-side navigation, and returning before a hook once changed the
 * hook count and took the planner down on mobile.
 */

interface PhotosCard { type: 'photos'; photos: { url: string; alt: string }[]; moreUrl: string }
interface BookingCardData {
  type: 'booking'; token: string; title: string; lines: string[]; total: string; deposit: string; date: string; guests: number
}
type Card = PhotosCard | BookingCardData

interface BookedInfo { bookingRef: string; invoiceUrl: string | null; emailedTo: string; emailSent: boolean; total: string; deposit: string }

interface UiMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  cards?: Card[]
  booked?: BookedInfo
}

interface Config { enabled: boolean; turnstileSiteKey?: string | null }

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, opts: Record<string, unknown>): string
      reset(id?: string): void
      remove(id?: string): void
    }
  }
}

const SESSION_KEY = 'hh-chat-session'
const UI_KEY = 'hh-chat-ui'
const CFG_KEY = 'hh-chat-cfg'
const CFG_TTL_MS = 10 * 60 * 1000
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const MAX_INPUT = 800

function readStore<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function writeStore(key: string, value: unknown) {
  try {
    if (value === null) window.sessionStorage.removeItem(key)
    else window.sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode: the chat still works for this page view */
  }
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export default function ChatWidget() {
  const pathname = usePathname()
  const [config, setConfig] = useState<Config | null>(null)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [handoff, setHandoff] = useState(false)
  const [challengeToken, setChallengeToken] = useState<string | null>(null)
  const [challengeError, setChallengeError] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [challengeTick, setChallengeTick] = useState(0)

  const sessionRef = useRef<string | null>(null)
  const nextId = useRef(1)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const challengeEl = useRef<HTMLDivElement>(null)
  const challengeId = useRef<string | null>(null)

  const hidden = chatHiddenOn(pathname)
  const origins = useMemo(() => {
    const list: string[] = []
    try { list.push(new URL(TENANT.business.siteUrl).origin) } catch { /* none */ }
    if (typeof window !== 'undefined') list.push(window.location.origin)
    return list
  }, [])

  /* ── ask the server whether the chat exists (once per tab, cached) ── */
  useEffect(() => {
    if (hidden || config) return
    const cached = readStore<{ at: number; cfg: Config }>(CFG_KEY)
    if (cached && Date.now() - cached.at < CFG_TTL_MS) {
      setConfig(cached.cfg)
      return
    }
    let cancelled = false
    const ask = () => {
      fetch('/api/chat/config', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : { enabled: false }))
        .then((cfg: Config) => {
          if (cancelled) return
          const clean: Config = { enabled: cfg.enabled === true, turnstileSiteKey: cfg.turnstileSiteKey ?? null }
          writeStore(CFG_KEY, { at: Date.now(), cfg: clean })
          setConfig(clean)
        })
        .catch(() => { if (!cancelled) setConfig({ enabled: false }) })
    }
    // After the page has settled; never on the critical path.
    const w = window as unknown as { requestIdleCallback?: (cb: () => void) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(ask)
    else setTimeout(ask, 1500)
    return () => { cancelled = true }
  }, [hidden, config])

  /* ── restore what this tab already drew ── */
  useEffect(() => {
    sessionRef.current = readStore<string>(SESSION_KEY)
    setHasSession(!!sessionRef.current)
    const saved = readStore<UiMessage[]>(UI_KEY)
    if (saved?.length) {
      setMessages(saved)
      nextId.current = Math.max(...saved.map(m => m.id)) + 1
    }
  }, [])

  useEffect(() => {
    writeStore(UI_KEY, messages.length ? messages.slice(-40) : null)
  }, [messages])

  /* ── scroll the log to the newest message ── */
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, sending, open])

  /* ── Turnstile: only while a NEW session still needs to pass the challenge ── */
  const siteKey = config?.enabled ? config.turnstileSiteKey ?? null : null
  useEffect(() => {
    if (!open || !siteKey || hasSession || challengeId.current) return
    let cancelled = false
    const mount = () => {
      if (cancelled || !window.turnstile || !challengeEl.current || challengeId.current) return
      challengeId.current = window.turnstile.render(challengeEl.current, {
        sitekey: siteKey,
        appearance: 'interaction-only',
        callback: (t: string) => { setChallengeToken(t); setChallengeError(false) },
        'expired-callback': () => setChallengeToken(null),
        'error-callback': () => { setChallengeToken(null); setChallengeError(true) },
      })
    }
    if (window.turnstile) mount()
    else {
      let script = document.getElementById('hh-turnstile') as HTMLScriptElement | null
      if (!script) {
        script = document.createElement('script')
        script.id = 'hh-turnstile'
        script.src = TURNSTILE_SRC
        script.async = true
        script.defer = true
        document.head.appendChild(script)
      }
      script.addEventListener('load', mount)
      script.addEventListener('error', () => setChallengeError(true))
    }
    return () => { cancelled = true }
  }, [open, siteKey, hasSession, challengeTick])

  const needsChallenge = !!siteKey && !hasSession
  const canSend = !sending && input.trim().length > 0 && (!needsChallenge || !!challengeToken)

  /* ── focus and Escape ── */
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const close = useCallback(() => {
    setOpen(false)
    launcherRef.current?.focus()
  }, [])

  const add = useCallback((m: Omit<UiMessage, 'id'>) => {
    setMessages(prev => [...prev, { ...m, id: nextId.current++ }])
  }, [])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    setInput('')
    add({ role: 'user', text })
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionToken: sessionRef.current ?? undefined,
          turnstileToken: sessionRef.current ? undefined : challengeToken ?? undefined,
          path: window.location.pathname,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        sessionToken?: string; reply?: string; cards?: Card[]; handoff?: boolean; error?: string; restart?: boolean; verification?: boolean
      }
      if (data.sessionToken) {
        sessionRef.current = data.sessionToken
        writeStore(SESSION_KEY, data.sessionToken)
        setHasSession(true)
      }
      if (res.ok && data.reply) {
        // A Turnstile token is single-use; the session is what carries on.
        if (challengeId.current && window.turnstile) { window.turnstile.remove(challengeId.current); challengeId.current = null }
        setChallengeToken(null)
        add({ role: 'assistant', text: data.reply, cards: data.cards ?? [] })
        setHandoff(!!data.handoff)
        return
      }
      if (data.restart) {
        sessionRef.current = null
        writeStore(SESSION_KEY, null)
        setHasSession(false)
        if (challengeId.current && window.turnstile) { window.turnstile.remove(challengeId.current) }
        challengeId.current = null
        setChallengeToken(null)
        setChallengeTick(t => t + 1)
        setInput(text)
        setError(data.error ?? 'This chat ended. Press send to start a new one.')
        return
      }
      if (data.verification && challengeId.current && window.turnstile) {
        window.turnstile.reset(challengeId.current)
        setChallengeToken(null)
      }
      if (res.status === 404 || res.status === 429 || res.status >= 500) setHandoff(true)
      setInput(text)
      setError(data.error ?? 'Something went wrong. Please try again, or text us.')
    } catch {
      setInput(text)
      setHandoff(true)
      setError('I could not reach the server. Please try again, or text us.')
    } finally {
      setSending(false)
    }
  }, [input, sending, challengeToken, add])

  const confirm = useCallback(async (card: BookingCardData) => {
    if (confirming || !sessionRef.current) return
    setConfirming(card.token)
    setError(null)
    try {
      const res = await fetch('/api/chat/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionToken: sessionRef.current, cardToken: card.token }),
      })
      const data = (await res.json().catch(() => ({}))) as Partial<BookedInfo> & { ok?: boolean; error?: string }
      if (res.ok && data.ok && data.bookingRef) {
        // The card is spent: drop it from every message and show the result instead.
        setMessages(prev => prev.map(m => ({ ...m, cards: m.cards?.filter(c => c.type !== 'booking') })))
        add({
          role: 'assistant',
          text: `Done. Your plan ${data.bookingRef} is saved. The date is held once the deposit is paid on your invoice page.`,
          booked: {
            bookingRef: data.bookingRef, invoiceUrl: data.invoiceUrl ?? null, emailedTo: data.emailedTo ?? '',
            emailSent: data.emailSent === true, total: data.total ?? '', deposit: data.deposit ?? '',
          },
        })
        return
      }
      setError(data.error ?? 'I could not book that. Nothing was charged. Please try again, or text us.')
      if (res.status >= 500) setHandoff(true)
    } catch {
      setError('I could not reach the server. Nothing was booked. Please try again, or text us.')
      setHandoff(true)
    } finally {
      setConfirming(null)
    }
  }, [confirming, add])

  /* ── every hook is above this line ── */
  if (hidden || !config?.enabled) return null

  const phone = TENANT.contact.phoneE164
  const name = TENANT.business.name

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Open chat with Host Assistant`}
          aria-expanded={false}
          aria-controls="hh-chat-panel"
          className="fixed bottom-4 right-4 z-[45] flex h-14 items-center gap-2 rounded-full bg-hampton-navy px-5 text-sm font-semibold text-white shadow-lg transition hover:bg-black focus:outline-none focus-visible:ring-4 focus-visible:ring-hampton-blue motion-reduce:transition-none"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span>Plan a party</span>
        </button>
      )}

      {open && (
        <div
          id="hh-chat-panel"
          role="dialog"
          aria-label="Chat with Host Assistant"
          onKeyDown={e => { if (e.key === 'Escape') close() }}
          className="fixed inset-0 z-[55] flex flex-col bg-white sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[640px] sm:max-h-[calc(100vh-2rem)] sm:w-[400px] sm:rounded-2xl sm:shadow-2xl sm:ring-1 sm:ring-black/10"
          style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <header className="flex items-center justify-between gap-3 bg-hampton-navy px-4 py-3 text-white sm:rounded-t-2xl">
            <div className="min-w-0">
              <p className="text-base font-semibold leading-tight">Host Assistant</p>
              <p className="text-xs text-white/80">AI assistant for {name}. A person is one tap away.</p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close chat"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>

          <div ref={logRef} role="log" aria-live="polite" aria-label="Conversation" className="flex-1 space-y-3 overflow-y-auto bg-hampton-ivory px-3 py-4">
            {messages.length === 0 && (
              <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-3 text-sm text-hampton-navy shadow-sm">
                Hi! I&apos;m Host Assistant, an AI helper. Tell me about the party you&apos;re planning and I can price it, check a date, show you photos and set up your invoice.
              </div>
            )}
            {messages.map(m => (
              <Bubble key={m.id} m={m} origins={origins} confirming={confirming} onConfirm={confirm} />
            ))}
            {sending && (
              <div className="flex" role="status">
                <span className="sr-only">Host Assistant is typing</span>
                <div aria-hidden="true" className="flex gap-1 rounded-2xl rounded-bl-sm bg-white px-4 py-3 shadow-sm">
                  {[0, 1, 2].map(i => (
                    <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-hampton-blue motion-reduce:animate-none" style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
              {error}
            </p>
          )}

          {needsChallenge && (
            <div className="border-t border-gray-200 bg-white px-3 py-1 text-xs text-gray-600" aria-live="polite">
              <div ref={challengeEl} />
              {!challengeToken && !challengeError && 'Checking that you are a person…'}
              {challengeError && 'We could not run the security check. Refresh the page, or use Text us.'}
            </div>
          )}

          <div className={`flex gap-2 border-t px-3 py-2 ${handoff ? 'border-hampton-pink bg-amber-50' : 'border-gray-200 bg-white'}`}>
            <a
              href={`sms:${phone}`}
              className="flex h-11 flex-1 items-center justify-center rounded-full border border-hampton-navy px-3 text-sm font-semibold text-hampton-navy hover:bg-hampton-navy hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-hampton-blue"
            >
              Text us
            </a>
            <a
              href={`tel:${phone}`}
              className="flex h-11 flex-1 items-center justify-center rounded-full border border-hampton-navy px-3 text-sm font-semibold text-hampton-navy hover:bg-hampton-navy hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-hampton-blue"
            >
              Call
            </a>
          </div>

          <form
            onSubmit={e => { e.preventDefault(); void send() }}
            className="flex items-end gap-2 border-t border-gray-200 bg-white px-3 py-3 sm:rounded-b-2xl"
          >
            <label htmlFor="hh-chat-input" className="sr-only">Your message</label>
            <textarea
              id="hh-chat-input"
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value.slice(0, MAX_INPUT))}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) void send() }
              }}
              rows={2}
              maxLength={MAX_INPUT}
              placeholder="Ask about a party, a date or a price…"
              className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-base text-hampton-navy focus:border-hampton-blue focus:outline-none focus:ring-2 focus:ring-hampton-blue"
            />
            <button
              type="submit"
              disabled={!canSend}
              className="h-11 shrink-0 rounded-full bg-hampton-navy px-5 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-4 focus-visible:ring-hampton-blue"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  )
}

function Bubble({
  m, origins, confirming, onConfirm,
}: {
  m: UiMessage
  origins: readonly string[]
  confirming: string | null
  onConfirm: (c: BookingCardData) => void
}) {
  const mine = m.role === 'user'
  return (
    <div className={`flex flex-col gap-2 ${mine ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
          mine ? 'rounded-br-sm bg-hampton-navy text-white' : 'rounded-bl-sm bg-white text-hampton-navy'
        }`}
      >
        {mine
          ? m.text
          : linkSegments(m.text, origins).map((s, i) =>
              s.kind === 'link' ? (
                <a key={i} href={s.href} className="font-semibold underline" target="_blank" rel="noopener noreferrer">{s.text}</a>
              ) : (
                <span key={i}>{s.text}</span>
              ),
            )}
      </div>

      {m.cards?.map((c, i) =>
        c.type === 'photos' ? (
          <PhotoCarousel key={i} card={c} origins={origins} />
        ) : (
          <BookingCard key={i} card={c} busy={confirming === c.token} disabled={!!confirming} onConfirm={onConfirm} />
        ),
      )}

      {m.booked && <BookedPanel b={m.booked} origins={origins} />}
    </div>
  )
}

function PhotoCarousel({ card, origins }: { card: PhotosCard; origins: readonly string[] }) {
  const more = onSitePath(card.moreUrl, origins) ?? '/gallery'
  const photos = card.photos.map(p => ({ src: imageSrc(p.url), alt: p.alt })).filter((p): p is { src: string; alt: string } => !!p.src)
  if (photos.length === 0) return null
  return (
    <div className="w-full max-w-[96%]">
      <ul
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2"
        aria-label="Party photos"
        tabIndex={0}
      >
        {photos.map((p, i) => (
          <li key={i} className="w-48 shrink-0 snap-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.src} alt={p.alt} loading="lazy" decoding="async" className="h-48 w-48 rounded-xl object-cover" />
          </li>
        ))}
      </ul>
      <a href={more} className="text-sm font-semibold text-hampton-navy underline">See more photos</a>
    </div>
  )
}

function BookingCard({
  card, busy, disabled, onConfirm,
}: {
  card: BookingCardData
  busy: boolean
  disabled: boolean
  onConfirm: (c: BookingCardData) => void
}) {
  return (
    <section aria-label="Booking summary" className="w-full max-w-[96%] rounded-2xl border border-hampton-blue bg-white p-4 shadow-sm">
      <h3 className="text-base font-semibold text-hampton-navy">{card.title}</h3>
      <p className="text-sm text-gray-700">{formatDate(card.date)} &middot; {card.guests} guests</p>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
        {card.lines.slice(0, 12).map((l, i) => <li key={i}>{l}</li>)}
      </ul>
      <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-gray-600">Total</dt>
        <dd className="text-right font-semibold text-hampton-navy">{card.total}</dd>
        <dt className="text-gray-600">Deposit to hold the date</dt>
        <dd className="text-right font-semibold text-hampton-navy">{card.deposit}</dd>
      </dl>
      <button
        type="button"
        onClick={() => onConfirm(card)}
        disabled={disabled}
        className="mt-3 h-12 w-full rounded-full bg-hampton-navy px-4 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-hampton-blue"
      >
        {busy ? 'Saving your plan…' : 'Book it & see my invoice'}
      </button>
      <p className="mt-2 text-xs text-gray-600">Nothing is booked or charged until you tap. The date is held once the deposit is paid on your secure invoice page.</p>
    </section>
  )
}

function BookedPanel({ b, origins }: { b: BookedInfo; origins: readonly string[] }) {
  const href = b.invoiceUrl ? sameOriginUrl(b.invoiceUrl, origins) : null
  return (
    <section aria-label="Your plan" className="w-full max-w-[96%] rounded-2xl border border-green-600 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-hampton-navy">Plan {b.bookingRef} &middot; total {b.total} &middot; deposit {b.deposit}</p>
      {href ? (
        <a
          href={href}
          className="mt-3 flex h-12 w-full items-center justify-center rounded-full bg-hampton-navy px-4 text-sm font-semibold text-white hover:bg-black focus:outline-none focus-visible:ring-4 focus-visible:ring-hampton-blue"
        >
          Open my invoice &amp; pay the deposit
        </a>
      ) : (
        <p className="mt-2 text-sm text-red-800">I couldn&apos;t create your invoice link just now. Your plan is saved — tap Text us and we&apos;ll send it.</p>
      )}
      <p className="mt-2 text-xs text-gray-700">
        {b.emailSent
          ? <>We emailed this link to <strong>{b.emailedTo}</strong>. If it doesn&apos;t arrive, check that address and tell us.</>
          : <>We couldn&apos;t email the link to <strong>{b.emailedTo}</strong>. Save this one, or tap Text us and we&apos;ll resend it.</>}
      </p>
    </section>
  )
}
