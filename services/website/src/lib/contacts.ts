import { getSupabase } from '@/lib/supabase'

interface UpsertContactParams {
  name: string
  email: string
  phone?: string | null
  sourceDetail: string
  serviceInterests: string[]
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
}: UpsertContactParams): Promise<string | null> {
  try {
    const supabase = getSupabase()
    const nameParts = name.trim().split(/\s+/)

    await supabase.from('contacts').upsert(
      {
        email,
        first_name: nameParts[0],
        last_name: nameParts.length > 1 ? nameParts.slice(1).join(' ') : null,
        phone: phone || null,
        status: 'lead',
        source: 'direct',
        source_detail: sourceDetail,
        service_interests: serviceInterests,
      },
      { onConflict: 'email' },
    )

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
