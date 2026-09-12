import { getSupabase } from '@/lib/supabase'
import { syncContactExternally } from '@/lib/contactSync'
import { findContactsByEmail } from '@/lib/contactLookup'

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
 * Upsert a contact into the contacts table (non-fatal).
 * Splits name into first/last, deduplicates on email.
 */
export async function upsertContact({
  name,
  email,
  phone,
  sourceDetail,
  serviceInterests,
  marketingConsent,
}: UpsertContactParams): Promise<string | null> {
  try {
    const supabase = getSupabase()
    const nameParts = name.trim().split(/\s+/)

    // Read BEFORE the upsert, because `upsert` overwrites every column in the
    // payload — and one of them used to be `status`.
    //
    // `contacts.status` is the `contact_status` enum, and two of its labels are
    // load-bearing: `customer` (429 rows today) and **`unsubscribed`**, which is
    // half of what `optedOutReason()` in lib/sequences/processor.ts reads before
    // every marketing send. Writing `status: 'lead'` unconditionally made this
    // function a FOURTH writer of opt-out state, in the wrong direction and
    // silently: an admin marking somebody unsubscribed in the Contacts tab had
    // it erased by that person's next enquiry form, and the sequencer then saw a
    // perfectly ordinary lead. It also demoted paying customers back to leads.
    //
    // A new contact is a lead. An existing one keeps whatever it had.
    const prior = await findContactsByEmail(supabase, email, 'id, email, status')
    if (prior.kind === 'unavailable') {
      // Rule 12: "could not read" is not "there is no such contact". Guessing
      // `lead` here is exactly the write this block exists to prevent.
      console.error('upsertContact: could not read existing contact:', prior.error)
      return null
    }

    const record: Record<string, unknown> = {
      email,
      first_name: nameParts[0],
      last_name: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
      phone: phone || null,
      source: 'direct',
      source_detail: sourceDetail,
      service_interests: normalizeServiceInterests(serviceInterests),
    }
    if (prior.kind === 'absent') record.status = 'lead'

    // Only set opt-in fields when consent is explicitly provided (true)
    // Never flip opt-in to false via this function — that's handled by unsubscribe flows
    if (marketingConsent) {
      const now = new Date().toISOString()
      record.email_opt_in = true
      record.sms_opt_in = true
      record.email_opt_in_at = now
      record.sms_opt_in_at = now
    }

    const { error: upsertErr } = await supabase.from('contacts').upsert(
      record,
      { onConflict: 'email' },
    )

    if (upsertErr) {
      console.error('upsertContact upsert error:', upsertErr)
      return null
    }

    const { data: contact } = await supabase
      .from('contacts')
      .select('id, email_opt_in, quo_contact_id')
      .eq('email', email)
      .single()

    const contactId: string | null = contact?.id ?? null

    // Mirror to Brevo + Quo so every list stays in sync (non-fatal, awaited so
    // serverless-style routes don't drop the work when the response returns).
    if (contactId) {
      await syncContactExternally({
        contactId,
        email,
        phone: phone || null,
        firstName: nameParts[0],
        lastName: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
        emailOptIn: !!(marketingConsent || contact?.email_opt_in),
        existingQuoId: contact?.quo_contact_id ?? null,
      }).catch(err => console.error('contact sync error (non-fatal):', err))
    }

    return contactId
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
 */
export async function upsertContactByPhone({
  phone,
  name,
  sourceDetail,
  serviceInterests = ['general'],
}: UpsertByPhoneParams): Promise<string | null> {
  try {
    const supabase = getSupabase()
    const { data: existing } = await supabase
      .from('contacts')
      .select('id, email, first_name, last_name, email_opt_in, quo_contact_id')
      .eq('phone', phone)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (existing?.id) {
      if (!existing.quo_contact_id) {
        await syncContactExternally({
          contactId: existing.id,
          email: existing.email,
          phone,
          firstName: existing.first_name,
          lastName: existing.last_name,
          emailOptIn: !!existing.email_opt_in,
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
