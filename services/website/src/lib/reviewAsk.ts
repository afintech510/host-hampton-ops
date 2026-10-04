/**
 * The past-client review ask (migration 061).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS. Measured on the live DB 2026-10-04: no review request had
 * ever been sent — zero `review_request` sends in `marketing_ledger`, zero
 * `party_thank_you_t1` rows, five `review_request_sms` rows (all for ticketed
 * events, none yet due) — against ~526 people who had celebrated with us: 430
 * imported 2025 customers, 30 party clients since March, 87 event-ticket buyers.
 * The existing review types hang off ONE booking or ONE event, so they could
 * never reach a 2025 customer who has a row in neither table.
 *
 * WHAT IT DOES. `/api/cron/review-asks` runs daily and queues, into
 * `scheduled_reminders`, the next `perDay` people who have not been asked:
 *
 *   - a `review_ask_email` today at 11am ET, most recent client first;
 *   - a `review_ask_sms` at 1pm ET, at least SMS_AFTER_EMAIL_DAYS after their
 *     email ask went out (or straight away for someone we may text but not
 *     email). The text is the nudge, not a duplicate of the email.
 *
 * `/api/cron/send-reminders` delivers both — which is where the claim, the
 * freshness bound, quiet hours and the send-time consent re-read already live.
 * Nothing here sends.
 *
 * WHY A DRIP AND NOT A BLAST. Google filters a sudden burst of reviews on a
 * listing as suspicious, and the email side shares Resend with every
 * transactional email the business sends. Forty a day drains the backlog in
 * about two weeks; after that the same daily run picks up each new client the
 * day after their party, because the most recent come first.
 *
 * ONCE PER PERSON, EVER. Keyed `(contact_id, review_ask_*, 'review-ask')` under
 * `uniq_scheduled_reminder_once`, and a person with ANY existing ask row —
 * including a cancelled one — is not re-queued, so an opt-out at send time does
 * not turn into a daily retry. A repeat client is not asked again: one Google
 * review per person is all Google will show.
 *
 * Google's review policy, which this copy respects: no incentive is offered, and
 * EVERY past client is asked — never only the ones we think were happy (review
 * gating is prohibited).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { getSupabase } from '@/lib/supabase'
import { normalizePhoneKey } from '@/lib/contactLookup'
import { etDateString, etToUtc, shiftEtDate } from '@/lib/partyTime'
import type { ReminderRow } from '@/lib/reminderQueue'

type Supa = ReturnType<typeof getSupabase>

/** `scheduled_reminders.reference_id` for every ask. Constant: one ask per person. */
export const REVIEW_ASK_REFERENCE = 'review-ask'
export const REVIEW_ASK_EMAIL_HOUR_ET = 11
export const REVIEW_ASK_SMS_HOUR_ET = 13
export const SMS_AFTER_EMAIL_DAYS = 3
export const DEFAULT_PER_DAY = 40
export const MAX_PER_DAY = 100

export const REVIEW_ASK_EMAIL_SUBJECT = 'A quick favor from Host Hampton?'

/**
 * Our own addresses. Every one of these is a real `contacts` row (measured
 * 2026-10-04) created by a test booking or an admin entry, and none of them is
 * a past client.
 */
const INTERNAL_DOMAINS = ['hosthampton.com', 'easternbuilding.supply']
const INTERNAL_ADDRESSES = new Set(['hosthampton295@gmail.com', 'alark51@gmail.com'])

/** Bookings that never became a party, and so are not a party to review. */
export const NOT_A_PAST_PARTY = ['cancelled', 'lead']

/** Rows already in the queue that bear on whether to ask. */
export const RELEVANT_REMINDER_TYPES = [
  'review_ask_email',
  'review_ask_sms',
  // A party thank-you email carries the review link, so it IS an email ask.
  'party_thank_you_t1',
  // The per-event review text, so it IS a text ask.
  'review_request_sms',
] as const

export interface AskContact {
  id: string
  email: string | null
  phone: string | null
  first_name: string | null
  status: string | null
  email_opt_in: boolean | null
  sms_opt_in: boolean | null
  created_at: string | null
  lifetime_value?: number | string | null
}

export interface ReviewAskInput {
  contacts: AskContact[]
  /** Past, non-cancelled bookings. */
  pastBookings: { contact_email: string | null; party_date: string | null }[]
  /** Tickets to events that have happened, not refunded. */
  pastTickets: { customer_email: string | null; event_date: string | null }[]
  existing: { contact_id: string | null; reminder_type: string; status: string; scheduled_for: string }[]
}

