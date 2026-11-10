import type { getSupabase } from '@/lib/supabase'
import { TENANT } from '@/tenant'
import { fetchQuoThread } from '@/lib/quo'

/**
 * Has this person already been told who is writing to them?
 *
 * A message to a customer introduces us ("It's Allie from Host Hampton") and signs
 * off with the name ONCE. After that, the thread has said it, and every further
 * message just says what it has to say. So before the assistant drafts the standard
 * wording it asks this, and a yes drops the intro, the sign-off and the business
 * name.
 *
 * "Said" means the customer sign-off name appears in something we sent them, in any
 * place we can see:
 *   * a message we recorded going out to them (ingested_messages, direction 'out');
 *   * a reply the booking agent sent (inquiry_drafts that were sent);
 *   * a text in the Quo thread that WE sent (this includes the ones sent by hand);
 *   * a link or photo send from the dashboard, which carried the standard intro (the
 *     change log records that it went; the wording itself is not stored).
 *
 * Three outcomes. `true` only on positive evidence. `false` when everything that
 * could be read was read and said nothing. `null` when something could not be read
 * and nothing positive was found; the caller treats that like false (the old, full
 * wording), because a repeated "It's Allie" is a small awkwardness and a missing one
 * on a first message is a stranger texting a stranger.
 */

type Supa = ReturnType<typeof getSupabase>

const SENT_BY_DASHBOARD = /^(Links sent to customer|Message sent to customer|Photos sent to customer|Portal link sent|Portal link texted|Photo album sent)/i

export async function threadHasIntroduced(
  sb: Supa,
  b: { id: string; contact_phone: string | null },
): Promise<boolean | null> {
  const named = new RegExp(`\\b${TENANT.people.customerSignoff.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  let unreadable = false

  const [out, drafts, mods] = await Promise.all([
    sb.from('ingested_messages').select('body').eq('booking_id', b.id).eq('direction', 'out').limit(50),
    sb.from('inquiry_drafts').select('sms_draft, email_draft, sent_at').eq('booking_id', b.id).limit(50),
    sb.from('booking_modifications').select('change_summary').eq('booking_id', b.id).ilike('change_summary', '%sent%').limit(100),
  ])

  if (out.error) unreadable = true
  else if ((out.data ?? []).some((r: { body: string | null }) => named.test(r.body ?? ''))) return true

  if (drafts.error) unreadable = true
  else {
    const sent = (drafts.data ?? []) as Array<{ sms_draft: string | null; email_draft: string | null; sent_at: string | null }>
    if (sent.some(d => d.sent_at && (named.test(d.sms_draft ?? '') || named.test(d.email_draft ?? '')))) return true
  }

  if (mods.error) unreadable = true
  else if ((mods.data ?? []).some((m: { change_summary: string | null }) => SENT_BY_DASHBOARD.test(m.change_summary ?? ''))) return true

  // Last, the text thread itself (one request to Quo), only if nothing above settled it.
  if (b.contact_phone) {
    const thread = await fetchQuoThread(b.contact_phone, { limit: 50 })
    if (thread.kind === 'ok') {
      if (thread.messages.some(m => m.direction === 'out' && named.test(m.text))) return true
    } else if (thread.kind === 'unavailable') {
      unreadable = true
    }
  }

  return unreadable ? null : false
}
