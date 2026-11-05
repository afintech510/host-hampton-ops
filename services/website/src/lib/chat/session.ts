/**
 * Chat sessions: the signed token the browser holds, and the row the server holds.
 *
 * The browser keeps ONLY `<session id>.<hmac>`. The conversation, the verified
 * flag, the turn count and the money spent live in `chat_sessions` (migration
 * 085), so nothing a visitor can edit in their own tab ever reaches the model as
 * "history". The HMAC is a cheap pre-filter, not the authority: a forged or
 * mangled token is refused without a database read, and a well-formed one still
 * has to name a row that exists, has not expired, and was verified.
 *
 * Every read here has THREE outcomes (found / missing / unavailable). A chat
 * that cannot read its own session must not start a fresh one and must not carry
 * on without the history — it says it cannot, and the visitor is offered the
 * phone.
 */

import { createHmac, timingSafeEqual } from 'crypto'
import { getSupabase } from '@/lib/supabase'
import { portalSigningSecret } from '@/lib/portalAuth'
import type { LlmMessage } from '@/lib/ai/provider'

type Supa = ReturnType<typeof getSupabase>

const SESSION_NS = 'chat-session:'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function mac(ns: string, value: string, secret: string): string {
  return b64url(createHmac('sha256', `${ns}${secret}`).update(value).digest())
}

export function signSessionToken(id: string, secret: string = portalSigningSecret()): string {
  return `${id}.${mac(SESSION_NS, id, secret)}`
}

/** The session id a token names, or null for anything that is not exactly a token we minted. */
export function verifySessionToken(token: unknown, secret: string = portalSigningSecret()): string | null {
  if (typeof token !== 'string' || token.length > 200) return null
  const dot = token.indexOf('.')
  if (dot !== 36) return null
  const id = token.slice(0, dot)
  if (!UUID_RE.test(id)) return null
  const given = Buffer.from(token.slice(dot + 1))
  const expected = Buffer.from(mac(SESSION_NS, id, secret))
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  return id.toLowerCase()
}

/** A short keyed hash of the caller address: enough to tell two abusers apart in a table, useless as an address. */
export function callerHash(key: string, secret: string = portalSigningSecret()): string {
  return mac('chat-caller:', key, secret).slice(0, 16)
}

export interface ChatSession {
  id: string
  status: 'active' | 'booked' | 'inquiry' | 'closed'
  verified: boolean
  turnCount: number
  spentUsd: number
  messages: LlmMessage[]
  bookingRef: string | null
  bookingId: string | null
  claimedCardId: string | null
  inquirySentAt: string | null
}

const COLUMNS =
  'id, status, verified_at, turn_count, spent_usd, messages, booking_ref, booking_id, claimed_card_id, inquiry_sent_at, expires_at'

type Row = {
  id: string
  status: ChatSession['status']
  verified_at: string | null
  turn_count: number
  spent_usd: number | string
  messages: unknown
  booking_ref: string | null
  booking_id: string | null
  claimed_card_id: string | null
  inquiry_sent_at: string | null
  expires_at: string
}

function fromRow(r: Row): ChatSession {
  return {
    id: r.id,
    status: r.status,
    verified: !!r.verified_at,
    turnCount: r.turn_count,
    spentUsd: Number(r.spent_usd) || 0,
    messages: Array.isArray(r.messages) ? (r.messages as LlmMessage[]) : [],
    bookingRef: r.booking_ref,
    bookingId: r.booking_id,
    claimedCardId: r.claimed_card_id,
    inquirySentAt: r.inquiry_sent_at,
  }
}

export type LoadSession = { kind: 'found'; session: ChatSession } | { kind: 'missing' } | { kind: 'unavailable'; error: string }

export async function loadSession(supabase: Supa, id: string, now: Date = new Date()): Promise<LoadSession> {
  const { data, error } = await supabase.from('chat_sessions').select(COLUMNS).eq('id', id).maybeSingle()
  if (error) return { kind: 'unavailable', error: error.message }
  if (!data) return { kind: 'missing' }
  const row = data as unknown as Row
  if (new Date(row.expires_at).getTime() < now.getTime()) return { kind: 'missing' }
  return { kind: 'found', session: fromRow(row) }
}

export type CreateSession = { kind: 'created'; session: ChatSession } | { kind: 'unavailable'; error: string }

