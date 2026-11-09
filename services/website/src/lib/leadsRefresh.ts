import type { getSupabase } from '@/lib/supabase'
import { etToday } from '@/lib/bookingStatus'
import { normalizePhoneKey } from '@/lib/contactLookup'
import { recordInboundEventResult } from '@/lib/agent/events'
import { smsKeywordIntent } from '@/lib/smsOptOut'
import { fetchQuoThread, listRecentQuoConversations, type QuoConversation, type QuoThread } from '@/lib/quo'

/**
 * The Refresh button on the Leads screen, text half: catch up on texts the webhook did not give us.
 *
 * Inbound texts arrive by Quo's webhook one at a time, and a text Allie sends by hand from the Quo
 * app arrives by nothing at all, so "waiting on us" can be wrong in either direction. This reads
 * Quo's own record for the leads and the upcoming bookings and writes down what is missing.
 *
 * It is a catch-up, not a second pipeline:
 *   - written as `ignored`, so the booking agent never drafts a reply to an old text;
 *   - deduped on the same `quo:<message id>` the webhook uses, so a text the webhook already
 *     recorded is skipped and one recorded here is skipped by the webhook's redelivery;
 *   - it never changes opt-in state. A STOP the webhook missed is COUNTED and reported, because
 *     honouring it is a compliance action for a person to take, not a side effect of a refresh.
 *
 * Only conversations with a number that belongs to one of these bookings are read, so a refresh
 * costs a handful of Quo calls rather than one per lead. Read only toward Quo: nothing is sent.
 */

type Supa = ReturnType<typeof getSupabase>

/** How far back to look for conversations. A webhook outage longer than this needs a human. */
export const REFRESH_WINDOW_DAYS = 14
const MAX_THREADS = 40
const THREAD_LIMIT = 30
/** Quo allows about 10 requests a second and answers 429 past it; four reads at once tripped it (7-12 of 21 failed). One at a time, with a breath between. */
const PAUSE_MS = 150
const RETRY_AFTER_MS = 1500
const IN_CHUNK = 100

export interface TextRefresh {
  /** Conversations with a lead or booking that were read. */
  checked: number
  newInbound: number
  newOutbound: number
  /** New inbound texts that are a bare STOP/CANCEL/UNSUBSCRIBE: they need a person. */
  stops: number
  /** Set when Quo could not be read or is not set up; the counts are then not to be trusted. */
  unavailable?: string
  /** True when more conversations matched than one refresh reads. */
  more?: boolean
}

interface Target {
  bookingId: string
  phone: string
  createdAt: string
}

export interface TextRefreshDeps {
  listConversations: (sinceIso: string) => Promise<QuoConversation[] | null>
  fetchThread: (phone: string, opts: { limit: number }) => Promise<QuoThread>
  /** Wait; replaced in tests. */
  sleep?: (ms: number) => Promise<void>
}

const realDeps: TextRefreshDeps = { listConversations: listRecentQuoConversations, fetchThread: fetchQuoThread }
const realSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** The bookings worth watching: not closed out, and upcoming or not dated yet. */
async function loadTargets(sb: Supa, today: string): Promise<Target[] | null> {
  const { data, error } = await sb
    .from('bookings')
    .select('id, contact_phone, party_date, created_at')
    .not('contact_phone', 'is', null)
    .not('status', 'in', '("cancelled","lost","completed")')
    .order('created_at', { ascending: false })
    .limit(600)
  if (error) return null
  // Upcoming or not dated yet; cut here rather than in the query so no filter is built from text.
  return ((data ?? []) as Array<{ id: string; contact_phone: string | null; party_date: string | null; created_at: string }>)
    .filter(r => r.contact_phone && (!r.party_date || r.party_date >= today))
    .map(r => ({ bookingId: r.id, phone: r.contact_phone as string, createdAt: r.created_at }))
}

async function alreadyRecorded(sb: Supa, externalIds: string[]): Promise<Set<string> | null> {
  const seen = new Set<string>()
  for (let i = 0; i < externalIds.length; i += IN_CHUNK) {
    const { data, error } = await sb.from('ingested_messages').select('external_id').in('external_id', externalIds.slice(i, i + IN_CHUNK))
    // A failed read is not "none recorded": it would write every message a second time.
    if (error) return null
    for (const r of (data ?? []) as Array<{ external_id: string }>) seen.add(r.external_id)
  }
  return seen
}

