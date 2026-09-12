/**
 * Assigning a contact to a variant — the CLAIM.
 *
 * ── An A/B assignment is a claim about a person, not a coin flip ────────────
 *
 * If a variant were chosen at send time by `Math.random()`, then the same
 * person on step 2 and step 4 of one sequence would be in two arms, every
 * outcome would be attributable to both, and two overlapping cron ticks would
 * assign twice. The arms would not be comparable and nothing would say so.
 *
 * So the assignment is recorded, stable and idempotent — the same three
 * properties `lib/reminderQueue.ts` needed for a reminder and
 * `email_sequence_sends` needed for a sequence step, achieved the same way: a
 * UNIQUE index decides, and **23505 is handled by CODE, never by message text**.
 *
 *   idx_variant_assignments_once  UNIQUE (experiment_id, contact_id)
 *
 * Two ticks racing: one insert wins, the other gets 23505 and READS BACK the
 * winner's row. Both callers then send the same variant to that person. There is
 * no window in which a contact has two arms.
 *
 * ── Why the arm is a hash and not a counter ─────────────────────────────────
 *
 * A "next arm" counter needs a read-modify-write and would be the same
 * check-then-act the sequencer had to have surgery for. A HASH of
 * (experiment_id, contact_id) is deterministic, needs no read, and — the part
 * that matters if this ever runs at volume — is stable under a retry, so the
 * losing tick of a race computes the SAME arm the winner did and the 23505 is a
 * confirmation rather than a disagreement.
 *
 * It is deliberately NOT `contact_id` alone: two experiments would then always
 * put the same people in the same lettered arm, and any systematic difference
 * between those groups would show up in both tests as if it were the copy.
 */

import crypto from 'crypto'
import type { getSupabase } from '@/lib/supabase'
import type { VariantRow } from './types'

type Supa = ReturnType<typeof getSupabase>

const UNIQUE_VIOLATION = '23505'

/**
 * Which arm this (experiment, contact) pair belongs in.
 *
 * Exported and pure so a test can prove stability directly rather than by
 * running the route twice and hoping.
 */
export function armFor(experimentId: string, contactId: string, armCount: number): number {
  if (armCount <= 0) return 0
  const h = crypto.createHash('sha256').update(`${experimentId}:${contactId}`).digest()
  // The first four bytes as an unsigned int. Modulo bias over 2^32 against an
  // arm count of 2–4 is far below anything this volume of mail could detect.
  const n = h.readUInt32BE(0)
  return n % armCount
}

export type Assignment =
  | { kind: 'assigned'; id: string; variant: VariantRow; fresh: boolean }
  /** The table could not be read or written. NOT "no experiment" (rule 12). */
  | { kind: 'unavailable'; error: string }

/**
 * Get or create this contact's assignment for this experiment.
 *
 * `fresh` says whether THIS call created the row — taken from the insert's own
 * result, never from a re-read filtered by time. Link 10's own fix had that bug:
 * the birthday scanner re-read the table and treated "created in the last 60
 * seconds" as "created by this run", and a test that ran it twice inside one
 * second reported two nudges over a table that had gained no rows. **A time
 * window is not a fact.**
 */
