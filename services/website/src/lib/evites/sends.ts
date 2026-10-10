/**
 * The evite send ledger (spec §1 `evite_sends`, §2 `sends.ts`, §9.3).
 *
 *   claimSend(supabase, key)             INSERT; the unique index says "already done"
 *   reclaimFailed(supabase, { limit })   failed (attempts < 4) and stuck `sending` rows -> `sending` again
 *   finishSend(supabase, id, outcome, claim)   the ONLY writer of `sent` / `failed` / `skipped`
 *
 * CLAIM BEFORE SEND (principle 4). Every outbound evite email is first an INSERT into
 * `evite_sends` under `uniq_evite_send_once (evite_id, rsvp_id, send_type, ref_version,
 * channel) NULLS NOT DISTINCT`. Postgres lets exactly one of N concurrent callers win it,
 * so a redelivered request, two overlapping cron ticks, or the inline hook racing the
 * cron cannot send the same message twice. `ref_version` is the calendar version (or
 * RSVP revision) the message DESCRIBES, so "the party moved" is a different key and a
 * new message, while "the same tick ran twice" is the same key and no message.
 *
 * THREE OUTCOMES (rule 12). A claim is `claimed`, `duplicate` (the index refused it:
 * somebody already owns this message, skip) or `unavailable` (the INSERT failed for any
 * other reason: we do not know whether it is owned, and the one direction that must not
 * happen is sending anyway). Only the unique-index violation is "duplicate"; a 23505
 * from anything else is `unavailable`, because reading it as "already sent" would drop
 * a message.
 *
 * `finishSend` IS THE ONLY WRITER OF A TERMINAL STATUS. Every path through the sender
 * ends there, so the ledger cannot say `sent` over an email that did not go (the old
 * reminder code wrote `sent` unconditionally). It always reads `{error}`, it is
 * conditional on the row still being `sending` (a worker that lost its claim to a
 * reclaim cannot overwrite the new owner), and it reads the row back. `reclaimFailed`
 * and `claimSend` write `sending` only; the source rule in `evitesMailSurface.test.ts`
 * holds that line.
 *
 * Retry budget: 4 attempts in all (the first send counts). A `sending` row older than
 * 15 minutes has lost its worker and is treated as failed. A stuck row that has used
 * its attempts is finished `failed` rather than retried again. The ledger keeps the
 * evidence; nothing is deleted.
 *
 * The honest limit: a worker that dies AFTER Resend accepted the message and BEFORE
 * `finishSend` leaves a `sending` row that is reclaimed at 15 minutes and sent again.
 * `finishSend` retries its own write once to make that window small; it cannot close it
 * without a provider idempotency key (spec accepts this).
 */

import type { getSupabase } from '@/lib/supabase'
import type { EviteSendType } from '@/lib/evites/types'

type Supa = ReturnType<typeof getSupabase>

/** 4 attempts in all. A send that has failed this many times stays `failed`. */
export const MAX_SEND_ATTEMPTS = 4
/** A `sending` row older than this has lost its worker (the same figure the admin card shows). */
export const STUCK_SENDING_MS = 15 * 60 * 1000

export const UNIQUE_SEND_INDEX = 'uniq_evite_send_once'

const CLAIM_COLUMNS = 'id, evite_id, rsvp_id, send_type, ref_version, attempts'

export interface SendKey {
  evite_id: string
  /** NULL for a party-level send (lead_preview, invite_ready, final_headcount, ...). */
  rsvp_id: string | null
  send_type: EviteSendType
  ref_version: number
}

/** A ledger row this process now owns: the one thing `performSend` needs. */
export interface ClaimedSend {
  id: string
  evite_id: string
  rsvp_id: string | null
  send_type: EviteSendType
  ref_version: number
  /** 1 for a first send; +1 on every reclaim. */
  attempts: number
}

export type ClaimResult =
  | { kind: 'claimed'; id: string; send: ClaimedSend }
  /** The unique index refused it: the message is already owned. Skip, quietly. */
  | { kind: 'duplicate' }
  /** Rule 12: could not tell. Do NOT send. */
  | { kind: 'unavailable'; error: string }

