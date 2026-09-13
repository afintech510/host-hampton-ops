import { getSupabase } from '@/lib/supabase'
import { syncContactExternally, type SyncResult } from '@/lib/contactSync'
import { findContactsByEmail, findContactsByPhone, normalizePhoneKey } from '@/lib/contactLookup'
import { isUniqueViolation } from '@/lib/planPayment'
import { optedOutReason } from '@/lib/sequences/processor'

// Valid service_type enum values in the database
const SERVICE_TYPE_MAP: Record<string, string> = {
  'kids-party': 'kids_party',
  'kids_party': 'kids_party',
  'room-rental': 'room_rental',
  'room_rental': 'room_rental',
  'permanent-jewelry': 'permanent_jewelry',
  'permanent_jewelry': 'permanent_jewelry',
  'host-your-client': 'host_your_client',
  'host_your_client': 'host_your_client',
  'trucker-hat-bar': 'trucker_hat_bar',
  'trucker_hat_bar': 'trucker_hat_bar',
  'workshop': 'workshop',
  'fundraiser': 'fundraiser',
  'craft-event': 'craft_event',
  'craft_event': 'craft_event',
  'photography-studio': 'photography_studio',
  'photography_studio': 'photography_studio',
  'pop-up-vendor': 'pop_up_vendor',
  'pop_up_vendor': 'pop_up_vendor',
  'seasonal-retail': 'seasonal_retail',
  'seasonal_retail': 'seasonal_retail',
  'event': 'other',
  'general': 'other',
  'mobile': 'other',
  'retail': 'seasonal_retail',
  'party-room': 'room_rental',
  'other': 'other',
  'canvas-bags': 'seasonal_retail',
  'canvas_bags': 'seasonal_retail',
}

function normalizeServiceInterests(raw: string[]): string[] {
  const mapped = raw.map(s => SERVICE_TYPE_MAP[s] || 'other')
  return Array.from(new Set(mapped))
}

interface UpsertContactParams {
  name: string
  email: string
  phone?: string | null
  sourceDetail: string
  serviceInterests: string[]
  marketingConsent?: boolean
}

/**
 * What happened to a contact, in the three shapes a caller can actually act on.
 *
 * The old signature was `Promise<string | null>`, and `null` meant all of: the
 * read failed, the write was refused, and the contact exists but is not
 * mirrored anywhere. Rule 12 — and on this surface the collapse is expensive,
 * because a contact that exists locally and never reached Brevo is *invisible*
 * to every campaign while looking perfectly healthy in the admin tab.
 */
export type UpsertContactOutcome =
  | { kind: 'created'; contactId: string; mirror: SyncResult }
  | { kind: 'updated'; contactId: string; mirror: SyncResult }
  /** The database could not be read or written. Nothing happened; retry is safe. */
  | { kind: 'unavailable'; error: string }

/**
 * Find-or-create the contact for an email address, and mirror it outward.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT AN UPSERT ANY MORE. It used to be:
 *
 *     supabase.from('contacts').upsert(record, { onConflict: 'email' })
 *
 * and `contacts_email_key` is unique on the **RAW** value, so `onConflict` is
 * case-SENSITIVE in exactly the way `.eq('email', …)` is. A returning customer
 * who capitalised differently the second time hit no conflict, the INSERT
 * succeeded, and the same human now existed twice. Measured on production
 * 2026-09-12: **1217 contacts with an email, 1209 distinct addresses — eight
 * real people with two rows each.** Both halves are then live at once: one
 * carries the `customer` status and the lifetime value, the other carries the
 * bookings' `contact_id` and the active sequence enrollment, and no guard
 * written against either can see the other.
 *
 * So: the lookup is case-insensitive (`findContactsByEmail`), and what follows
 * is an UPDATE BY ID or an INSERT, never an upsert keyed on a raw address.
 *
 * **The stored spelling is never rewritten.** `email` is deliberately absent
 * from the update payload. Lowercasing the 21 mixed-case rows in place risks a
 * collision against `contacts_email_key` — eight of them WOULD collide — and it
 * does nothing about the 22nd address somebody types tomorrow. The lookup is
 * the fix, not the data.
 *
 * `status` is still set only on INSERT. That was link 9's finding and it stands:
 * `contacts.status` holds `customer` (429 rows) and `unsubscribed`, which is
 * half of what `optedOutReason()` reads before every marketing send, so writing
 * `status: 'lead'` unconditionally made this function a writer of opt-out
 * state, in the wrong direction and silently.
 */
