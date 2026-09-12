/**
 * The email sequence processor.
 *
 * `/api/cron/process-sequences` has existed since 2026-03-10 and is not
 * greenfield — it has sent real marketing email to real customers. Measured in
 * production on 2026-09-12: 57 enrollments carry a `last_sent_at`, the newest
 * 2026-08-16, on timestamps that land on 15-minute boundaries. It ran on a
 * schedule, and then the schedule stopped. 44 enrollments are still `active`,
 * frozen mid-sequence.
 *
 * So this is a rewrite of something that WORKED, with four things it got wrong:
 *
 * 1. **It was check-then-act.** Read `current_step`, send, write `current_step`.
 *    Two overlapping ticks both read the same step and both send. The same shape
 *    plan §22 found in the email-me cooldown, where five concurrent calls sent
 *    three emails. Fixed with `email_sequence_sends` (migration 043): the claim
 *    row is inserted BEFORE the send and the unique index on
 *    `(enrollment_id, step_number)` is the guarantee. 23505 is handled **by
 *    code**, never by message text.
 *
 * 2. **A transient failure was terminal, twice over** (hard-won rule 3, and
 *    rule 12: a lookup that can fail needs THREE outcomes). A blip reading
 *    `email_sequence_steps` returned `{ data: null }`, which the old code read
 *    as "step missing" and used to mark the enrollment **`completed`** —
 *    permanently ending a real customer's sequence because of one bad second. A
 *    blip reading `contacts` marked them **`unsubscribed`**, which is worse:
 *    that is a claim about what a person asked for. Every lookup here is
 *    `found | absent | unavailable`, and `unavailable` changes nothing.
 *
 * 3. **Its activity log never wrote a row.** See `lib/contactInteractions.ts`.
 *
 * 4. **Its mail had no unsubscribe link.** See `lib/unsubscribeLink.ts`.
 *
 * The opt-out check was, to its credit, already in the right place — at SEND
 * time, not at enrolment — and it stays there, reading both `email_opt_in` and
 * `contacts.status`, because the Brevo webhook writes the first and an admin
 * writes the second.
 */

import { getSupabase } from '@/lib/supabase'
import { logInteraction } from '@/lib/contactInteractions'
import { generateUnsubscribeToken, unsubscribeHeaders } from '@/lib/unsubscribeLink'
import { renderStepEmail } from '@/lib/sequences/render'

type Supa = ReturnType<typeof getSupabase>

/** How many enrollments one tick will look at. */
export const BATCH_SIZE = 50

/**
 * A claim older than this with no outcome is assumed abandoned (the container
 * was restarted mid-send) and may be retried. Longer than any plausible Resend
 * call, so a slow send is never raced by the next tick.
 */
export const STALE_CLAIM_MS = 10 * 60 * 1000

/**
 * Give-up threshold. After this many attempts at ONE step the send row goes
 * `failed` and the enrollment is `paused` — not `completed`, because the
 * customer did not finish the sequence, and not left `active`, because a step
 * that cannot send would otherwise be retried every 15 minutes forever.
 */
export const MAX_ATTEMPTS = 5

/** Postgres unique-violation. Matched on the CODE; message text is not an API. */
const UNIQUE_VIOLATION = '23505'

export type Lookup<T> =
  | { kind: 'found'; value: T }
  | { kind: 'absent' }
  | { kind: 'unavailable'; error: string }

export interface SendResult {
  ok: boolean
  id?: string | null
  error?: string
}

export type EmailSender = (msg: {
  to: string
  subject: string
  html: string
  text?: string
  headers: Record<string, string>
}) => Promise<SendResult>

export interface ProcessOptions {
  supabase?: Supa
  sendEmail?: EmailSender
  now?: Date
  batchSize?: number
}

export interface ProcessSummary {
  scanned: number
  sent: number
  /** Not due yet, sequence inactive, or completed — an ordinary outcome. */
  skipped: number
  /** Somebody else owns this step, or it was already sent and we caught up. */
  claimedElsewhere: number
  /** Could not tell. Nothing was changed and it will be retried. */
  deferred: number
  failed: number
  unsubscribed: number
  completed: number
  paused: number
  notes: string[]
}

function emptySummary(): ProcessSummary {
  return {
    scanned: 0,
    sent: 0,
    skipped: 0,
    claimedElsewhere: 0,
    deferred: 0,
    failed: 0,
    unsubscribed: 0,
    completed: 0,
    paused: 0,
    notes: [],
  }
}

