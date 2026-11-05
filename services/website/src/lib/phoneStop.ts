import type { getSupabase } from '@/lib/supabase'
import { findContactsByPhone } from '@/lib/contactLookup'
import { hasExplicitSmsOptOut } from '@/lib/checkinLink'

/**
 * Has anyone holding this NUMBER texted STOP? A STOP is a statement about the
 * number, not about one contact row (21 numbers carry several rows), so every
 * row holding it is checked. Three outcomes: a failed read is not "clear".
 *
 * Lives here, not in the Parties route, because two readers need the same
 * answer: the route refuses a send to a stopped number, and the assistant's
 * card tells the manager so BEFORE they press Confirm.
 */
export async function phoneHasExplicitStop(
  supabase: ReturnType<typeof getSupabase>,
  phone: string,
): Promise<'clear' | 'stopped' | 'unavailable'> {
  const found = await findContactsByPhone(supabase, phone, 'id, phone')
  if (found.kind === 'unavailable') return 'unavailable'
  if (found.kind === 'absent') return 'clear'
  for (const c of found.contacts) {
    // Fails CLOSED on its own read error, so an unreadable row reads as stopped.
    if (await hasExplicitSmsOptOut(c.id)) return 'stopped'
  }
  return 'clear'
}