function toClaimed(r: Record<string, unknown>): ClaimedSend {
  return {
    id: String(r.id),
    evite_id: String(r.evite_id),
    rsvp_id: typeof r.rsvp_id === 'string' ? r.rsvp_id : null,
    send_type: r.send_type as EviteSendType,
    ref_version: Number(r.ref_version) || 0,
    attempts: Number(r.attempts) || 1,
  }
}

export async function claimSend(supabase: Supa, key: SendKey, now: Date = new Date()): Promise<ClaimResult> {
  const { data, error } = await supabase
    .from('evite_sends')
    .insert({
      evite_id: key.evite_id,
      rsvp_id: key.rsvp_id,
      send_type: key.send_type,
      ref_version: key.ref_version,
      channel: 'email',
      status: 'sending',
      attempts: 1,
      claimed_at: now.toISOString(),
    })
    .select(CLAIM_COLUMNS)

  if (error) {
    const e = error as { code?: string; message?: string }
    if (e.code === '23505' && String(e.message ?? '').includes(UNIQUE_SEND_INDEX)) return { kind: 'duplicate' }
    return { kind: 'unavailable', error: e.message ?? 'insert failed' }
  }
  const row = ((data ?? []) as unknown as Array<Record<string, unknown>>)[0]
  if (!row || typeof row.id !== 'string') return { kind: 'unavailable', error: 'claim insert returned no row' }
  const send = toClaimed({ ...row, evite_id: row.evite_id ?? key.evite_id, send_type: row.send_type ?? key.send_type })
  return { kind: 'claimed', id: send.id, send }
}

// ---------------------------------------------------------------- reclaim

export interface ReclaimResult {
  /** Rows now `sending` and owned by this caller; hand each to `performSend`. */
  reclaimed: ClaimedSend[]
  /** Stuck `sending` rows that had used every attempt and were finished `failed`. */
  exhausted: number
  /** One entry per read or write that failed. Non-empty means the sweep was incomplete. */
  errors: string[]
}

/**
 * Take back the sends that need another attempt:
 *   - `failed` with attempts < 4, oldest first;
 *   - `sending` older than 15 minutes (a worker died or hung).
 * Each is flipped to `sending` with `attempts + 1` and a fresh `claimed_at` by a
 * CONDITIONAL update (the status and the attempt count it was read at must still hold)
 * that is read back, so two ticks cannot both reclaim one row. Two plain statements, no
 * `.or()` expression (AGENTS.md §11).
 */
