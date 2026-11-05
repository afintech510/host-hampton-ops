import type { getSupabase } from '@/lib/supabase'
import { bookingStage, etToday } from '@/lib/bookingStatus'
import { sumPayments } from '@/lib/bookingBalance'
import { findContactsByEmail } from '@/lib/contactLookup'
import { optedOutReason } from '@/lib/sequences/processor'
import { renderStepEmail } from '@/lib/sequences/render'
import { generateUnsubscribeToken } from '@/lib/unsubscribeLink'
import { TENANT } from '@/tenant'
import { firstNameOf, maskEmail } from './outboundText'
import type { BuiltCard, CardBooking, MessagePreview } from './messageCard'

/**
 * Nurture sequences, for the Manager assistant: read the sequences, and build the
 * "enrol this lead" card with the steps and the FIRST MESSAGE shown as it will be
 * read — before anyone confirms.
 *
 * Reads only. Enrolling is `/api/admin/sequences/enroll`, replayed by
 * execute.ts after a human presses Confirm; that route re-checks consent, stage
 * and duplicates itself, and this module's checks are only so the card can say
 * "this would be refused" before the click.
 */

type Supa = ReturnType<typeof getSupabase>

/**
 * Is `/api/cron/process-sequences` on a schedule? It is not, deliberately (45
 * enrollments are frozen and a human decides when it runs), so enrolling a lead
 * queues them and sends nothing. `assistantNurture.test.ts` reads
 * `scripts/cron/jobs.tsv` and fails if this stops matching it — the card's
 * promise ("nothing is sent now") must not outlive the schedule it describes.
 */
export const SEQUENCE_SENDER_SCHEDULED = false

export interface SequenceSummary {
  id: string
  name: string
  trigger_event: string
  service_filter: string | null
  is_active: boolean
  steps: Array<{ step: number; subject: string; delay_days: number; delay_reference: string }>
}

export async function listSequences(sb: Supa, onlyActive = true): Promise<{ kind: 'ok'; sequences: SequenceSummary[] } | { kind: 'unavailable' }> {
  let q = sb.from('email_sequences').select('id, name, trigger_event, service_filter, is_active').order('name')
  if (onlyActive) q = q.eq('is_active', true)
  const seqs = await q
  if (seqs.error) return { kind: 'unavailable' }
  const rows = (seqs.data ?? []) as Array<Omit<SequenceSummary, 'steps'>>
  if (rows.length === 0) return { kind: 'ok', sequences: [] }
  const steps = await sb
    .from('email_sequence_steps')
    .select('sequence_id, step_number, subject, delay_days, delay_reference')
    .in('sequence_id', rows.map(r => r.id))
    .order('step_number', { ascending: true })
  if (steps.error) return { kind: 'unavailable' }
  const by = new Map<string, SequenceSummary['steps']>()
  for (const s of (steps.data ?? []) as Array<{ sequence_id: string; step_number: number; subject: string; delay_days: number; delay_reference: string }>) {
    by.set(s.sequence_id, [...(by.get(s.sequence_id) ?? []), { step: s.step_number, subject: s.subject, delay_days: s.delay_days, delay_reference: s.delay_reference }])
  }
  return { kind: 'ok', sequences: rows.map(r => ({ ...r, steps: by.get(r.id) ?? [] })) }
}

