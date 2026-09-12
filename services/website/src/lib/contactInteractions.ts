/**
 * `contact_interactions.type` is constrained in Postgres, and the app did not
 * know it.
 *
 * `/api/cron/process-sequences` has been writing `type: 'sequence_email_sent'`
 * since 2026-03-10, on a `.then(() => {})` that discards the result. That value
 * is NOT in `contact_interactions_type_check`, so every one of those inserts was
 * refused by the database and the refusal was thrown away. Measured in
 * production 2026-09-12: **57 enrollments carry a `last_sent_at`** — 57 real
 * marketing emails to real customers between 2026-03-21 and 2026-08-16 — and
 * `contact_interactions` holds **zero** rows of any sequence type. The one
 * record that a marketing email reached a customer never existed.
 *
 * Hard-won rule 13: a constraint asserted in a comment and declared nowhere is
 * worse than a constant declared twice. So this list is the constraint, read out
 * of `pg_constraint` rather than remembered, and `logInteraction` is typed
 * against it — a bad value is now a TypeScript error at the call site instead of
 * a silent 23514 at 2am. And rule 10: when the insert does fail, it says so.
 */

import type { getSupabase } from '@/lib/supabase'

type Supa = ReturnType<typeof getSupabase>

/**
 * The exact contents of `contact_interactions_type_check`, verified against
 * production on 2026-09-12. If you add a value here you must also ALTER the
 * CHECK in a migration — the database is the authority and it will refuse.
 */
export const CONTACT_INTERACTION_TYPES = [
  'email_sent',
  'email_opened',
  'email_clicked',
  'email_unsubscribed',
  'email_bounced',
  'sms_sent',
  'sms_replied',
  'sms_received',
  'sms_unsubscribed',
  'ig_dm',
  'fb_dm',
  'phone_call',
  'in_person',
  'booking_inquiry',
  'booking_confirmed',
  'review_requested',
  'review_left',
  'ad_click',
  'form_submission',
  'other',
] as const

export type ContactInteractionType = (typeof CONTACT_INTERACTION_TYPES)[number]

export function isContactInteractionType(v: unknown): v is ContactInteractionType {
  return typeof v === 'string' && (CONTACT_INTERACTION_TYPES as readonly string[]).includes(v)
}

export interface InteractionInput {
  contactId: string
  type: ContactInteractionType
  summary?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Write one `contact_interactions` row. Returns true when the row landed.
 *
 * Never throws — a failed activity log must not abort the send that produced it
 * — but it does REPORT, which is the whole point of this module existing.
 */
export async function logInteraction(
  supabase: Supa,
  input: InteractionInput
): Promise<boolean> {
  // Belt and braces: the type union is compile-time only, and `as any` at a
  // call site would walk straight past it into the same silent 23514.
  if (!isContactInteractionType(input.type)) {
    console.error(
      `contact_interactions: refusing to insert unknown type "${String(input.type)}" — ` +
        `not in contact_interactions_type_check. Allowed: ${CONTACT_INTERACTION_TYPES.join(', ')}`
    )
    return false
  }

  const { error } = await supabase.from('contact_interactions').insert({
    contact_id: input.contactId,
    type: input.type,
    summary: input.summary ?? null,
    metadata: input.metadata ?? {},
  })

  if (error) {
    console.error(
      `contact_interactions insert FAILED (type=${input.type}, contact=${input.contactId}): ` +
        `${error.code ?? '?'} ${error.message}`
    )
    return false
  }

  return true
}
