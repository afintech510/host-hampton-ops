/**
 * Keep every contact list in sync: Supabase `contacts` is the source of
 * truth; Brevo (email marketing) and Quo (SMS inbox address book) mirror it.
 *
 * Called from upsertContact() (every website form) and, later, from the
 * booking agent whenever it handles a message from a new email/number, so no
 * handle the business talks to is missing from any list.
 *
 * Rules:
 *   - Never throws. Every external failure is logged and recorded in
 *     contacts.sync_error so a backfill can retry.
 *   - Brevo contact is always upserted when an email exists; it is only added
 *     to BREVO_DEFAULT_LIST_ID (the marketing list) when the contact has
 *     email_opt_in = true. Transactional email does not need list membership.
 *   - Quo contact is upserted whenever a phone exists (Quo is where SMS
 *     conversations live; a named contact there is what the reviewers see).
 *   - Skips silently when BREVO_API_KEY / QUO_API_KEY are not configured.
 */

import { getSupabase } from './supabase'
import { syncContactToBrevo, addToList } from './brevo'
import { upsertQuoContact } from './quo'

export interface SyncContactInput {
  contactId: string
  email?: string | null
  phone?: string | null
  firstName?: string | null
  lastName?: string | null
  company?: string | null
  emailOptIn?: boolean
  existingQuoId?: string | null
}

export interface SyncResult {
  brevo: 'synced' | 'skipped' | 'error'
  quo: 'synced' | 'skipped' | 'error'
}

export async function syncContactExternally(input: SyncContactInput): Promise<SyncResult> {
  const result: SyncResult = { brevo: 'skipped', quo: 'skipped' }
  const errors: string[] = []
  const patch: Record<string, unknown> = {}
  const now = new Date().toISOString()

  // ── Brevo ──
  if (input.email && process.env.BREVO_API_KEY) {
    const ok = await syncContactToBrevo(input.email, {
      FIRSTNAME: input.firstName || '',
      LASTNAME: input.lastName || '',
      PHONE: input.phone || undefined,
    })
    if (ok) {
      result.brevo = 'synced'
      patch.brevo_synced_at = now
      const listId = parseInt(process.env.BREVO_DEFAULT_LIST_ID || '0', 10)
      if (input.emailOptIn && listId > 0) {
        const added = await addToList(input.email, listId)
        if (!added) errors.push('brevo:addToList')
      }
    } else {
      result.brevo = 'error'
      errors.push('brevo:upsert')
    }
  }

  // ── Quo ──
  if (input.phone && process.env.QUO_API_KEY) {
    const quoId = await upsertQuoContact(
      {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        company: input.company,
        externalId: input.contactId,
      },
      input.existingQuoId,
    )
    if (quoId) {
      result.quo = 'synced'
      patch.quo_contact_id = quoId
      patch.quo_synced_at = now
    } else {
      result.quo = 'error'
      errors.push('quo:upsert')
    }
  }

  patch.sync_error = errors.length ? errors.join(', ') : null

  if (Object.keys(patch).length > 0) {
    try {
      const supabase = getSupabase()
      await supabase.from('contacts').update(patch).eq('id', input.contactId)
    } catch (err) {
      // Columns arrive with migration_032; before it is applied this update
      // fails harmlessly and the external sync still happened.
      console.error('contactSync: bookkeeping update failed (non-fatal):', err)
    }
  }

  return result
}
