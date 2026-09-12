/**
 * The reminder queue: one way in, one way to claim, one list of what is
 * marketing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS. Before migration 044, `scheduled_reminders` had **never held
 * a single row** — measured in production 2026-09-12, five months after the
 * phase shipped. Four separate enqueue functions each built their own row shape
 * and each threw the insert's error away, so a schema mismatch that Postgres
 * reported every single time was invisible on both sides: the callers logged
 * nothing, and the cron that reads the table found it empty and reported
 * `{processed: 0}` — which is exactly what a healthy idle queue looks like.
 *
 * So the enqueue path is ONE function now, it reads the error, and it
 * distinguishes "already queued" (the dedup index did its job) from "refused".
 */

import type { getSupabase } from '@/lib/supabase'
import { smsSegmentInfo } from '@/lib/smsSegments'

type Supa = ReturnType<typeof getSupabase>

export interface ReminderRow {
  contact_id: string
  reminder_type: string
  /** 'event' | 'booking' — the CHECK allows exactly these two (migration 044). */
  reference_type: 'event' | 'booking'
  /** bookings.booking_ref for 'booking', events.id for 'event'. TEXT. */
  reference_id: string
  scheduled_for: string
  channel: 'email' | 'sms'
}

export type RowOutcome = 'inserted' | 'duplicate' | 'refused'

export interface EnqueueResult {
  inserted: number
  /** Already queued — the unique index refused a second copy. Not an error. */
  duplicate: number
  /** Genuinely refused. Each entry is a reason a human can act on. */
  refused: { reminder_type: string; reason: string }[]
  /**
   * What happened to EACH row, in input order, and the same thing keyed by
   * reminder_type.
   *
   * The aggregate counts alone are not enough for a caller that has to do
   * something per row — charge an SMS budget, say. The first version of the
   * birthday scanner tried to recover that by re-reading the table and treating
   * "created in the last 60 seconds" as "created by this run", and a test that
   * ran the route twice inside one second duly reported two nudges queued when
   * the table had not gained a row. A time window is not a fact; this is.
   */
  outcomes: RowOutcome[]
  byType: Record<string, RowOutcome>
}

/**
 * Insert reminder rows one at a time, tolerating the dedup unique violation.
 *
 * One at a time on purpose: a bulk insert is a single statement, so ONE 23505
 * aborts the whole batch and the other three reminders for that booking are
 * lost with it.
 */
export async function enqueueReminders(supabase: Supa, rows: ReminderRow[]): Promise<EnqueueResult> {
  const result: EnqueueResult = { inserted: 0, duplicate: 0, refused: [], outcomes: [], byType: {} }

  for (const row of rows) {
    const { error } = await supabase.from('scheduled_reminders').insert(row)

    let outcome: RowOutcome
    if (!error) {
      result.inserted++
      outcome = 'inserted'
    } else if ((error as { code?: string }).code === '23505') {
      // unique_violation → uniq_scheduled_reminder_once did its job.
      result.duplicate++
      outcome = 'duplicate'
    } else {
      result.refused.push({ reminder_type: row.reminder_type, reason: error.message })
      console.error('reminderQueue:enqueue refused', row.reminder_type, row.reference_id, error.message)
      outcome = 'refused'
    }

    result.outcomes.push(outcome)
    result.byType[row.reminder_type] = outcome
  }

  return result
}

/* ── What is marketing, in ONE place ───────────────────────────────────────── */

/**
 * Reminder types that are a SOLICITATION rather than a message about something
 * the customer has already bought.
 *
 * This list is the reason the send path re-reads consent. Everything not on it
 * is transactional — a party that is already booked and deposited, an event
 * whose ticket is already paid for — and is sent to the address the customer
 * gave us for exactly that purpose. CAN-SPAM's transactional exemption and the
 * CTIA's equivalent both turn on that distinction, so it is written down once
 * and imported, not re-decided at each call site (hard-won rule 11).
 */
export const MARKETING_REMINDER_TYPES = new Set<string>([
  'birthday_rebook_email',
  'birthday_rebook_sms',
])

export function isMarketingReminder(reminderType: string): boolean {
  return MARKETING_REMINDER_TYPES.has(reminderType)
}

/* ── The claim ─────────────────────────────────────────────────────────────── */

export type ClaimResult =
  | { kind: 'claimed' }
  /** Another tick got there first, or the row is no longer pending. */
  | { kind: 'lost' }
  /** Rule 12: could not tell. Do NOT send. */
  | { kind: 'unavailable'; error: string }

