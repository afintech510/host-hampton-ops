/**
 * May we email this address? (spec §9.2)
 *
 *   emailSuppressed(supabase, email) -> 'suppressed' | 'clear' | 'unavailable'
 *
 * Used by the sends that go to a PARENT or a lead (`lead_preview`, `invite_ready`,
 * `new_rsvp`, `rsvp_changed`). Guests are not contacts (principle 5), so a guest send is
 * gated by the RSVP's own `reminder_opt_out_at` instead and never reaches this.
 *
 *   1. `findContactsByEmail` (the only way to match an address; AGENTS.md §11):
 *        absent       -> clear        nobody by that address has ever told us anything
 *        unavailable  -> unavailable  NO SEND; the caller retries (rule 12)
 *   2. found: `suppressed` if ANY of those contact rows has a `contact_interactions` row
 *      of type `email_unsubscribed`, or `email_bounced` with `metadata.bounce_type =
 *      'hard'`. Those two are what the unsubscribe link (`/api/unsubscribe`) and the
 *      Brevo webhook actually WRITE. The `status = 'unsubscribed'` value the lead-preview
 *      gate once read has never been written by anything.
 *   3. otherwise clear.
 *
 * What it deliberately does NOT read: `contacts.email_opt_in`. That column defaults to
 * false and means "never asked", not "said no" (a customer who inquired is exactly who a
 * lead preview is for). A soft bounce is not a suppression either; only a hard one is.
 *
 * `unavailable` is never `clear`. An interactions read that fails is `unavailable`, not
 * "no interactions found", for the same reason the contact lookup is three-valued: a
 * Supabase blip must not wave a message through to somebody who unsubscribed.
 */

import type { getSupabase } from '@/lib/supabase'
import { findContactsByEmail } from '@/lib/contactLookup'

type Supa = ReturnType<typeof getSupabase>

export type EmailSuppression = 'suppressed' | 'clear' | 'unavailable'

export async function emailSuppressed(supabase: Supa, email: string): Promise<EmailSuppression> {
  const found = await findContactsByEmail(supabase, email, 'id, email')
  if (found.kind === 'absent') return 'clear'
  if (found.kind === 'unavailable') {
    console.error(`evites/suppression: contact lookup failed: ${found.error}`)
    return 'unavailable'
  }
  const ids = found.contacts.map((c) => c.id)

  const unsub = await supabase.from('contact_interactions').select('contact_id, type').in('contact_id', ids).eq('type', 'email_unsubscribed').limit(1)
  if (unsub.error) {
    console.error(`evites/suppression: unsubscribe read failed: ${unsub.error.message}`)
    return 'unavailable'
  }
  if (((unsub.data ?? []) as unknown[]).length > 0) return 'suppressed'

  const bounced = await supabase
    .from('contact_interactions')
    .select('contact_id, type, metadata')
    .in('contact_id', ids)
    .eq('type', 'email_bounced')
    .eq('metadata->>bounce_type', 'hard')
    .limit(1)
  if (bounced.error) {
    console.error(`evites/suppression: bounce read failed: ${bounced.error.message}`)
    return 'unavailable'
  }
  // Re-check what came back: the filter is the cheap path, the row is the authority.
  for (const r of (bounced.data ?? []) as unknown as Array<{ metadata?: { bounce_type?: unknown } | null }>) {
    if (r.metadata && r.metadata.bounce_type === 'hard') return 'suppressed'
  }
  return 'clear'
}