/** A new session. Only ever called AFTER Turnstile passed (or is unconfigured outside production). */
export async function createSession(
  supabase: Supa,
  opts: { callerHash: string; pagePath: string | null; verified: boolean },
): Promise<CreateSession> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({
      caller_hash: opts.callerHash,
      page_path: opts.pagePath,
      verified_at: opts.verified ? new Date().toISOString() : null,
    })
    .select(COLUMNS)
    .single()
  if (error || !data) return { kind: 'unavailable', error: error?.message ?? 'no row returned' }
  return { kind: 'created', session: fromRow(data as unknown as Row) }
}

/**
 * Persist one finished turn — only if no other turn got there first.
 *
 * Compare-and-swap on `turn_count`: two tabs sending at once both read N, and
 * exactly one write matches `turn_count = N`. The loser gets `conflict` and the
 * visitor is told to send again, rather than the second turn silently erasing
 * the first from the history.
 */
export async function saveTurn(
  supabase: Supa,
  session: ChatSession,
  turn: { messages: LlmMessage[]; spentUsd: number },
): Promise<'ok' | 'conflict' | 'failed'> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .update({
      messages: turn.messages,
      turn_count: session.turnCount + 1,
      spent_usd: session.spentUsd + turn.spentUsd,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id)
    .eq('turn_count', session.turnCount)
    .select('id')
  if (error) {
    console.error('chat: could not save a turn:', error.message)
    return 'failed'
  }
  return (data ?? []).length === 1 ? 'ok' : 'conflict'
}

/**
 * Take the one booking this session may make. Returns true to the single caller
 * that wins; the claim is the DURABLE single-use (the in-memory set resets on a
 * deploy). Released with `releaseCard` when the booking did not happen.
 */
export async function claimCard(supabase: Supa, sessionId: string, cardId: string): Promise<'claimed' | 'taken' | 'failed'> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .update({ claimed_card_id: cardId, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .is('claimed_card_id', null)
    .is('booking_ref', null)
    .select('id')
  if (error) {
    console.error('chat: could not claim a booking card:', error.message)
    return 'failed'
  }
  return (data ?? []).length === 1 ? 'claimed' : 'taken'
}

export async function releaseCard(supabase: Supa, sessionId: string, cardId: string): Promise<void> {
  const { error } = await supabase
    .from('chat_sessions')
    .update({ claimed_card_id: null, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('claimed_card_id', cardId)
    .is('booking_ref', null)
  if (error) console.error('chat: could not release a booking card claim:', error.message)
}

/** Link the finished booking to its transcript. A failure is logged and non-fatal: the booking stands. */
export async function markBooked(
  supabase: Supa,
  sessionId: string,
  b: { bookingRef: string; bookingId: string | null; name: string; email: string },
): Promise<boolean> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .update({
      status: 'booked',
      booking_ref: b.bookingRef,
      booking_id: b.bookingId,
      contact_name: b.name.slice(0, 200),
      contact_email: b.email.slice(0, 200),
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .select('id')
  if (error || (data ?? []).length !== 1) {
    console.error(`chat: booking ${b.bookingRef} was made but not linked to session ${sessionId}:`, error?.message ?? 'no row matched')
    return false
  }
  return true
}

/** One start_inquiry per session. */
export async function claimInquiry(supabase: Supa, sessionId: string): Promise<'claimed' | 'taken' | 'failed'> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .update({ inquiry_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .is('inquiry_sent_at', null)
    .select('id')
  if (error) {
    console.error('chat: could not claim the inquiry slot:', error.message)
    return 'failed'
  }
  return (data ?? []).length === 1 ? 'claimed' : 'taken'
}

export async function releaseInquiry(supabase: Supa, sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('chat_sessions')
    .update({ inquiry_sent_at: null, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
  if (error) console.error('chat: could not release the inquiry slot:', error.message)
}

export async function markInquiry(supabase: Supa, sessionId: string, c: { name: string; email: string }): Promise<void> {
  const { error } = await supabase
    .from('chat_sessions')
    .update({ status: 'inquiry', contact_name: c.name.slice(0, 200), contact_email: c.email.slice(0, 200), updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('status', 'active')
  if (error) console.error('chat: could not mark the session as an inquiry:', error.message)
}

/** The persisted form of a history: thinking blocks out (they are large and only valid inside the turn that made them). */
export function persistable(messages: LlmMessage[]): LlmMessage[] {
  return messages.map(m => {
    if (typeof m.content === 'string') return m
    return { ...m, content: m.content.filter(b => b.type !== 'thinking' && b.type !== 'redacted_thinking') }
  }).filter(m => typeof m.content === 'string' || m.content.length > 0)
}