/** Resend, wrapped so the processor can be driven without a network. */
export function defaultSender(): EmailSender | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null

  return async msg => {
    try {
      // Imported lazily so a test that injects a sender never loads the SDK.
      const { Resend } = await import('resend')
      const resend = new Resend(key)
      const from = process.env.RESEND_FROM_EMAIL || 'noreply@mail.hosthampton.com'
      const { data, error } = await resend.emails.send({
        from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        ...(msg.text ? { text: msg.text } : {}),
        headers: msg.headers,
      })
      if (error) return { ok: false, error: `${error.name ?? 'resend'}: ${error.message ?? String(error)}` }
      return { ok: true, id: data?.id ?? null }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}

/* ── lookups, each with three outcomes ─────────────────────────────────── */

async function loadStep(
  supabase: Supa,
  sequenceId: string,
  stepNumber: number
): Promise<Lookup<any>> {
  const { data, error } = await supabase
    .from('email_sequence_steps')
    .select('*')
    .eq('sequence_id', sequenceId)
    .eq('step_number', stepNumber)
    .maybeSingle()

  if (error) return { kind: 'unavailable', error: error.message }
  if (!data) return { kind: 'absent' }
  return { kind: 'found', value: data }
}

async function loadContact(supabase: Supa, contactId: string): Promise<Lookup<any>> {
  const { data, error } = await supabase
    .from('contacts')
    .select('id, email, first_name, email_opt_in, status')
    .eq('id', contactId)
    .maybeSingle()

  if (error) return { kind: 'unavailable', error: error.message }
  if (!data) return { kind: 'absent' }
  return { kind: 'found', value: data }
}

/* ── the claim ─────────────────────────────────────────────────────────── */

export type Claim =
  | { kind: 'claimed'; sendId: string; attempts: number }
  /** Already delivered. The enrollment simply needs to catch up. */
  | { kind: 'already_sent'; sendId: string }
  /** Another tick holds it, or it is a give-up row. Leave it alone. */
  | { kind: 'held'; reason: string }
  | { kind: 'unavailable'; error: string }

/**
 * Take exclusive ownership of (enrollment, step) before sending anything.
 *
 * The insert is the lock. If it succeeds we own the step; if it returns 23505
 * somebody else already claimed it and we look at what came of that, which is
 * also the crash-recovery path: a row left `claimed` by a container that died
 * mid-send is taken over after STALE_CLAIM_MS by a CONDITIONAL update that
 * includes the attempts count we read, so two ticks reaching that branch
 * together cannot both win.
 */
export async function claimStep(
  supabase: Supa,
  enrollment: { id: string; contact_id: string; sequence_id: string },
  stepNumber: number,
  toEmail: string,
  now: Date
): Promise<Claim> {
  const { data, error } = await supabase
    .from('email_sequence_sends')
    .insert({
      enrollment_id: enrollment.id,
      step_number: stepNumber,
      contact_id: enrollment.contact_id,
      sequence_id: enrollment.sequence_id,
      status: 'claimed',
      attempts: 1,
      provider: 'resend',
      to_email: toEmail,
      claimed_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .select('id')
    .single()

  if (!error && data) return { kind: 'claimed', sendId: data.id, attempts: 1 }

  if (error && error.code !== UNIQUE_VIOLATION) {
    return { kind: 'unavailable', error: error.message }
  }

  // 23505 — a row already exists for this step. Find out what it says.
  const { data: existing, error: readErr } = await supabase
    .from('email_sequence_sends')
    .select('id, status, attempts, claimed_at')
    .eq('enrollment_id', enrollment.id)
    .eq('step_number', stepNumber)
    .maybeSingle()

  if (readErr) return { kind: 'unavailable', error: readErr.message }
  if (!existing) {
    // The insert said it exists and the read says it does not. Could not tell.
    return { kind: 'unavailable', error: 'claim row vanished between insert and read' }
  }

  if (existing.status === 'sent') return { kind: 'already_sent', sendId: existing.id }
  if (existing.status === 'failed') return { kind: 'held', reason: 'step previously failed' }
  if (existing.status === 'skipped') return { kind: 'held', reason: 'step deliberately skipped' }

  const claimedAt = Date.parse(existing.claimed_at ?? '')
  // An unreadable claim timestamp counts as FRESH — the safe direction is to
  // leave a claim we cannot age alone rather than re-send on top of it.
  if (!Number.isFinite(claimedAt) || now.getTime() - claimedAt < STALE_CLAIM_MS) {
    return { kind: 'held', reason: 'claimed by another run' }
  }

  const attempts = Number(existing.attempts ?? 1)
  if (attempts >= MAX_ATTEMPTS) return { kind: 'held', reason: `max attempts (${attempts}) reached` }

  const { data: taken, error: takeErr } = await supabase
    .from('email_sequence_sends')
    .update({ attempts: attempts + 1, claimed_at: now.toISOString(), updated_at: now.toISOString() })
    .eq('id', existing.id)
    .eq('status', 'claimed')
    .eq('attempts', attempts) // ← the conditional that makes the takeover safe
    .select('id')

  if (takeErr) return { kind: 'unavailable', error: takeErr.message }
  if (!taken || taken.length === 0) return { kind: 'held', reason: 'takeover lost to another run' }

  return { kind: 'claimed', sendId: existing.id, attempts: attempts + 1 }
}

/* ── the processor ─────────────────────────────────────────────────────── */

export async function processSequences(opts: ProcessOptions = {}): Promise<ProcessSummary> {
  const supabase = opts.supabase ?? getSupabase()
  const now = opts.now ?? new Date()
  const summary = emptySummary()

  const sender = opts.sendEmail ?? defaultSender()

  const { data: enrollments, error } = await supabase
    .from('contact_sequence_enrollments')
    .select(
      `id, contact_id, sequence_id, current_step, enrolled_at, last_sent_at, metadata,
       email_sequences!inner(id, name, total_emails, is_active)`
    )
    .eq('status', 'active')
    // Deterministic and fair: the longest-waiting enrollment is processed first,
    // so a batch cap can never starve one by luck of the unordered scan.
    .order('enrolled_at', { ascending: true })
    .limit(opts.batchSize ?? BATCH_SIZE)

  if (error) {
    summary.notes.push(`enrollment read failed: ${error.message}`)
    throw new Error(`process-sequences: could not read enrollments — ${error.message}`)
  }

  summary.scanned = enrollments?.length ?? 0
  if (!enrollments || enrollments.length === 0) return summary

  if (!sender) {
    // Rule 10: a run that sends nothing because it is unconfigured must not look
    // like a run that had nothing to send.
    summary.deferred = enrollments.length
    summary.notes.push('RESEND_API_KEY is not set — nothing was sent and no state was changed')
    console.warn('cron:sequences RESEND_API_KEY not set — deferring all enrollments')
    return summary
  }

  for (const enrollment of enrollments) {
    try {
      await processOne(supabase, enrollment, now, sender, summary)
    } catch (err) {
      summary.deferred++
      const msg = err instanceof Error ? err.message : String(err)
      summary.notes.push(`enrollment ${enrollment.id}: ${msg}`)
      console.error('cron:sequences unexpected error', enrollment.id, msg)
    }
  }

  return summary
}

async function processOne(
  supabase: Supa,
  enrollment: any,
  now: Date,
  sender: EmailSender,
  summary: ProcessSummary
): Promise<void> {
  const seq = Array.isArray(enrollment.email_sequences)
    ? enrollment.email_sequences[0]
    : enrollment.email_sequences

  if (!seq?.is_active) {
    summary.skipped++
    return
  }

  const nextStepNum = Number(enrollment.current_step ?? 0) + 1

  if (nextStepNum > Number(seq.total_emails ?? 0)) {
    await completeEnrollment(supabase, enrollment.id, now, summary)
    return
  }

  const stepLookup = await loadStep(supabase, enrollment.sequence_id, nextStepNum)
  if (stepLookup.kind === 'unavailable') {
    // The old code marked the enrollment `completed` here. A read error is not
    // a missing step.
    summary.deferred++
    summary.notes.push(`enrollment ${enrollment.id}: step ${nextStepNum} unreadable (${stepLookup.error})`)
    return
  }
  if (stepLookup.kind === 'absent') {
    // Genuinely no such step, and `total_emails` says there should be one. The
    // sequence is short: finish it rather than retrying an absence forever, and
    // SAY so — this is a content problem a human has to fix.
    summary.notes.push(
      `sequence "${seq.name}" declares ${seq.total_emails} emails but step ${nextStepNum} does not exist — completing enrollment ${enrollment.id}`
    )
    console.warn(`cron:sequences missing step ${nextStepNum} on sequence ${enrollment.sequence_id}`)
    await completeEnrollment(supabase, enrollment.id, now, summary)
    return
  }
  const step = stepLookup.value

  if (!isDue(enrollment, step, nextStepNum, now)) {
    summary.skipped++
    return
  }

  const contactLookup = await loadContact(supabase, enrollment.contact_id)
  if (contactLookup.kind === 'unavailable') {
    // The old code marked the enrollment `unsubscribed` here — a claim about
    // what a person wants, made on the strength of a failed SELECT.
    summary.deferred++
    summary.notes.push(`enrollment ${enrollment.id}: contact unreadable (${contactLookup.error})`)
    return
  }
  if (contactLookup.kind === 'absent') {
    summary.notes.push(`enrollment ${enrollment.id}: contact ${enrollment.contact_id} no longer exists — cancelling`)
    await setEnrollmentStatus(supabase, enrollment.id, 'unsubscribed')
    summary.unsubscribed++
    return
  }
  const contact = contactLookup.value

  const optOutReason = optedOutReason(contact)
  if (optOutReason) {
    // The hazard the whole surface exists to avoid: someone enrolled on day 0
    // who unsubscribes on day 2 must not get the day-5 email. This is read HERE,
    // at send time, not at enrolment.
    await setEnrollmentStatus(supabase, enrollment.id, 'unsubscribed')
    summary.unsubscribed++
    summary.notes.push(`enrollment ${enrollment.id}: stopped before step ${nextStepNum} — ${optOutReason}`)
    console.log(`cron:sequences opt-out honoured before step ${nextStepNum} (${optOutReason})`)
    return
  }

  if (!contact.email) {
    await setEnrollmentStatus(supabase, enrollment.id, 'paused')
    summary.paused++
    summary.notes.push(`enrollment ${enrollment.id}: contact has no email address — paused`)
    return
  }

  const token = generateUnsubscribeToken(contact.email)
  if (!token) {
    // No signing secret means no working unsubscribe link. Declining to send is
    // the correct outcome: marketing mail with a dead opt-out is worse than
    // marketing mail that did not go.
    summary.deferred++
    summary.notes.push('PORTAL_LINK_SIGNING_SECRET is not set — cannot mint an unsubscribe link, nothing sent')
    console.error('cron:sequences PORTAL_LINK_SIGNING_SECRET missing — refusing to send without an unsubscribe link')
    return
  }

  const claim = await claimStep(supabase, enrollment, nextStepNum, contact.email, now)

  if (claim.kind === 'unavailable') {
    summary.deferred++
    summary.notes.push(`enrollment ${enrollment.id}: could not claim step ${nextStepNum} (${claim.error})`)
    return
  }
  if (claim.kind === 'held') {
    summary.claimedElsewhere++
    summary.notes.push(`enrollment ${enrollment.id}: step ${nextStepNum} ${claim.reason}`)
    return
  }
  if (claim.kind === 'already_sent') {
    // Crash recovery: the send landed but the enrollment never advanced. Catch
    // the enrollment up WITHOUT sending again.
    summary.claimedElsewhere++
    await advanceEnrollment(supabase, enrollment, nextStepNum, seq, now, summary)
    return
  }

  const rendered = renderStepEmail(step, {
    firstName: contact.first_name,
    bookingRef: (enrollment.metadata || {}).booking_ref,
  }, token)

  const result = await sender({
    to: contact.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: unsubscribeHeaders(token),
  })

  if (!result.ok) {
    const giveUp = claim.attempts >= MAX_ATTEMPTS
    await supabase
      .from('email_sequence_sends')
      .update({
        status: giveUp ? 'failed' : 'claimed',
        last_error: (result.error ?? 'unknown send error').slice(0, 500),
        // Release the claim immediately on a retryable failure so the next tick
        // picks it up rather than waiting out STALE_CLAIM_MS.
        claimed_at: giveUp ? now.toISOString() : new Date(0).toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', claim.sendId)

    summary.failed++
    summary.notes.push(
      `enrollment ${enrollment.id}: step ${nextStepNum} send failed (attempt ${claim.attempts}/${MAX_ATTEMPTS}) — ${result.error}`
    )
    console.error(`cron:sequences send failed step ${nextStepNum} attempt ${claim.attempts}: ${result.error}`)

    if (giveUp) {
      await setEnrollmentStatus(supabase, enrollment.id, 'paused')
      summary.paused++
      summary.notes.push(
        `enrollment ${enrollment.id}: PAUSED after ${MAX_ATTEMPTS} failed attempts at step ${nextStepNum} — needs a human`
      )
    }
    // current_step is NOT advanced. A transient failure is not a delivery.
    return
  }

  // Mark the send BEFORE advancing the enrollment. If the process dies between
  // these two writes the next tick sees `sent` and catches the enrollment up,
  // which is the one ordering that cannot produce a second email.
  await supabase
    .from('email_sequence_sends')
    .update({
      status: 'sent',
      provider_id: result.id ?? null,
      sent_at: now.toISOString(),
      updated_at: now.toISOString(),
      last_error: null,
    })
    .eq('id', claim.sendId)

  await advanceEnrollment(supabase, enrollment, nextStepNum, seq, now, summary)

  await logInteraction(supabase, {
    contactId: enrollment.contact_id,
    type: 'email_sent',
    summary: `Sequence "${seq.name}" step ${nextStepNum}/${seq.total_emails}: ${rendered.subject}`,
    metadata: {
      source: 'email_sequence',
      sequence_id: enrollment.sequence_id,
      sequence_name: seq.name,
      step_number: nextStepNum,
      subject: rendered.subject,
      provider: 'resend',
      provider_id: result.id ?? null,
    },
  })

  summary.sent++
  console.log(`cron:sequences sent "${seq.name}" step ${nextStepNum}/${seq.total_emails} to contact ${enrollment.contact_id}`)
}

/* ── helpers ───────────────────────────────────────────────────────────── */

/**
 * Both opt-out signals, because two different writers maintain them: the Brevo
 * webhook sets `email_opt_in = false` on `unsubscribed` and on a hard bounce,
 * and an admin sets `contacts.status`. A field read by two writers and checked
 * in only one place is a check nobody is applying (hard-won rule 11).
 */
export function optedOutReason(contact: {
  email_opt_in?: boolean | null
  status?: string | null
}): string | null {
  if (contact.email_opt_in === false) return 'contacts.email_opt_in is false'
  if (contact.status === 'unsubscribed') return "contacts.status is 'unsubscribed'"
  return null
}

export function isDue(
  enrollment: { enrolled_at: string; last_sent_at?: string | null; metadata?: Record<string, string> | null },
  step: { delay_days: number; delay_reference?: string | null },
  stepNumber: number,
  now: Date
): boolean {
  const meta = enrollment.metadata || {}
  let reference: Date

  if (step.delay_reference === 'event_date' && meta.event_date) {
    reference = new Date(`${meta.event_date}T12:00:00`)
  } else if (stepNumber === 1) {
    reference = new Date(enrollment.enrolled_at)
  } else {
    reference = enrollment.last_sent_at ? new Date(enrollment.last_sent_at) : new Date(enrollment.enrolled_at)
  }

  // An unparseable reference date is NOT due. The old code produced an Invalid
  // Date, every comparison against it was false, and `now < dueDate` being false
  // meant "send it" — so a malformed event_date sent every remaining step of the
  // sequence at once.
  if (!Number.isFinite(reference.getTime())) return false

  const due = new Date(reference)
  due.setDate(due.getDate() + Number(step.delay_days ?? 0))
  return now >= due
}

async function setEnrollmentStatus(supabase: Supa, id: string, status: string): Promise<void> {
  const { error } = await supabase.from('contact_sequence_enrollments').update({ status }).eq('id', id)
  if (error) console.error(`cron:sequences could not set enrollment ${id} to ${status}: ${error.message}`)
}

async function completeEnrollment(
  supabase: Supa,
  id: string,
  now: Date,
  summary: ProcessSummary
): Promise<void> {
  const { error } = await supabase
    .from('contact_sequence_enrollments')
    .update({ status: 'completed', completed_at: now.toISOString() })
    .eq('id', id)
  if (error) {
    summary.deferred++
    summary.notes.push(`enrollment ${id}: could not mark complete (${error.message})`)
    return
  }
  summary.completed++
}

async function advanceEnrollment(
  supabase: Supa,
  enrollment: any,
  stepNumber: number,
  seq: { total_emails: number },
  now: Date,
  summary: ProcessSummary
): Promise<void> {
  const isComplete = stepNumber >= Number(seq.total_emails ?? 0)
  const { error } = await supabase
    .from('contact_sequence_enrollments')
    .update({
      current_step: stepNumber,
      last_sent_at: now.toISOString(),
      ...(isComplete ? { status: 'completed', completed_at: now.toISOString() } : {}),
    })
    .eq('id', enrollment.id)

  if (error) {
    // The email went out. Failing to record that is a real problem and must be
    // loud, but it cannot re-send: the `sent` claim row is what the next tick
    // reads, and it will simply try this update again.
    summary.notes.push(`enrollment ${enrollment.id}: SENT step ${stepNumber} but could not advance (${error.message})`)
    console.error(`cron:sequences advanced-write failed after a successful send on ${enrollment.id}: ${error.message}`)
    return
  }
  if (isComplete) summary.completed++
}