/**
 * Take exclusive ownership of a reminder before sending it.
 *
 * `UPDATE … WHERE id = ? AND status = 'pending'` is atomic: Postgres will let
 * exactly one of N concurrent ticks match the row, and `.select()` hands back
 * the rows that were actually updated. Zero rows back means somebody else won.
 *
 * The claim is taken BEFORE the send, never after. The Phase 4 sequencer needed
 * the same discipline for the same reason: a cron redelivery or two overlapping
 * ticks otherwise texts a real customer twice, and there is no way to un-send an
 * SMS. A row left in 'sending' by a crashed tick is NOT retried — under-sending
 * is the safe direction — but it is visible as 'sending' for a human to find.
 */
export async function claimReminder(supabase: Supa, id: string): Promise<ClaimResult> {
  const { data, error } = await supabase
    .from('scheduled_reminders')
    .update({ status: 'sending', claimed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')

  if (error) return { kind: 'unavailable', error: error.message }
  if (!data || data.length === 0) return { kind: 'lost' }
  return { kind: 'claimed' }
}

/**
 * How a claimed reminder ended.
 *
 *   delivered — it really went to the provider and the provider accepted it
 *   skipped   — a guardrail deliberately stopped it (opt-out, balance already
 *               paid, check-in already complete). Terminal, and it SAYS WHY.
 *   retry     — a transient failure. Goes back to 'pending' with attempts+1
 *               until MAX_ATTEMPTS, then 'failed' (hard-won rule 3).
 *   failed    — permanently wrong (unknown reminder type, missing reference).
 */
export type SendOutcome =
  | { kind: 'delivered'; detail?: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'retry'; reason: string }
  | { kind: 'failed'; reason: string }

export const MAX_ATTEMPTS = 4

/**
 * Write the outcome back. Every path through the sender ends here, so there is
 * no way to leave a row saying 'sent' over a send that did not happen — which
 * is precisely what the old code did for a missing RESEND_API_KEY, a provider
 * rejection, an unknown reminder type and a booking it could not read.
 */
export async function finishReminder(
  supabase: Supa,
  reminder: { id: string; attempts?: number | null },
  outcome: SendOutcome
): Promise<void> {
  const attempts = (reminder.attempts ?? 0) + 1

  let status: string
  let lastError: string | null = null

  switch (outcome.kind) {
    case 'delivered':
      status = 'sent'
      break
    case 'skipped':
      status = 'cancelled'
      break
    case 'retry':
      // Back into the queue until the budget of attempts runs out.
      status = attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
      lastError = outcome.reason
      break
    case 'failed':
      status = 'failed'
      lastError = outcome.reason
      break
  }

  const payload: Record<string, unknown> = {
    status,
    attempts,
    last_outcome: outcome.kind === 'delivered' ? (outcome.detail ?? 'delivered') : outcome.reason,
    last_error: lastError,
  }
  if (outcome.kind === 'delivered') payload.sent_at = new Date().toISOString()
  // A row going back to 'pending' must not look claimed, or nothing re-reads it.
  if (status === 'pending') payload.claimed_at = null

  const { error } = await supabase.from('scheduled_reminders').update(payload).eq('id', reminder.id)
  if (error) console.error('reminderQueue:finish update error', reminder.id, error.message)
}

/* ── The ledger's idea of an id ────────────────────────────────────────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `marketing_ledger.entity_id` is `uuid`; `scheduled_reminders.reference_id` is
 * now `text` and usually holds a booking_ref. Passing one to the other is a
 * 22P02 that `writeLedger` LOGS AND SWALLOWS — an audit row that silently never
 * lands, which is the same class of invisible failure migration 044 exists to
 * fix. Callers pass the reference through here and put the raw value in `meta`.
 */
export function asLedgerEntityId(value: string | null | undefined): string | null {
  return value && UUID_RE.test(value) ? value : null
}

/* ── What a text actually costs ────────────────────────────────────────────── */

/**
 * Segments, not messages.
 *
 * `checkSmsBudget(supabase, 1)` counted one SMS per nudge. The birthday
 * rebooking template contains a 🎉, which is outside GSM-03.38 — so the carrier
 * encodes the whole body as UCS-2, the per-segment limit drops from 160 to 67,
 * and a ~150-character message is billed and delivered as THREE. The monthly cap
 * was therefore understating marketing SMS by 3× on the one template that has
 * an emoji in it. `lib/smsSegments.ts` already does the carrier's arithmetic;
 * the budget just was not asking it (hard-won rule 11).
 */
export function smsCost(body: string): number {
  return smsSegmentInfo(body).segments
}
