/**
 * Inbound events — the booking agent's single front door.
 *
 * Every channel the business hears from lands as one `ingested_messages` row
 * with `status='new'`, and the dispatcher (/api/cron/agent-dispatch) claims it
 * from there. Website forms call `recordInboundEvent()` right where they call
 * `upsertContact()`; Quo SMS (Phase 2) and Gmail (Phase 3) will call the same
 * function with a different `source`.
 *
 * Rules:
 *   - NEVER throws and never blocks the route it is called from. A form
 *     submission must succeed even if the agent tables are missing (the
 *     migrations are applied by hand, so "not yet applied" is a real state).
 *   - `external_id` is UNIQUE in the DB, which is what makes re-delivery of the
 *     same Quo/Gmail message idempotent. Callers that have a natural id (a Quo
 *     message id, a Gmail message id) MUST pass it.
 *   - Recording happens whether or not AGENT_ENABLED is on. The flag gates the
 *     dispatcher, not the history — so when the agent is switched on there is
 *     already a record of what came in. The dispatcher ignores stale events for
 *     exactly this reason.
 */

import { getSupabase } from '@/lib/supabase'

type Supa = ReturnType<typeof getSupabase>

export type InboundSource = 'website_form' | 'quo' | 'gmail' | 'system'

export interface RecordInboundEventInput {
  /** Where this came from, used to build external_id, e.g. 'mobile-party-inquiry'. */
  route: string
  source?: InboundSource
  /** Natural unique id when the channel has one (Quo/Gmail message id). */
  externalId?: string
  contactId?: string | null
  bookingId?: string | null
  fromAddress?: string | null
  toAddress?: string | null
  subject?: string | null
  body?: string | null
  /** Structured form payload the draft node reads (name, date, guests, …). */
  parsed?: Record<string, unknown>
  /** Provider conversation id (Quo conversation, Gmail thread) — groups a thread. */
  threadId?: string | null
  direction?: 'in' | 'out'
  /**
   * false → the row is recorded as `ignored`: kept as history, never drafted
   * for. Newsletter signups and the site's own notification mail go here.
   */
  needsAction?: boolean
  /** Optional pre-classification ('lead', 'signup', …). */
  classification?: string | null
  /** Injectable for tests. */
  supabase?: Supa
}

/**
 * Insert one inbound event. Returns the new row id, or null when the insert
 * was skipped, deduped, or failed (all non-fatal).
 */
export async function recordInboundEvent(input: RecordInboundEventInput): Promise<string | null> {
  try {
    const supabase = input.supabase ?? getSupabase()
    const source: InboundSource = input.source ?? 'website_form'

    // A website form has no natural message id: one submission is one event, so
    // the timestamp + contact is unique enough to keep external_id meaningful
    // while still being UNIQUE-safe.
    const externalId =
      input.externalId ||
      `${source}:${input.route}:${input.contactId || input.fromAddress || 'anon'}:${Date.now()}`

    const { data, error } = await supabase
      .from('ingested_messages')
      .insert({
        source,
        external_id: externalId,
        direction: input.direction ?? 'in',
        from_address: input.fromAddress ?? null,
        to_address: input.toAddress ?? null,
        sent_at: new Date().toISOString(),
        subject: input.subject ?? null,
        body: input.body ?? null,
        thread_id: input.threadId ?? null,
        parsed: { route: input.route, ...(input.parsed ?? {}) },
        contact_id: input.contactId ?? null,
        booking_id: input.bookingId ?? null,
        status: input.needsAction === false ? 'ignored' : 'new',
        classification: input.classification ?? null,
      })
      .select('id')
      .single()

    if (error) {
      // 23505 = duplicate external_id, i.e. we already have this message. That
      // is the idempotency guarantee working, not a failure.
      if ((error as { code?: string }).code !== '23505') {
        console.error('recordInboundEvent insert error (non-fatal):', error.message)
      }
      return null
    }

    return data?.id ?? null
  } catch (err) {
    console.error('recordInboundEvent error (non-fatal):', err)
    return null
  }
}

/** The subset of an `ingested_messages` row the agent reads. */
export interface InboundEvent {
  id: string
  source: string
  external_id: string
  direction: string
  from_address: string | null
  to_address: string | null
  subject: string | null
  body: string | null
  parsed: Record<string, unknown> | null
  contact_id: string | null
  booking_id: string | null
  status: string
  classification: string | null
  created_at: string
}

export type EventOutcome = 'handled' | 'ignored' | 'error'

/**
 * Close out a claimed event. `draftId` links the draft that answered it, so the
 * admin Inbox can show event → draft in one row.
 */
export async function finishEvent(
  supabase: Supa,
  eventId: string,
  outcome: EventOutcome,
  extra: { draftId?: string | null; error?: string | null; classification?: string | null } = {},
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: outcome,
    handled_at: new Date().toISOString(),
  }
  if (extra.draftId !== undefined) patch.draft_id = extra.draftId
  if (extra.error !== undefined) patch.error = extra.error
  if (extra.classification != null) patch.classification = extra.classification

  const { error } = await supabase.from('ingested_messages').update(patch).eq('id', eventId)
  if (error) console.error('finishEvent update error (non-fatal):', error.message)
}
