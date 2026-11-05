import type { getSupabase } from '@/lib/supabase'
import type { MessagePreview } from './messageCard'

/**
 * Persisted assistant conversations (migration 084, `assistant_threads`).
 *
 * One thread per admin per context (`general`, or `booking:<ref>`), so closing
 * the drawer on an invoice and opening it tomorrow resumes the conversation that
 * is about that party. Two documents are kept:
 *
 *   * `messages` — the model-facing history, exactly as the tool loop returned it.
 *   * `lines`    — what the UI draws: text bubbles and confirm CARDS with their
 *                  state (pending / done / failed / dismissed / expired).
 *
 * The server owns both. The browser sends a message, not a history, so a stale
 * tab cannot overwrite a newer conversation and a tampered history cannot reach
 * the model. (Nothing in a history can cause a write anyway — writes need a
 * server-minted, actor-bound, single-use token — but the server owning it keeps
 * that property from resting on the browser.)
 *
 * Threads are keyed by ACTOR, so one admin can never read another's.
 */

type Supa = ReturnType<typeof getSupabase>

export type CardState = 'pending' | 'working' | 'done' | 'failed' | 'dismissed' | 'expired'

export interface ThreadCard {
  id: string
  title: string
  details: string[]
  token: string
  kind: string
  state: CardState
  /** Epoch ms the signed token stops verifying. */
  expiresAt: number
  photos?: { id: string; url: string; alt: string }[]
  /** A message card's exact wording, recipient and send status. Display only. */
  message?: MessagePreview
  result?: string
  links?: { label: string; url: string }[]
}

export interface ThreadLine {
  role: 'user' | 'assistant' | 'note'
  text: string
  cards?: ThreadCard[]
}

export interface Thread {
  id: string
  messages: unknown[]
  lines: ThreadLine[]
}

export type ThreadRead = { kind: 'ok'; thread: Thread | null } | { kind: 'unavailable'; error: string }

/** A thread's lines never keep more than this many; older ones fall off the DISPLAY only. */
const MAX_LINES = 200

export async function readThread(sb: Supa, actor: string, key: string): Promise<ThreadRead> {
  const { data, error } = await sb
    .from('assistant_threads')
    .select('id, messages, lines')
    .eq('actor', actor)
    .eq('context_key', key)
    .maybeSingle()
  if (error) return { kind: 'unavailable', error: error.message }
  if (!data) return { kind: 'ok', thread: null }
  const row = data as { id: string; messages: unknown; lines: unknown }
  return {
    kind: 'ok',
    thread: {
      id: row.id,
      messages: Array.isArray(row.messages) ? row.messages : [],
      lines: Array.isArray(row.lines) ? (row.lines as ThreadLine[]) : [],
    },
  }
}

/** Pending cards whose token has stopped verifying are shown as expired, never as confirmable. */
export function expireStaleCards(lines: ThreadLine[], now = Date.now()): ThreadLine[] {
  return lines.map(l =>
    l.cards
      ? { ...l, cards: l.cards.map(c => (c.state === 'pending' && c.expiresAt < now ? { ...c, state: 'expired' as const } : c)) }
      : l,
  )
}

/**
 * Cards that a reworded one replaced stop being confirmable on screen. Only a
 * card still PENDING is touched — one already sent keeps its result.
 */
export function retireReplacedCards(lines: ThreadLine[], ids: ReadonlySet<string>): ThreadLine[] {
  if (ids.size === 0) return lines
  return lines.map(l =>
    l.cards
      ? {
          ...l,
          cards: l.cards.map(c =>
            ids.has(c.id) && c.state === 'pending'
              ? { ...c, state: 'dismissed' as const, result: 'Replaced by the reworded message below.' }
              : c,
          ),
        }
      : l,
  )
}

export async function writeThread(
  sb: Supa,
  actor: string,
  key: string,
  bookingRef: string | null,
  messages: unknown[],
  lines: ThreadLine[],
): Promise<boolean> {
  const { error } = await sb.from('assistant_threads').upsert(
    {
      actor,
      context_key: key,
      booking_ref: bookingRef,
      messages,
      lines: lines.slice(-MAX_LINES),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'actor,context_key' },
  )
  if (error) {
    console.error('assistant: thread not saved:', error.message)
    return false
  }
  return true
}

export async function deleteThread(sb: Supa, actor: string, key: string): Promise<boolean> {
  const { error } = await sb.from('assistant_threads').delete().eq('actor', actor).eq('context_key', key)
  return !error
}

/**
 * Record what happened to a card (the confirm route calls this), and tell the
 * model about it in the history so its next answer is about the world as it now
 * is rather than as it was when the card was drawn. Best-effort: the action has
 * already happened (or been refused), so a thread that cannot be updated is
 * logged, never fatal.
 */
export async function recordCardOutcome(
  sb: Supa,
  actor: string,
  key: string,
  bookingRef: string | null,
  card: { id: string; title: string },
  outcome: { state: 'done' | 'failed'; message: string; links?: { label: string; url: string }[] },
): Promise<void> {
  const read = await readThread(sb, actor, key)
  if (read.kind !== 'ok' || !read.thread) return
  const lines = read.thread.lines.map(l =>
    l.cards
      ? {
          ...l,
          cards: l.cards.map(c =>
            c.id === card.id ? { ...c, state: outcome.state, result: outcome.message, links: outcome.links ?? [] } : c,
          ),
        }
      : l,
  )
  const messages = [
    ...read.thread.messages,
    {
      role: 'user',
      content: `[Manager ${outcome.state === 'done' ? 'confirmed' : 'tried to confirm'} "${card.title}". Result: ${outcome.message}]`,
    },
  ]
  await writeThread(sb, actor, key, bookingRef, messages, lines)
}

/**
 * The manager dismissed a card: say so in both documents. The title is read from
 * the STORED card, never taken from the request, so nothing the browser sends
 * reaches the model's history.
 */
export async function recordCardDismissed(
  sb: Supa,
  actor: string,
  key: string,
  bookingRef: string | null,
  cardId: string,
): Promise<void> {
  const read = await readThread(sb, actor, key)
  if (read.kind !== 'ok' || !read.thread) return
  let title = ''
  const lines = read.thread.lines.map(l =>
    l.cards
      ? {
          ...l,
          cards: l.cards.map(c => {
            if (c.id !== cardId) return c
            title = c.title
            return { ...c, state: 'dismissed' as const }
          }),
        }
      : l,
  )
  if (!title) return
  const messages = [
    ...read.thread.messages,
    { role: 'user', content: `[Manager dismissed "${title}" — it was not done.]` },
  ]
  await writeThread(sb, actor, key, bookingRef, messages, lines)
}
