import { getSupabase } from '@/lib/supabase'

/**
 * Email sequence enrollment engine.
 *
 * Enrolls contacts into automated email sequences based on trigger events.
 * Sequences and steps are stored in DB (email_sequences / email_sequence_steps).
 * The /api/cron/process-sequences cron handles sending.
 */

interface EnrollParams {
  contactId: string
  contactEmail: string
  triggerEvent: 'new_inquiry' | 'booking_confirmed'
  serviceType?: string   // e.g. 'kids_party', 'room_rental'
  eventDate?: string     // YYYY-MM-DD for post-event steps
  bookingRef?: string
}

/**
 * Enroll a contact into all matching active sequences for a trigger event.
 * Idempotent — duplicate enrollments are silently ignored.
 * Non-fatal — errors are logged but never thrown.
 */
export async function enrollInSequence({
  contactId,
  contactEmail,
  triggerEvent,
  serviceType,
  eventDate,
  bookingRef,
}: EnrollParams): Promise<void> {
  try {
    const supabase = getSupabase()

    // For lead inquiries, skip if contact already has a confirmed booking
    if (triggerEvent === 'new_inquiry') {
      const { data: existingBooking } = await supabase
        .from('bookings')
        .select('id')
        .eq('contact_email', contactEmail)
        .in('status', ['deposit_paid', 'confirmed'])
        .limit(1)

      if (existingBooking && existingBooking.length > 0) {
        console.log(`Skipping sequence enrollment for ${contactEmail} — already has booking`)
        return
      }
    }

    // Find all active sequences matching the trigger
    const { data: sequences, error: seqErr } = await supabase
      .from('email_sequences')
      .select('id, service_filter, total_emails')
      .eq('trigger_event', triggerEvent)
      .eq('is_active', true)

    if (seqErr || !sequences || sequences.length === 0) return

    const metadata: Record<string, string> = {}
    if (eventDate) metadata.event_date = eventDate
    if (bookingRef) metadata.booking_ref = bookingRef
    if (serviceType) metadata.service_type = serviceType

    for (const seq of sequences) {
      // If sequence has a service filter, skip if it doesn't match
      if (seq.service_filter && seq.service_filter !== serviceType) continue
      // If sequence has no filter but another sequence does match, prefer the specific one
      // (still enroll in the generic one too — both apply)

      const { error: enrollErr } = await supabase
        .from('contact_sequence_enrollments')
        .upsert(
          {
            contact_id: contactId,
            sequence_id: seq.id,
            status: 'active',
            current_step: 0,
            metadata,
          },
          { onConflict: 'contact_id,sequence_id', ignoreDuplicates: true }
        )

      if (enrollErr) {
        console.error(`Sequence enrollment error for ${contactEmail} → ${seq.id}:`, enrollErr)
      }
    }

    console.log(`Enrolled ${contactEmail} in sequences for trigger=${triggerEvent}`)
  } catch (err) {
    console.error('enrollInSequence error (non-fatal):', err)
  }
}

/**
 * Replace simple template variables in email HTML.
 * Supported: {{first_name}}, {{business_name}}, {{booking_ref}}
 */
export function renderTemplate(
  html: string,
  vars: { firstName?: string; businessName?: string; bookingRef?: string }
): string {
  let result = html
  result = result.replace(/\{\{first_name\}\}/g, vars.firstName || 'there')
  result = result.replace(/\{\{business_name\}\}/g, vars.businessName || 'Host Hampton')
  result = result.replace(/\{\{booking_ref\}\}/g, vars.bookingRef || '')
  return result
}