export interface Picked {
  contact: AskContact
  /** Most recent party/event date we know of, YYYY-MM-DD, or null for a 2025 import. */
  lastSeen: string | null
}

export interface ReviewAskPlan {
  email: Picked[]
  sms: Picked[]
  counts: {
    pastClients: number
    internalExcluded: number
    emailAlreadyAsked: number
    emailNoConsent: number
    emailRemaining: number
    smsAlreadyAsked: number
    smsNoConsent: number
    smsWaitingForEmail: number
    smsRemaining: number
  }
}

function emailKey(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase()
}

/**
 * The review-ask TEXTS are switched OFF — Adam, 2026-10-04 ("stop the texts"),
 * after the first batch of 40 went out the same afternoon. The email ask is
 * unaffected.
 *
 * Off unless `REVIEW_ASK_SMS_ENABLED=true`, so an unset variable can never turn
 * them back on by accident (the `checkinLinksEnabled` pattern). Gated at BOTH
 * ends: review-asks queues no text, and send-reminders cancels any review-ask
 * text already queued. Note a cancelled ask still counts as "asked" for that
 * person, so re-enabling later will not text anyone whose row was cancelled.
 * To re-enable: set it in /opt/hosthampton/.env, map it in docker-compose.yml,
 * and `up -d --build website`.
 */
export function reviewAskTextsEnabled(): boolean {
  return process.env.REVIEW_ASK_SMS_ENABLED === 'true'
}

export function isInternalAddress(raw: string | null | undefined): boolean {
  const e = emailKey(raw)
  if (!e) return false
  if (INTERNAL_ADDRESSES.has(e)) return true
  const domain = e.slice(e.lastIndexOf('@') + 1)
  return INTERNAL_DOMAINS.includes(domain)
}

function maxDate(a: string | null, b: string | null | undefined): string | null {
  const bb = b ? String(b).slice(0, 10) : null
  if (!a) return bb
  if (!bb) return a
  return bb > a ? bb : a
}

/**
 * Who to ask today. PURE: no I/O, no clock except `now`.
 *
 * People, not rows. 21 phone numbers and 8 email addresses carry more than one
 * `contacts` row (AGENTS.md §11), so rows are grouped by lowercased email and
 * the OLDEST row is the person — the same tie-break `findContactsByEmail`
 * uses, and the row whose consent the sender will re-read. A text is further
 * deduplicated by NORMALISED phone, because two of those shared numbers are two
 * different people in one household and neither needs the same text twice.
 */
