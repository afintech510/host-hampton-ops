/**
 * The booking card: a SERVER-SIGNED statement of exactly what clicking "Book it"
 * will create.
 *
 * The model never books anything. Its `propose_booking` tool returns one of
 * these, the widget shows it with a button, and only that click — a POST to
 * `/api/chat/confirm` carrying the token — carries it out. So "the assistant
 * booked it" always means "a visitor pressed a button on a card that showed them
 * the price, the date and the deposit".
 *
 * The token is the card itself, HMAC-signed (the same construction as
 * lib/assistant/proposals.ts), which is why nothing the browser sends back is
 * trusted except a token we minted:
 *
 *   * the prices inside it are the QUOTE ENGINE's, computed on the server in the
 *     same request that minted it — altering one byte fails the signature;
 *   * it is bound to the chat SESSION (another visitor's token, or one lifted
 *     from a transcript, names another session and is refused);
 *   * it expires in 30 minutes — a stale card is re-proposed, not replayed;
 *   * it is single-use: in memory here (a double-click inside this container) and
 *     durably in `chat_sessions.claimed_card_id` (survives a deploy).
 *
 * Re-pricing at confirm time is the second layer: if the price list changed
 * between the proposal and the click, `confirm` re-quotes the stored selection
 * and refuses a card whose total no longer matches (`price_changed`).
 */

import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { portalSigningSecret } from '@/lib/portalAuth'
import type { QuoteLineItem } from '@/lib/quoteEngine'
import { CARD_TTL_MS } from '@/lib/chat/config'

export interface CardSelection {
  /** The theme NAME the engine matched. */
  theme: string
  guests: number
  mini: boolean
  /** Names the engine matched, in the order the visitor prefers them. */
  activities: string[]
  addOns: string[]
}

export interface BookingCard {
  v: 1
  /** Random id; also the single-use key. */
  id: string
  /** The chat session this card belongs to. */
  sid: string
  /** Epoch ms. */
  exp: number
  contact: { name: string; email: string; phone: string }
  /** YYYY-MM-DD */
  date: string
  /** HH:mm or null */
  time: string | null
  childName: string | null
  childAge: number | null
  selection: CardSelection
  /** The guest count the engine PRICED (a Mini Party prices a different count than was typed). */
  guestsPriced: number
  /** The engine's line items, exactly as they will be written. */
  lineItems: QuoteLineItem[]
  totalCents: number
  depositCents: number
}

const NS = 'chat-card:'

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function sign(payload: string, secret: string): string {
  return b64url(createHmac('sha256', `${NS}${secret}`).update(payload).digest())
}

export function mintCard(
  c: Omit<BookingCard, 'v' | 'id' | 'exp'>,
  opts: { now?: number; secret?: string } = {},
): { card: BookingCard; token: string } {
  const card: BookingCard = { v: 1, ...c, id: randomUUID(), exp: (opts.now ?? Date.now()) + CARD_TTL_MS }
  const payload = b64url(Buffer.from(JSON.stringify(card), 'utf8'))
  return { card, token: `${payload}.${sign(payload, opts.secret ?? portalSigningSecret())}` }
}

export type VerifyCard =
  | { ok: true; card: BookingCard }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_session' | 'already_used' }

export function verifyCard(
  token: unknown,
  sessionId: string,
  opts: { now?: number; secret?: string } = {},
): VerifyCard {
  if (typeof token !== 'string' || token.length > 30_000) return { ok: false, reason: 'malformed' }
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return { ok: false, reason: 'malformed' }
  const payload = token.slice(0, dot)
  const given = Buffer.from(token.slice(dot + 1))
  const expected = Buffer.from(sign(payload, opts.secret ?? portalSigningSecret()))
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'bad_signature' }

  let card: BookingCard
  try {
    card = JSON.parse(fromB64url(payload).toString('utf8')) as BookingCard
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!card || card.v !== 1 || typeof card.id !== 'string' || typeof card.exp !== 'number' || typeof card.sid !== 'string') {
    return { ok: false, reason: 'malformed' }
  }
  if ((opts.now ?? Date.now()) > card.exp) return { ok: false, reason: 'expired' }
  if (card.sid !== sessionId) return { ok: false, reason: 'wrong_session' }
  if (usedCards().has(card.id)) return { ok: false, reason: 'already_used' }
  return { ok: true, card }
}

/*
 * Single-use, in memory. A token outlives a deploy by at most CARD_TTL_MS and the
 * durable claim in chat_sessions covers that gap; entries are evicted once their
 * card could no longer verify, so the map cannot grow without bound.
 */
const g = globalThis as unknown as { __hhChatUsedCards?: Map<string, number> }
function usedCards(): Map<string, number> {
  if (!g.__hhChatUsedCards) g.__hhChatUsedCards = new Map()
  return g.__hhChatUsedCards
}

/** Claim a card. False if it was already claimed (a double-click). */
export function markCardUsed(c: Pick<BookingCard, 'id' | 'exp'>, now = Date.now()): boolean {
  const store = usedCards()
  store.forEach((exp, id) => {
    if (exp < now) store.delete(id)
  })
  if (store.has(c.id)) return false
  store.set(c.id, c.exp)
  return true
}

/** Release a claim when nothing happened, so the visitor can click again. */
export function releaseCardUsed(id: string): void {
  usedCards().delete(id)
}
