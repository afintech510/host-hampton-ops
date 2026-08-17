/**
 * Marketing graph — the single transition function.
 *
 * "Graph as data, not as runtime": the graph's STATE is Postgres rows
 * (marketing_tasks.status, website_content.status, consent_releases.status)
 * and its EDGES are this one choke-point `advance()` call. Nothing else in
 * the app is allowed to `.update({ status })` on these tables — every status
 * change goes through here, which:
 *
 *   1. validates the transition is legal for that entity (illegal → throws),
 *   2. enforces the human gate (advancing INTO a gated status requires an
 *      authenticated admin actor),
 *   3. writes the new status,
 *   4. appends exactly one marketing_ledger row describing the transition.
 *
 * DB triggers (migration_022 consent gate, migration_021 append-only ledger)
 * are the structural backstop underneath this app-level logic.
 */

import { getSupabase } from '@/lib/supabase'

type Supa = ReturnType<typeof getSupabase>

export type EntityType = 'marketing_task' | 'website_content' | 'consent_release'

/** Physical table backing each logical entity. */
const TABLE: Record<EntityType, string> = {
  marketing_task: 'marketing_tasks',
  website_content: 'website_content',
  consent_release: 'consent_releases',
}

/**
 * Legal transitions: for each entity, the set of statuses reachable from a
 * given current status. A status not listed as a key is terminal.
 */
export const TRANSITIONS: Record<EntityType, Record<string, string[]>> = {
  marketing_task: {
    draft: ['pending_review', 'executing', 'rejected'],
    pending_review: ['approved', 'rejected', 'escalated'],
    approved: ['executing', 'done'],
    executing: ['done', 'escalated', 'rejected'],
    escalated: ['pending_review', 'approved', 'rejected'],
    rejected: [],
    done: [],
  },
  website_content: {
    draft: ['pending_review', 'archived'],
    pending_review: ['approved', 'draft', 'archived'], // reject → back to draft
    approved: ['published', 'draft', 'archived'],
    published: ['archived', 'draft'],
    archived: ['draft'],
  },
  consent_release: {
    pending: ['sent', 'revoked'],
    sent: ['signed', 'revoked', 'pending'],
    signed: ['revoked'],
    revoked: [],
  },
}

/**
 * Gated transitions: advancing INTO one of these target statuses is an
 * ALWAYS_ASK action and requires `actor.isAdmin`. This is the human gate —
 * publishing content or approving a task can never be done by cron/system.
 */
const GATED: Record<EntityType, Set<string>> = {
  marketing_task: new Set(['approved']),
  website_content: new Set(['approved', 'published']),
  consent_release: new Set([]), // consent state is driven by SignWell, not admins
}

export interface Actor {
  /** Stable identifier written to the ledger (admin email, 'cron', a node name). */
  id: string
  /** True only for an authenticated admin request. Required for GATED targets. */
  isAdmin?: boolean
}

export class IllegalTransitionError extends Error {
  constructor(entity: EntityType, from: string, to: string) {
    super(`Illegal ${entity} transition: ${from} → ${to}`)
    this.name = 'IllegalTransitionError'
  }
}

export class TransitionNotAuthorizedError extends Error {
  constructor(entity: EntityType, to: string) {
    super(`Transition into "${to}" on ${entity} requires an authenticated admin`)
    this.name = 'TransitionNotAuthorizedError'
  }
}

/** True if `to` is reachable from `from` for this entity. */
export function isLegalTransition(entity: EntityType, from: string, to: string): boolean {
  return (TRANSITIONS[entity][from] ?? []).includes(to)
}

/** True if advancing into `to` requires an admin actor. */
export function isGatedTransition(entity: EntityType, to: string): boolean {
  return GATED[entity].has(to)
}

/**
 * Append one row to marketing_ledger. This is the ONLY ledger writer other
 * modules should call; it never throws in a way that blocks the caller's
 * primary work (ledger insert errors are logged, not propagated) EXCEPT when
 * called from advance(), where a failed transition must not leave an orphan.
 */
export async function writeLedger(
  supabase: Supa,
  row: {
    entityType: string
    entityId?: string | null
    action: 'transition' | 'send' | 'llm_call' | 'note'
    actor: string
    fromStatus?: string | null
    toStatus?: string | null
    costUsd?: number | null
    tokens?: number | null
    meta?: Record<string, unknown>
  }
): Promise<void> {
  const { error } = await supabase.from('marketing_ledger').insert({
    entity_type: row.entityType,
    entity_id: row.entityId ?? null,
    action: row.action,
    actor: row.actor,
    from_status: row.fromStatus ?? null,
    to_status: row.toStatus ?? null,
    cost_usd: row.costUsd ?? null,
    tokens: row.tokens ?? null,
    meta: row.meta ?? {},
  })
  if (error) {
    console.error('marketing_ledger insert error:', error.message)
  }
}

export interface AdvanceInput {
  entity: EntityType
  id: string
  to: string
  actor: Actor
  /** Optional expected current status — a stale value throws (optimistic lock). */
  from?: string
  /** Extra columns to set on the same UPDATE (e.g. reviewed_by, output). */
  patch?: Record<string, unknown>
  meta?: Record<string, unknown>
  /** Injectable for tests; defaults to getSupabase(). */
  supabase?: Supa
}

/**
 * The one and only status-transition function. Returns { from, to } on success.
 * Throws IllegalTransitionError / TransitionNotAuthorizedError, or the raw DB
 * error (e.g. the consent-gate trigger firing on a child-media publish).
 */
export async function advance(input: AdvanceInput): Promise<{ from: string; to: string }> {
  const supabase = input.supabase ?? getSupabase()
  const table = TABLE[input.entity]

  // 1. Read current status.
  const { data: current, error: readErr } = await supabase
    .from(table)
    .select('status')
    .eq('id', input.id)
    .single()

  if (readErr || !current) {
    throw new Error(`advance: ${input.entity} ${input.id} not found${readErr ? ` (${readErr.message})` : ''}`)
  }

  const from = current.status as string

  // 2. Optimistic guard.
  if (input.from != null && input.from !== from) {
    throw new Error(`advance: stale transition — expected ${input.entity} at "${input.from}" but it is "${from}"`)
  }

  // Idempotent no-op: already at target.
  if (from === input.to) {
    return { from, to: input.to }
  }

  // 3. Legality.
  if (!isLegalTransition(input.entity, from, input.to)) {
    throw new IllegalTransitionError(input.entity, from, input.to)
  }

  // 4. Human gate.
  if (isGatedTransition(input.entity, input.to) && !input.actor.isAdmin) {
    throw new TransitionNotAuthorizedError(input.entity, input.to)
  }

  // 5. Write status (+ any caller patch). Let DB triggers veto if needed.
  const patch: Record<string, unknown> = { status: input.to, ...(input.patch ?? {}) }
  const { error: updErr } = await supabase.from(table).update(patch).eq('id', input.id)
  if (updErr) {
    // e.g. consent-gate trigger raised. Surface it; do NOT write a ledger row.
    throw new Error(`advance: ${input.entity} ${from} → ${input.to} refused by DB: ${updErr.message}`)
  }

  // 6. Ledger, exactly one row per successful transition.
  await writeLedger(supabase, {
    entityType: input.entity,
    entityId: input.id,
    action: 'transition',
    actor: input.actor.id,
    fromStatus: from,
    toStatus: input.to,
    meta: input.meta,
  })

  return { from, to: input.to }
}