export function planReviewAsks(
  input: ReviewAskInput,
  opts: {
    perDay: number
    now: Date
    /**
     * Days a text waits after the email ask. Default SMS_AFTER_EMAIL_DAYS. 0
     * means "same day": text without waiting for the email at all — what Adam
     * chose for the first batch on 2026-10-04.
     */
    smsGapDays?: number
  }
): ReviewAskPlan {
  const lastSeenByEmail = new Map<string, string | null>()
  for (const b of input.pastBookings) {
    const k = emailKey(b.contact_email)
    if (k) lastSeenByEmail.set(k, maxDate(lastSeenByEmail.get(k) ?? null, b.party_date))
  }
  for (const t of input.pastTickets) {
    const k = emailKey(t.customer_email)
    if (k) lastSeenByEmail.set(k, maxDate(lastSeenByEmail.get(k) ?? null, t.event_date))
  }

  // Group rows into people. A row with no email is its own person, keyed by id.
  const groups = new Map<string, AskContact[]>()
  for (const c of input.contacts) {
    const k = emailKey(c.email) || `id:${c.id}`
    const g = groups.get(k)
    if (g) g.push(c)
    else groups.set(k, [c])
  }

  const rowsByContact = new Map<string, ReviewAskInput['existing']>()
  for (const r of input.existing) {
    if (!r.contact_id) continue
    const list = rowsByContact.get(r.contact_id)
    if (list) list.push(r)
    else rowsByContact.set(r.contact_id, [r])
  }

  const contactById = new Map(input.contacts.map(c => [c.id, c]))
  const textedPhones = new Set<string>()
  for (const r of input.existing) {
    if (r.reminder_type !== 'review_ask_sms' && !(r.reminder_type === 'review_request_sms' && r.status !== 'cancelled')) continue
    const key = normalizePhoneKey(contactById.get(r.contact_id ?? '')?.phone)
    if (key) textedPhones.add(key)
  }

  const counts: ReviewAskPlan['counts'] = {
    pastClients: 0, internalExcluded: 0,
    emailAlreadyAsked: 0, emailNoConsent: 0, emailRemaining: 0,
    smsAlreadyAsked: 0, smsNoConsent: 0, smsWaitingForEmail: 0, smsRemaining: 0,
  }

  const emailPool: Picked[] = []
  const smsPool: Picked[] = []
  const smsGapDays = opts.smsGapDays ?? SMS_AFTER_EMAIL_DAYS
  const smsGapMs = smsGapDays * 24 * 60 * 60 * 1000
  const nowMs = opts.now.getTime()

  for (const [key, rows] of Array.from(groups.entries())) {
    const emailK = key.startsWith('id:') ? '' : key
    const isPast = rows.some(r => r.status === 'customer') || (emailK !== '' && lastSeenByEmail.has(emailK))
    if (!isPast) continue

    if (isInternalAddress(emailK)) { counts.internalExcluded++; continue }
    counts.pastClients++

    const sorted = [...rows].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
    const person = sorted[0]
    const picked: Picked = { contact: person, lastSeen: emailK ? lastSeenByEmail.get(emailK) ?? null : null }

    const queued = rows.flatMap(r => rowsByContact.get(r.id) ?? [])
    // A cancelled thank-you or event text was never sent, so it asked nobody.
    // A cancelled review_ask row DID decide this person (usually an opt-out at
    // send time) and must not be re-queued every day.
    const emailAsks = queued.filter(
      q => q.reminder_type === 'review_ask_email' || (q.reminder_type === 'party_thank_you_t1' && q.status !== 'cancelled')
    )
    const smsAsked = queued.some(
      q => q.reminder_type === 'review_ask_sms' || (q.reminder_type === 'review_request_sms' && q.status !== 'cancelled')
    )

    const unsubscribed = person.status === 'unsubscribed'
    const emailEligible = !!emailK && person.email_opt_in === true && !unsubscribed

    // ── email ──
    if (emailAsks.length > 0) counts.emailAlreadyAsked++
    else if (!emailEligible) counts.emailNoConsent++
    else emailPool.push(picked)

    // ── sms ──
    const phoneKey = normalizePhoneKey(person.phone)
    if (smsAsked || (phoneKey && textedPhones.has(phoneKey))) { counts.smsAlreadyAsked++; continue }
    if (person.sms_opt_in !== true || !phoneKey || unsubscribed) { counts.smsNoConsent++; continue }

    // The email goes first. Wait while it is still queued, and for the gap
    // after it went; someone we cannot email is texted without waiting.
    let wait = false
    if (smsGapDays === 0) {
      wait = false
    } else if (emailAsks.length > 0) {
      wait = emailAsks.some(
        q => q.status === 'pending' || q.status === 'sending' || nowMs - new Date(q.scheduled_for).getTime() < smsGapMs
      )
    } else if (emailEligible) {
      wait = true
    }
    if (wait) { counts.smsWaitingForEmail++; continue }
    smsPool.push(picked)
  }

  // Most recent client first, then the biggest 2025 spenders, then a stable id order.
  const order = (a: Picked, b: Picked) => {
    if (a.lastSeen !== b.lastSeen) {
      if (!a.lastSeen) return 1
      if (!b.lastSeen) return -1
      return a.lastSeen > b.lastSeen ? -1 : 1
    }
    const lv = Number(b.contact.lifetime_value ?? 0) - Number(a.contact.lifetime_value ?? 0)
    if (lv !== 0) return lv
    return a.contact.id.localeCompare(b.contact.id)
  }
  emailPool.sort(order)
  smsPool.sort(order)

  const email = emailPool.slice(0, opts.perDay)
  const sms: Picked[] = []
  const phonesThisRun = new Set<string>()
  for (const p of smsPool) {
    if (sms.length >= opts.perDay) break
    const k = normalizePhoneKey(p.contact.phone)
    if (phonesThisRun.has(k)) continue
    phonesThisRun.add(k)
    sms.push(p)
  }

  counts.emailRemaining = emailPool.length
  counts.smsRemaining = smsPool.length
  return { email, sms, counts }
}

/** When today's asks go out: the hour in ET, or now if that hour has passed. */
export function askTime(now: Date, hourEt: number): Date {
  const at = etToUtc(etDateString(now), hourEt, 0)
  return Number.isFinite(at.getTime()) && at > now ? at : now
}