export async function reclaimFailed(supabase: Supa, opts: { limit: number; now?: Date }): Promise<ReclaimResult> {
  const now = opts.now ?? new Date()
  const nowIso = now.toISOString()
  const result: ReclaimResult = { reclaimed: [], exhausted: 0, errors: [] }
  const limit = Math.max(0, Math.floor(opts.limit))
  if (limit === 0) return result

  // ---- A. failed, with attempts left
  const failed = await supabase
    .from('evite_sends')
    .select(CLAIM_COLUMNS)
    .eq('channel', 'email')
    .eq('status', 'failed')
    .lt('attempts', MAX_SEND_ATTEMPTS)
    .order('claimed_at', { ascending: true })
    .limit(limit)
  if (failed.error) {
    result.errors.push(`failed read: ${failed.error.message}`)
  } else {
    for (const row of (failed.data ?? []) as unknown as Array<Record<string, unknown>>) {
      if (result.reclaimed.length >= limit) break
      const attempts = Number(row.attempts) || 1
      const took = await supabase
        .from('evite_sends')
        .update({ status: 'sending', attempts: attempts + 1, claimed_at: nowIso })
        .eq('id', String(row.id))
        .eq('status', 'failed')
        .eq('attempts', attempts)
        .select(CLAIM_COLUMNS)
      if (took.error) {
        result.errors.push(`failed reclaim: ${took.error.message}`)
        continue
      }
      const won = ((took.data ?? []) as unknown as Array<Record<string, unknown>>)[0]
      if (won) result.reclaimed.push(toClaimed(won))
    }
  }

  // ---- B. stuck in `sending`
  const room = limit - result.reclaimed.length
  if (room > 0) {
    const cutoff = new Date(now.getTime() - STUCK_SENDING_MS).toISOString()
    const stuck = await supabase
      .from('evite_sends')
      .select(CLAIM_COLUMNS)
      .eq('channel', 'email')
      .eq('status', 'sending')
      .lt('claimed_at', cutoff)
      .order('claimed_at', { ascending: true })
      .limit(room)
    if (stuck.error) {
      result.errors.push(`stuck read: ${stuck.error.message}`)
    } else {
      for (const row of (stuck.data ?? []) as unknown as Array<Record<string, unknown>>) {
        if (result.reclaimed.length >= limit) break
        const attempts = Number(row.attempts) || 1
        if (attempts >= MAX_SEND_ATTEMPTS) {
          const done = await finishSend(
            supabase,
            String(row.id),
            { kind: 'failed', error: `stuck in sending for over ${Math.round(STUCK_SENDING_MS / 60000)} minutes and out of attempts` },
            { attempts },
            now,
          )
          if (done.ok) result.exhausted += 1
          else result.errors.push(`stuck finish: ${done.reason}`)
          continue
        }
        const took = await supabase
          .from('evite_sends')
          .update({ status: 'sending', attempts: attempts + 1, claimed_at: nowIso })
          .eq('id', String(row.id))
          .eq('status', 'sending')
          .eq('attempts', attempts)
          .lt('claimed_at', cutoff)
          .select(CLAIM_COLUMNS)
        if (took.error) {
          result.errors.push(`stuck reclaim: ${took.error.message}`)
          continue
        }
        const won = ((took.data ?? []) as unknown as Array<Record<string, unknown>>)[0]
        if (won) result.reclaimed.push(toClaimed(won))
      }
    }
  }

  return result
}

// ---------------------------------------------------------------- finish

/**
 * How a claimed send ended.
 *
 *   sent     Resend accepted it (`providerId` is its message id)
 *   failed   it did not go; retriable until MAX_SEND_ATTEMPTS
 *   skipped  a guardrail deliberately stopped it; terminal, and it SAYS WHY
 */
export type SendFinish =
  | { kind: 'sent'; providerId: string }
  | { kind: 'failed'; error: string }
  | { kind: 'skipped'; reason: string }

export type FinishResult = { ok: true } | { ok: false; reason: 'not-sending' | 'write-failed'; error?: string }

const clip = (s: string, n = 500) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * `claim.attempts` is the attempt number THIS worker was handed (1 for a first send, +1 on every reclaim). The write is
 * conditional on it, so a worker that hung past the stuck window and was reclaimed (attempts 2, a second worker now sending)
 * cannot finish the row the new owner holds: its late `sent` / `failed` matches zero rows and reports `not-sending`.
 * The status alone could not say that, because a reclaimed row is `sending` again.
 */
export async function finishSend(
  supabase: Supa,
  id: string,
  outcome: SendFinish,
  claim: { attempts: number },
  now: Date = new Date(),
): Promise<FinishResult> {
  let patch: Record<string, unknown>
  switch (outcome.kind) {
    case 'sent':
      patch = { status: 'sent', outcome: 'sent', provider_id: outcome.providerId, sent_at: now.toISOString(), last_error: null }
      break
    case 'failed':
      patch = { status: 'failed', outcome: 'failed', last_error: clip(outcome.error) }
      break
    case 'skipped':
      patch = { status: 'skipped', outcome: clip(outcome.reason, 200), last_error: null }
      break
  }

  let lastError: string | undefined
  // One retry: a `sent` that fails to record is the window in which a reclaim re-sends it.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { data, error } = await supabase.from('evite_sends').update(patch).eq('id', id).eq('status', 'sending').eq('attempts', claim.attempts).select('id')
    if (error) {
      lastError = error.message
      continue
    }
    const rows = (data ?? []) as unknown as unknown[]
    if (rows.length === 0) return { ok: false, reason: 'not-sending' }
    return { ok: true }
  }
  console.error(`evites/sends: finishSend(${outcome.kind}) could not be recorded for ${id}: ${lastError}`)
  return { ok: false, reason: 'write-failed', error: lastError }
}