export async function assignVariant(args: {
  supabase: Supa
  experimentId: string
  contactId: string
  variants: VariantRow[]
  actor: string
  context?: Record<string, unknown>
}): Promise<Assignment> {
  const { supabase, experimentId, contactId, variants, actor } = args
  if (variants.length === 0) return { kind: 'unavailable', error: 'the experiment has no usable variants' }

  // Sort by label so the arm ordering is a property of the data and not of the
  // order PostgREST happened to return rows in. Two ticks must compute the same
  // arm from the same rows.
  const arms = [...variants].sort((a, b) => a.label.localeCompare(b.label))
  const chosen = arms[armFor(experimentId, contactId, arms.length)]

  const { data, error } = await supabase
    .from('variant_assignments')
    .insert({
      experiment_id: experimentId,
      variant_id: chosen.id,
      contact_id: contactId,
      assigned_by: actor,
      context: args.context ?? {},
    })
    .select('id, variant_id')
    .single()

  if (!error && data) {
    return { kind: 'assigned', id: String(data.id), variant: chosen, fresh: true }
  }

  // By CODE. A 23505 here means somebody — another tick, or an earlier step of
  // the same sequence — already put this person in an arm, and that row is the
  // authority. Anything else is a real failure and must not read as "no
  // experiment", which would silently send the control and record nothing.
  if ((error as { code?: string } | null)?.code !== UNIQUE_VIOLATION) {
    return { kind: 'unavailable', error: error?.message ?? 'assignment insert returned no row' }
  }

  const { data: existing, error: readErr } = await supabase
    .from('variant_assignments')
    .select('id, variant_id')
    .eq('experiment_id', experimentId)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (readErr) return { kind: 'unavailable', error: `existing assignment unreadable: ${readErr.message}` }
  if (!existing) {
    // 23505 and then nothing there. A concurrent DELETE, or the unique index is
    // not the one we think it is. Either way this is not a fact we can act on.
    return { kind: 'unavailable', error: 'assignment conflicted but could not be read back' }
  }

  const stored = arms.find(v => v.id === String(existing.variant_id))
  if (!stored) {
    // The row points at a variant that is gone or that the read-time screen
    // dropped. Do NOT substitute a different arm: that would move a person
    // between arms mid-experiment and attribute their outcome to copy they
    // never saw.
    return {
      kind: 'unavailable',
      error: `assignment ${String(existing.id)} names variant ${String(existing.variant_id)}, which is not among the usable variants`,
    }
  }

  return { kind: 'assigned', id: String(existing.id), variant: stored, fresh: false }
}

export type RecordOutcome =
  | { kind: 'recorded' }
  /** Already recorded — 23505 on (assignment_id, event_type). A no-op success. */
  | { kind: 'duplicate' }
  | { kind: 'unavailable'; error: string }

/**
 * Record one outcome against an assignment. Idempotent by unique index: a
 * redelivered click is not a second click, and a mail scanner fetching a link
 * twice is not two people.
 */
export async function recordVariantEvent(args: {
  supabase: Supa
  assignmentId: string
  eventType: string
  detail?: string | null
  meta?: Record<string, unknown>
}): Promise<RecordOutcome> {
  const { supabase, assignmentId, eventType } = args
  const { error } = await supabase.from('variant_events').insert({
    assignment_id: assignmentId,
    event_type: eventType,
    detail: args.detail ? String(args.detail).slice(0, 500) : null,
    meta: args.meta ?? {},
  })
  if (!error) return { kind: 'recorded' }
  if ((error as { code?: string }).code === UNIQUE_VIOLATION) return { kind: 'duplicate' }
  return { kind: 'unavailable', error: error.message }
}

/**
 * Rule 14's final branch, in the one place it is reachable.
 *
 * `lib/unclaimedPayment.ts` exists because an unattributable payment is a
 * bookkeeping problem and an INVISIBLE one is a lost payment. A signal that
 * arrives and cannot be attributed — a tracked click whose assignment row is
 * gone, an assignment naming a variant that no longer passes the screen — is
 * the same shape, and it must not be silently dropped OR counted against a
 * variant. It goes to `unattributed_signals`, which the admin panel reads.
 *
 * Never throws: this is the error path, and an error path that can fail loudly
 * is worse than the thing it was reporting.
 */
export async function recordUnattributed(
  supabase: Supa,
  kind: string,
  reason: string,
  meta: Record<string, unknown> = {}
): Promise<void> {
  try {
    const { error } = await supabase.from('unattributed_signals').insert({
      kind: kind.slice(0, 60),
      reason: reason.slice(0, 500),
      meta,
    })
    if (error) console.error(`unattributed_signals insert failed (${kind}): ${error.message}`)
  } catch (err) {
    console.error(`unattributed_signals insert threw (${kind}):`, err)
  }
  // Logged as well as stored: a row in a table nobody has opened yet is still
  // better read from `docker logs` today.
  console.warn(`experiments: UNATTRIBUTED ${kind} — ${reason}`)
}
