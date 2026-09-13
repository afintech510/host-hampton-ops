import { getSupabase } from '@/lib/supabase'
import { findBookingsByContactEmail } from '@/lib/contactLookup'

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
 * What an enrolment attempt did — five outcomes, because "nothing happened" had
 * been covering four different facts (rule 12) on the path that decides whether
 * a real person starts receiving marketing email.
 */
export type EnrollResult =
  | { kind: 'enrolled'; sequences: number }
  /** Already a customer — deliberately not nurtured as a lead. */
  | { kind: 'skipped-booked' }
  /** No active sequence matches this trigger. Nothing is wrong. */
  | { kind: 'no-sequences' }
  /** A read failed. NOTHING was enrolled, and a retry is safe. */
  | { kind: 'deferred'; reason: string }
  | { kind: 'failed'; reason: string; enrolled: number }

/**
 * Enroll a contact into all matching active sequences for a trigger event.
 * Idempotent — duplicate enrollments are silently ignored.
 * Non-fatal — errors are reported but never thrown.
 */
export async function enrollInSequence({
  contactId,
  contactEmail,
  triggerEvent,
  serviceType,
  eventDate,
  bookingRef,
}: EnrollParams): Promise<EnrollResult> {
  try {
    const supabase = getSupabase()

    // For lead inquiries, skip if the contact already has a confirmed booking.
    //
    // This was `.eq('contact_email', contactEmail)` — case-SENSITIVE against a
    // column where 9 of 61 live rows are not lowercase, so a returning customer
    // who capitalises differently reads as a brand-new lead and starts getting
    // "here's why you should book with us" email. And the read error was
    // discarded, which makes a Supabase blip say the same thing.
    //
    // The safe direction is NOT to enrol: an unsent nurture email costs
    // nothing, and one sent to somebody who already paid us costs goodwill.
    if (triggerEvent === 'new_inquiry') {
      const booked = await findBookingsByContactEmail(supabase, contactEmail, 'id, status', {
        limit: 200,
      })
      if (booked.kind === 'unavailable') {
        console.error(
          `enrollInSequence: could not check for an existing booking (${booked.error}) — NOT enrolling`
        )
        return { kind: 'deferred', reason: `booking check failed: ${booked.error}` }
      }
      if (
        booked.kind === 'found' &&
        booked.bookings.some(b => ['deposit_paid', 'confirmed'].includes(String(b.status)))
      ) {
        console.log(`Skipping sequence enrollment — ${maskEmail(contactEmail)} already has a booking`)
        return { kind: 'skipped-booked' }
      }
    }

    // Find all active sequences matching the trigger
    const { data: sequences, error: seqErr } = await supabase
      .from('email_sequences')
      .select('id, service_filter, total_emails')
      .eq('trigger_event', triggerEvent)
      .eq('is_active', true)

    if (seqErr) {
      // "Could not read the sequence list" is not "there are no sequences".
      console.error('enrollInSequence: sequence read FAILED — nothing enrolled:', seqErr.message)
      return { kind: 'deferred', reason: `sequence read failed: ${seqErr.message}` }
    }
    if (!sequences || sequences.length === 0) return { kind: 'no-sequences' }

    const metadata: Record<string, string> = {}
    if (eventDate) metadata.event_date = eventDate
    if (bookingRef) metadata.booking_ref = bookingRef
    if (serviceType) metadata.service_type = serviceType

    let enrolled = 0
    let matched = 0
    const failures: string[] = []

    for (const seq of sequences) {
      // If sequence has a service filter, skip if it doesn't match
      if (seq.service_filter && seq.service_filter !== serviceType) continue
      // If sequence has no filter but another sequence does match, prefer the specific one
      // (still enroll in the generic one too — both apply)
      matched++

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
        console.error(`Sequence enrollment error for ${maskEmail(contactEmail)} → ${seq.id}:`, enrollErr)
        failures.push(String(seq.id))
      } else {
        enrolled++
      }
    }

    if (matched === 0) return { kind: 'no-sequences' }
    if (failures.length) {
      // The old code logged "Enrolled X in sequences" here unconditionally,
      // including when every single upsert had just been refused (rule 10).
      return { kind: 'failed', reason: `${failures.length} of ${matched} refused`, enrolled }
    }
    console.log(
      `Enrolled ${maskEmail(contactEmail)} in ${enrolled} sequence(s) for trigger=${triggerEvent}`
    )
    return { kind: 'enrolled', sequences: enrolled }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error('enrollInSequence error (non-fatal):', reason)
    return { kind: 'failed', reason, enrolled: 0 }
  }
}

function maskEmail(email: string): string {
  const at = String(email).indexOf('@')
  if (at <= 1) return '***'
  return `${email.slice(0, 3)}***${email.slice(at)}`
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