const delayWords = (days: number, ref: string) =>
  ref === 'event_date'
    ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ${days < 0 ? 'before' : 'after'} the party`
    : days === 0 ? 'right away' : `${days} day${days === 1 ? '' : 's'} after enrolling`

export async function buildEnrolCard(
  sb: Supa,
  b: CardBooking & { contact_id?: string | null; total_cents?: number | null },
  sequenceId: string,
  now: Date = new Date(),
): Promise<BuiltCard> {
  const { data: seq, error } = await sb.from('email_sequences').select('id, name, trigger_event, service_filter, is_active').eq('id', sequenceId).maybeSingle()
  if (error) return { ok: false, error: 'Could not read that sequence — say so.' }
  if (!seq) return { ok: false, error: 'No sequence with that id. Use list_sequences for the ids.' }
  const sequence = seq as { id: string; name: string; trigger_event: string; service_filter: string | null; is_active: boolean }

  const { data: stepRows, error: stepErr } = await sb
    .from('email_sequence_steps')
    .select('step_number, subject, body_html, body_text, delay_days, delay_reference')
    .eq('sequence_id', sequence.id)
    .order('step_number', { ascending: true })
  if (stepErr) return { ok: false, error: 'Could not read the sequence steps — say so.' }
  const steps = (stepRows ?? []) as Array<{ step_number: number; subject: string; body_html: string; body_text: string | null; delay_days: number; delay_reference: string }>
  if (steps.length === 0) return { ok: false, error: `"${sequence.name}" has no steps, so there is nothing to send.` }

  const status: string[] = []
  let level: MessagePreview['level'] = 'ok'
  const block = (s: string) => { level = 'blocked'; status.push(s) }

  if (!sequence.is_active) block(`"${sequence.name}" is switched off — nobody can be enrolled in it.`)

  // The same stage rule the enroll route applies.
  const pay = await sb.from('booking_payments').select('amount_cents, payment_type').eq('booking_id', b.id)
  if (pay.error) return { ok: false, error: 'Could not read the payments to tell whether this is still a lead — say so.' }
  const stage = bookingStage({ status: b.status, paidCents: sumPayments(pay.data), partyDate: b.party_date ?? null, today: etToday(now) })
  if (stage !== 'inquiry' && stage !== 'quoted') block(`This party is ${stage}; nurture is for leads, so the enrollment would be refused.`)

  // Consent, read now, with the sender's own function.
  const CONTACT_COLUMNS = 'id, email, first_name, email_opt_in, status'
  type ContactRow = { id: string; email: string | null; first_name: string | null; email_opt_in: boolean | null; status: string | null }
  let contact: ContactRow | null = null
  if (b.contact_id) {
    const r = await sb.from('contacts').select(CONTACT_COLUMNS).eq('id', b.contact_id).maybeSingle()
    if (r.error) return { ok: false, error: 'Could not read the contact to check email consent — say so.' }
    contact = (r.data as ContactRow | null) ?? null
  } else if (b.contact_email) {
    const r = await findContactsByEmail(sb, b.contact_email, CONTACT_COLUMNS)
    if (r.kind === 'unavailable') return { ok: false, error: 'Could not read the contact to check email consent — say so.' }
    contact = r.kind === 'found' ? (r.primary as unknown as ContactRow) : null
  }
  if (!contact || !contact.email) {
    block('There is no contact record with an email address for this lead, so there is nobody to enrol.')
  } else {
    const out = optedOutReason(contact, 'email')
    if (out) block(`This person has opted out of email (${out}) — the enrollment would be refused.`)
    else status.push(contact.email_opt_in === true ? 'Email consent: opted in.' : 'Email consent: not opted out (no explicit opt-in recorded).')

    const ex = await sb.from('contact_sequence_enrollments').select('status').eq('contact_id', contact.id).eq('sequence_id', sequence.id).maybeSingle()
    if (ex.error) return { ok: false, error: 'Could not check existing enrollments — say so.' }
    if (ex.data) block(`Already enrolled in this sequence (${(ex.data as { status: string }).status}) — nothing would change.`)
  }

  status.push(
    SEQUENCE_SENDER_SCHEDULED
      ? 'Emails go out on the sequence schedule.'
      : 'Nothing is sent now. Sequence emails only go out when the sequence sender runs, and it is switched off — enrolling queues this person and sends nothing.',
  )

  // The first message, rendered the way the sender would, for this person.
  const first = steps[0]
  const token = contact?.email ? generateUnsubscribeToken(contact.email) : null
  const rendered = renderStepEmail(
    first,
    { firstName: firstNameOf(b.contact_name), businessName: TENANT.business.name, bookingRef: b.booking_ref },
    token ?? 'preview',
  )
  const display = (rendered.text ?? stripTags(rendered.html)).trim().slice(0, 2500)

  const stepLines = steps.map(s => `Step ${s.step_number}: "${s.subject}" — ${delayWords(s.delay_days, s.delay_reference)}`)
  return {
    ok: true,
    input: { bookingId: b.id, bookingRef: b.booking_ref, sequenceId: sequence.id, sequenceName: sequence.name },
    title: `Enrol ${firstNameOf(b.contact_name)} in "${sequence.name}"`,
    details: [`Party: ${b.booking_ref}${b.party_date ? ` on ${b.party_date}` : ''}`, `${steps.length} email${steps.length === 1 ? '' : 's'}:`, ...stepLines],
    preview: {
      recipient: firstNameOf(b.contact_name),
      level,
      status,
      channels: [
        {
          channel: 'email', to: maskEmail(b.contact_email ?? contact?.email), subject: rendered.subject,
          template: display, display, editable: false,
          notes: ['This is the first email, as it will be read. The wording lives in the sequence; it cannot be changed from here.'],
        },
      ],
    },
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
}