export async function refreshQuoTexts(sb: Supa, now: Date = new Date(), deps: TextRefreshDeps = realDeps): Promise<TextRefresh> {
  const out: TextRefresh = { checked: 0, newInbound: 0, newOutbound: 0, stops: 0 }

  const targets = await loadTargets(sb, etToday(now))
  if (!targets) return { ...out, unavailable: 'Could not read the bookings.' }
  // Newest booking wins when one number has several: that is the one in play.
  const byKey = new Map<string, Target>()
  for (const t of targets) {
    const key = normalizePhoneKey(t.phone)
    if (key && !byKey.has(key)) byKey.set(key, t)
  }
  if (byKey.size === 0) return out

  const since = new Date(now.getTime() - REFRESH_WINDOW_DAYS * 86_400_000).toISOString()
  const conversations = await deps.listConversations(since)
  if (!conversations) return { ...out, unavailable: 'Could not read the conversations in Quo.' }

  const matched: Target[] = []
  const used = new Set<string>()
  for (const c of conversations) {
    for (const p of c.participants) {
      const key = normalizePhoneKey(p)
      const hit = key ? byKey.get(key) : undefined
      if (hit && !used.has(key)) {
        used.add(key)
        matched.push(hit)
      }
    }
  }
  const batch = matched.slice(0, MAX_THREADS)
  if (matched.length > batch.length) out.more = true

  const sleep = deps.sleep ?? realSleep
  const threads: Array<{ target: Target; thread: QuoThread }> = []
  for (const target of batch) {
    let thread = await deps.fetchThread(target.phone, { limit: THREAD_LIMIT })
    // Rate limited: wait it out and ask once more rather than report a thread we could have read.
    if (thread.kind === 'unavailable' && thread.reason.includes('429')) {
      await sleep(RETRY_AFTER_MS)
      thread = await deps.fetchThread(target.phone, { limit: THREAD_LIMIT })
    }
    threads.push({ target, thread })
    await sleep(PAUSE_MS)
  }

  let failed = 0
  let firstReason = ''
  const wanted: Array<{ target: Target; m: Extract<QuoThread, { kind: 'ok' }>['messages'][number] }> = []
  for (const { target, thread } of threads) {
    if (thread.kind !== 'ok') { failed++; if (!firstReason && thread.kind === 'unavailable') firstReason = thread.reason; continue }
    out.checked++
    for (const m of thread.messages) if (m.id && m.at >= since) wanted.push({ target, m })
  }
  if (failed > 0) out.unavailable = `${failed} of ${batch.length} conversations could not be read${firstReason ? ` (${firstReason.replace(/\.$/, '')})` : ''}.`

  const seen = await alreadyRecorded(sb, wanted.map(w => `quo:${w.m.id}`))
  if (!seen) return { ...out, unavailable: 'Could not check which texts are already recorded.' }

  for (const { target, m } of wanted) {
    if (seen.has(`quo:${m.id}`)) continue
    const inbound = m.direction === 'in'
    const body = m.text || (m.hasMedia ? '[photo or file]' : '')
    const res = await recordInboundEventResult({
      supabase: sb,
      route: 'leads-refresh',
      source: 'quo',
      externalId: `quo:${m.id}`,
      bookingId: target.bookingId,
      direction: inbound ? 'in' : 'out',
      fromAddress: inbound ? target.phone : null,
      toAddress: inbound ? null : target.phone,
      body,
      sentAt: m.at,
      needsAction: false,
      classification: inbound ? 'sms_inbound' : null,
      parsed: { provider: 'quo', message_id: m.id, via: 'leads-refresh' },
    })
    if (res.kind === 'failed') { out.unavailable = out.unavailable ?? 'Some texts could not be saved.'; continue }
    if (res.kind === 'duplicate') continue
    if (inbound) {
      out.newInbound++
      if (smsKeywordIntent(m.text) === 'stop') out.stops++
    } else {
      out.newOutbound++
    }
  }
  return out
}