export function emailRow(contactId: string, at: Date): ReminderRow {
  return {
    contact_id: contactId,
    reminder_type: 'review_ask_email',
    reference_type: 'contact',
    reference_id: REVIEW_ASK_REFERENCE,
    scheduled_for: at.toISOString(),
    channel: 'email',
  }
}

export function smsRow(contactId: string, at: Date): ReminderRow {
  return {
    contact_id: contactId,
    reminder_type: 'review_ask_sms',
    reference_type: 'contact',
    reference_id: REVIEW_ASK_REFERENCE,
    scheduled_for: at.toISOString(),
    channel: 'sms',
  }
}

/** The plain-text half of the ask email. Never escaped: it is not HTML. */
export function reviewAskText(args: { firstName: string; reviewUrl: string; unsubscribeUrl: string }): string {
  const first = String(args.firstName || '').split(' ')[0] || 'there'
  return [
    `Hi ${first},`,
    '',
    'Thank you again for celebrating with Host Hampton. Having you with us meant a lot.',
    '',
    "We're a small, local business, and Google reviews are honestly how most new families find us. If you have two minutes, we'd be so grateful if you shared a few words about your experience:",
    '',
    args.reviewUrl,
    '',
    'Thank you!',
    'Allie & the Host Hampton team',
    '',
    '--',
    'Host Hampton · 295 Montauk Highway, Suite 7 · Speonk, NY 11972',
    `Unsubscribe: ${args.unsubscribeUrl}`,
  ].join('\n')
}

/* ── The read ──────────────────────────────────────────────────────────────── */

const PAGE = 1000

export type InputLoad = { kind: 'ok'; input: ReviewAskInput } | { kind: 'unavailable'; error: string }

/**
 * Everything `planReviewAsks` needs, or `unavailable`. Rule 12: a failed read is
 * not "nobody to ask", and a partial contacts read would re-ask nobody but
 * would silently skip whoever was on the page that failed — so any failure
 * fails the whole load and the caller enqueues nothing.
 *
 * Contacts are PAGED: PostgREST caps a response at 1000 rows and there are
 * 1257, so a single read would quietly drop a fifth of the audience.
 */
export async function loadReviewAskInput(supabase: Supa, now: Date): Promise<InputLoad> {
  const yesterdayEt = shiftEtDate(etDateString(now), -1)

  const contacts: AskContact[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, email, phone, first_name, status, email_opt_in, sms_opt_in, created_at, lifetime_value')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) return { kind: 'unavailable', error: `contacts read failed: ${error.message}` }
    contacts.push(...((data ?? []) as AskContact[]))
    if (!data || data.length < PAGE) break
  }

  const { data: bookings, error: bErr } = await supabase
    .from('bookings')
    .select('contact_email, party_date, status')
    .lte('party_date', yesterdayEt)
    .not('status', 'in', `(${NOT_A_PAST_PARTY.join(',')})`)
  if (bErr) return { kind: 'unavailable', error: `bookings read failed: ${bErr.message}` }

  const { data: events, error: eErr } = await supabase
    .from('events')
    .select('id, event_date')
    .lte('event_date', yesterdayEt)
  if (eErr) return { kind: 'unavailable', error: `events read failed: ${eErr.message}` }
  const eventDate = new Map(((events ?? []) as { id: string; event_date: string | null }[]).map(e => [e.id, e.event_date]))

  const { data: tickets, error: tErr } = await supabase
    .from('event_tickets')
    .select('customer_email, event_id, status')
    .neq('status', 'refunded')
  if (tErr) return { kind: 'unavailable', error: `event_tickets read failed: ${tErr.message}` }

  const { data: existing, error: rErr } = await supabase
    .from('scheduled_reminders')
    .select('contact_id, reminder_type, status, scheduled_for')
    .in('reminder_type', [...RELEVANT_REMINDER_TYPES])
  if (rErr) return { kind: 'unavailable', error: `scheduled_reminders read failed: ${rErr.message}` }

  return {
    kind: 'ok',
    input: {
      contacts,
      pastBookings: (bookings ?? []) as ReviewAskInput['pastBookings'],
      pastTickets: ((tickets ?? []) as { customer_email: string | null; event_id: string }[])
        .filter(t => eventDate.has(t.event_id))
        .map(t => ({ customer_email: t.customer_email, event_date: eventDate.get(t.event_id) ?? null })),
      existing: (existing ?? []) as ReviewAskInput['existing'],
    },
  }
}
