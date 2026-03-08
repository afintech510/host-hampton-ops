import { getSupabase } from '@/lib/supabase'

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

    const record: Record<string, unknown> = {
      email,
      first_name: nameParts[0],
      last_name: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
      phone: phone || null,
      status: 'lead',
      source: 'direct',
      source_detail: sourceDetail,
      service_interests: normalizeServiceInterests(serviceInterests),
    }

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
      .select('id')
      .eq('email', email)
      .single()

    return contact?.id ?? null
  } catch (err) {
    console.error('upsertContact error (non-fatal):', err)
    return null
  }
}