export async function upsertContactResult({
  name,
  email,
  phone,
  sourceDetail,
  serviceInterests,
  marketingConsent,
}: UpsertContactParams): Promise<UpsertContactOutcome> {
  const supabase = getSupabase()
  const nameParts = name.trim().split(/\s+/)

  const prior = await findContactsByEmail(
    supabase,
    email,
    'id, email, status, email_opt_in, quo_contact_id'
  )
  if (prior.kind === 'unavailable') {
    // Rule 12: "could not read" is not "there is no such contact". Guessing
    // `absent` here is what created the duplicates in the first place.
    console.error('upsertContact: could not read existing contact:', prior.error)
    return { kind: 'unavailable', error: prior.error }
  }

  const fields: Record<string, unknown> = {
    first_name: nameParts[0],
    last_name: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
    phone: phone || null,
    source: 'direct',
    source_detail: sourceDetail,
    service_interests: normalizeServiceInterests(serviceInterests),
  }

  // Only set opt-in fields when consent is explicitly provided (true).
  // Never flip opt-in to false here — that is the unsubscribe flows' job.
  if (marketingConsent) {
    const now = new Date().toISOString()
    fields.email_opt_in = true
    fields.sms_opt_in = true
    fields.email_opt_in_at = now
    fields.sms_opt_in_at = now
  }

  let contactId: string
  let kind: 'created' | 'updated'
  let existing = prior.kind === 'found' ? (prior.primary as ContactRow) : null
  const priorRowCount = prior.kind === 'found' ? prior.contacts.length : 0

  if (existing) {
    const written = await updateContactById(supabase, existing.id, fields)
    if (!written.ok) return { kind: 'unavailable', error: written.error }
    contactId = existing.id
    kind = 'updated'
    if (priorRowCount > 1) {
      // Not silent (rule 10). This is needs-Adam 31 and a human should be able
      // to find out that it bit, from the log, on the day it bit.
      console.warn(
        `upsertContact: ${priorRowCount} contact rows share ${maskEmail(email)} — ` +
          `writing to the oldest (${existing.id}); the others are NOT updated. See needs-Adam 31.`
      )
    }
  } else {
    const created = await insertContact(supabase, { ...fields, email, status: 'lead' })
    if (created.kind === 'unavailable') return created
    if (created.kind === 'raced') {
      // 23505 on `contacts_email_key` after an `absent` read means another
      // writer inserted this exact spelling between the two statements. Re-read
      // and update rather than reporting a failure for a row that now exists.
      const again = await findContactsByEmail(
        supabase,
        email,
        'id, email, status, email_opt_in, quo_contact_id'
      )
      if (again.kind !== 'found') {
        return {
          kind: 'unavailable',
          error: `insert refused with 23505 but no row is readable: ${created.error}`,
        }
      }
      existing = again.primary as ContactRow
      const written = await updateContactById(supabase, existing.id, fields)
      if (!written.ok) return { kind: 'unavailable', error: written.error }
      contactId = existing.id
      kind = 'updated'
      console.warn(`upsertContact: lost a race inserting ${maskEmail(email)} — updated ${contactId} instead`)
    } else {
      contactId = created.contactId
      kind = 'created'
    }
  }

  // ── The outward mirror.
  //
  // `optedOutReason` is imported rather than restated (rule 11): "may we put
  // this person on the marketing list" is one question and it already has one
  // answer, which reads BOTH `email_opt_in` and `status = 'unsubscribed'`. This
  // call site used to read only the first, so an admin-marked `unsubscribed`
  // contact would have been handed back to Brevo's list by their next enquiry.
  const priorRow = existing ?? null
  const consented = marketingConsent
    ? true
    : !!priorRow && optedOutReason(priorRow) === null && priorRow.email_opt_in === true

  const mirror = await syncContactExternally({
    contactId,
    email,
    phone: phone || null,
    firstName: nameParts[0],
    lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
    emailOptIn: consented,
    existingQuoId: priorRow?.quo_contact_id ?? null,
  })

  return { kind, contactId, mirror }
}

interface ContactRow {
  id: string
  email?: string | null
  status?: string | null
  email_opt_in?: boolean | null
  quo_contact_id?: string | null
}

async function updateContactById(
  supabase: ReturnType<typeof getSupabase>,
  id: string,
  fields: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; error: string }> {
  // `.select('id')` so a zero-row update is visible. An UPDATE with no select
  // cannot tell you it matched nothing (rule 19).
  const { data, error } = await supabase.from('contacts').update(fields).eq('id', id).select('id')
  if (error) {
    console.error('upsertContact: update failed:', error.message)
    return { ok: false, error: error.message }
  }
  if (!data || data.length === 0) {
    console.error(`upsertContact: update matched no row for contact ${id}`)
    return { ok: false, error: `update matched no row for contact ${id}` }
  }
  return { ok: true }
}

