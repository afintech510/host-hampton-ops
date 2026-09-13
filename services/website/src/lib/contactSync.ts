/**
 * Keep every contact list in sync: Supabase `contacts` is the source of
 * truth; Brevo (email marketing) and Quo (SMS inbox address book) mirror it.
 *
 * Called from upsertContact() (every website form, every inquiry route, the
 * check-in consent POST and six branches of the Stripe webhook), so no handle
 * the business talks to is missing from any list.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG WITH IT, measured on 2026-09-12:
 *
 *   - **The Brevo half had never once succeeded.** It called `PUT /contacts/
 *     {email}`, which is update-only and 404s on an address Brevo does not
 *     already hold (see `lib/brevo.ts`). 253 of our 1209 people are therefore
 *     absent from Brevo entirely, and every Brevo campaign has gone to a list
 *     that stopped growing when somebody last imported a CSV by hand.
 *   - **The failure was recorded into a column nothing reads, by a write that
 *     discarded its own error.** `supabase.from('contacts').update(patch)` had
 *     no `.error` destructure and no `.select()`, under a comment explaining
 *     that it "fails harmlessly" before migration 032 — which is true, and is
 *     also why nobody noticed that it kept failing afterwards. Rule 19.
 *   - **`addToList` failing left the result reading `synced`.** A contact at
 *     Brevo but NOT on the marketing list is exactly as unreachable as one that
 *     never arrived, and it said it was fine (rule 10).
 *   - **`skipped` meant four different things**: no email, no phone, no
 *     BREVO_API_KEY, no QUO_API_KEY. An unconfigured provider and a contact
 *     with nothing to sync are not the same fact.
 *
 * Rules:
 *   - Never throws.
 *   - THREE outcomes per provider, and `skipped` says why. Every outcome is
 *     persisted to `contacts.sync_error` by a write that reads its own result,
 *     so a backfill can find what did not land.
 *   - Brevo contact is always upserted when an email exists; it is only added
 *     to BREVO_DEFAULT_LIST_ID (the marketing list) when the caller says the
 *     contact has consented. Transactional email does not need list membership.
 *     NOTE, measured: Brevo's list-add succeeds on a BLACKLISTED contact and
 *     leaves the blacklist in place, so list membership is not a consent record
 *     and must never be read as one.
 *   - Quo contact is upserted whenever a phone exists (Quo is where SMS
 *     conversations live; a named contact there is what the reviewers see).
 */

import { getSupabase } from './supabase'
import { upsertBrevoContact, addToList } from './brevo'
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

/** Why a provider was not contacted. Never collapsed into one word again. */
export type SkipReason = 'no-email' | 'no-phone' | 'not-configured'

export type ProviderOutcome =
  | { kind: 'synced' }
  /** Reached the provider, but not fully: at Brevo, not on the list. */
  | { kind: 'partial'; detail: string }
  | { kind: 'skipped'; reason: SkipReason }
  | { kind: 'error'; detail: string }

export interface SyncResult {
  brevo: ProviderOutcome
  quo: ProviderOutcome
  /** The Quo contact id, when one was learned this run. */
  quoContactId?: string | null
  /** Did the `contacts` bookkeeping row actually get written? */
  recorded: boolean
}

function describe(o: ProviderOutcome): string {
  if (o.kind === 'skipped') return `skipped:${o.reason}`
  if (o.kind === 'partial') return `partial:${o.detail}`
  if (o.kind === 'error') return `error:${o.detail}`
  return 'synced'
}

export async function syncContactExternally(input: SyncContactInput): Promise<SyncResult> {
  const patch: Record<string, unknown> = {}
  const now = new Date().toISOString()

  // ── Brevo ──
  let brevo: ProviderOutcome
  if (!input.email) {
    brevo = { kind: 'skipped', reason: 'no-email' }
  } else if (!process.env.BREVO_API_KEY) {
    brevo = { kind: 'skipped', reason: 'not-configured' }
  } else {
    const res = await upsertBrevoContact(input.email, {
      FIRSTNAME: input.firstName || '',
      LASTNAME: input.lastName || '',
      PHONE: input.phone || undefined,
    })
    if (res.kind === 'error') {
      brevo = { kind: 'error', detail: `upsert ${res.error}`.slice(0, 200) }
    } else {
      patch.brevo_synced_at = now
      const listId = parseInt(process.env.BREVO_DEFAULT_LIST_ID || '0', 10)
      if (input.emailOptIn && listId > 0) {
        const added = await addToList(input.email, listId)
        brevo = added
          ? { kind: 'synced' }
          : { kind: 'partial', detail: `at Brevo but NOT added to list ${listId}` }
      } else {
        brevo = { kind: 'synced' }
      }
    }
  }

  // ── Quo ──
  let quo: ProviderOutcome
  let quoContactId: string | null = null
  if (!input.phone) {
    quo = { kind: 'skipped', reason: 'no-phone' }
  } else if (!process.env.QUO_API_KEY) {
    quo = { kind: 'skipped', reason: 'not-configured' }
  } else {
    quoContactId = await upsertQuoContact(
      {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        company: input.company,
        externalId: input.contactId,
      },
      input.existingQuoId
    )
    if (quoContactId) {
      quo = { kind: 'synced' }
      patch.quo_contact_id = quoContactId
      patch.quo_synced_at = now
    } else {
      quo = { kind: 'error', detail: 'upsert failed' }
    }
  }

  const failures = [brevo, quo]
    .map(describe)
    .filter(d => d.startsWith('error') || d.startsWith('partial'))
  patch.sync_error = failures.length ? failures.join(', ').slice(0, 500) : null

  // The bookkeeping write, with its result READ. This is the only record that a
  // contact did or did not reach the outside world, and for five months it was
  // a statement nobody checked.
  let recorded = false
  try {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('contacts')
      .update(patch)
      .eq('id', input.contactId)
      .select('id')
    if (error) {
      console.error(`contactSync: could not record sync state for ${input.contactId}:`, error.message)
    } else if (!data || data.length === 0) {
      console.error(`contactSync: sync-state update matched NO row for ${input.contactId}`)
    } else {
      recorded = true
    }
  } catch (err) {
    console.error('contactSync: bookkeeping update threw (non-fatal):', err)
  }

  // Rule 10, in both directions: say what happened whether or not it worked.
  const line = `contactSync ${input.contactId}: brevo=${describe(brevo)} quo=${describe(quo)} recorded=${recorded}`
  if (failures.length || !recorded) console.warn(line)
  else console.log(line)

  return { brevo, quo, quoContactId, recorded }
}