type InsertOutcome =
  | { kind: 'created'; contactId: string }
  | { kind: 'raced'; error: string }
  | { kind: 'unavailable'; error: string }

async function insertContact(
  supabase: ReturnType<typeof getSupabase>,
  record: Record<string, unknown>
): Promise<InsertOutcome> {
  const { data, error } = await supabase.from('contacts').insert(record).select('id').single()
  if (error) {
    if (isUniqueViolation(error)) return { kind: 'raced', error: error.message }
    console.error('upsertContact: insert failed:', error.message)
    return { kind: 'unavailable', error: error.message }
  }
  if (!data?.id) return { kind: 'unavailable', error: 'insert returned no id' }
  return { kind: 'created', contactId: String(data.id) }
}

function maskEmail(email: string): string {
  const at = String(email).indexOf('@')
  if (at <= 1) return '***'
  return `${email.slice(0, 3)}***${email.slice(at)}`
}

/**
 * The contact id, or null.
 *
 * A thin reading of `upsertContactResult` — ONE implementation, so the two
 * cannot drift (rule 11). Callers that need to tell "could not" from "did"
 * should call `upsertContactResult` directly; the twenty-one routes that only
 * need an id keep this.
 */
export async function upsertContact(params: UpsertContactParams): Promise<string | null> {
  try {
    const res = await upsertContactResult(params)
    if (res.kind === 'unavailable') return null
    return res.contactId
  } catch (err) {
    console.error('upsertContact error (non-fatal):', err)
    return null
  }
}

interface UpsertByPhoneParams {
  phone: string
  name?: string | null
  sourceDetail: string
  serviceInterests?: string[]
}

/**
 * Find-or-create a contact that only has a phone number (an unknown texter).
 * If a contact already owns this phone (with or without an email) it is
 * reused; otherwise a phone-only lead row is created and mirrored to Quo.
 * Returns the contact id, or null on error.
 *
 * THE LOOKUP USED TO BE `.eq('phone', phone)`, which is raw string equality on
 * a column holding `6314008080`, `+16314008080`, `631-400-8080`, `16318338149`
 * and `(631) 400-8080` for the same numbers. The Quo webhook hands this
 * function an E.164 `From`, so a number stored in any other shape missed and a
 * SECOND row was created for a texter we already knew. Measured 2026-09-12: 21
 * normalised numbers carry more than one contact row, one of them six.
 * `findContactsByPhone` compares the normalised number, and the canonical-row
 * rule decides which one is reused.
 */
export async function upsertContactByPhone({
  phone,
  name,
  sourceDetail,
  serviceInterests = ['general'],
}: UpsertByPhoneParams): Promise<string | null> {
  try {
    const supabase = getSupabase()
    const lookup = await findContactsByPhone(
      supabase,
      phone,
      'id, phone, email, first_name, last_name, email_opt_in, status, quo_contact_id'
    )
    if (lookup.kind === 'unavailable') {
      // Rule 12 again, and here it is the expensive direction: reading a blip
      // as "never heard of this number" is what mints the duplicate.
      console.error('upsertContactByPhone: contacts lookup FAILED — not creating:', lookup.error)
      return null
    }
    const existing = (lookup.kind === 'found' ? lookup.primary : null) as
      | (ContactRow & { first_name?: string | null; last_name?: string | null })
      | null

    if (existing?.id) {
      if (!existing.quo_contact_id) {
        await syncContactExternally({
          contactId: existing.id,
          email: existing.email,
          phone,
          firstName: existing.first_name,
          lastName: existing.last_name,
          // One definition of "may we market to this person" (rule 11).
          emailOptIn: optedOutReason(existing) === null && existing.email_opt_in === true,
        }).catch(() => undefined)
      }
      return existing.id
    }

    const nameParts = (name || '').trim().split(/\s+/).filter(Boolean)
    const { data: created, error } = await supabase
      .from('contacts')
      .insert({
        email: null,
        phone,
        first_name: nameParts[0] || null,
        last_name: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
        status: 'lead',
        source: 'direct',
        source_detail: sourceDetail,
        service_interests: normalizeServiceInterests(serviceInterests),
      })
      .select('id')
      .single()

    if (error || !created) {
      console.error('upsertContactByPhone insert error:', error)
      return null
    }

    await syncContactExternally({
      contactId: created.id,
      phone,
      firstName: nameParts[0] || null,
      lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
    }).catch(() => undefined)

    return created.id
  } catch (err) {
    console.error('upsertContactByPhone error (non-fatal):', err)
    return null
  }
}
