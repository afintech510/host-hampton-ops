/**
 * Crew notifications (spec §6, prompt 05 §1): the ONE path a crew message
 * takes. Every crew send in the codebase is `notifyMember`, `notifyAdmin` or
 * `drainCrewQueue` — `crewNotifySurface.test.ts` holds every other crew file to
 * calling none of the providers directly.
 *
 * The rules, in the order they are asked:
 *
 *   1. The owner row (Allie) is never notified. Not "skipped": no row at all.
 *   2. While `CREW_ENABLED` is off, a REAL member is never messaged and nothing
 *      is written for them. An `is_test` member is (their addresses are
 *      plus-addresses on the business inbox and they have no phones) — that is
 *      how the send path is proven in production before launch.
 *   3. One `crew_notifications` row per channel, keyed `(dedupe_key, channel)`.
 *      The INSERT is the claim: a 23505 means this exact message was already
 *      handled, so nothing is sent twice however often the cron runs.
 *   4. `in_app` is always written. `email` when `email_opt_in`. `sms` only when
 *      `CREW_SMS_ENABLED` AND `sms_opt_in` AND a phone; otherwise the row is
 *      written `skipped` WITH THE REASON, so "we chose not to text" and "we
 *      never got that far" look different.
 *   5. A text outside 8am–9pm Eastern is DEFERRED (`queued`, `scheduled_for` =
 *      the next 8am), never cancelled, and spends nothing (link 25). An
 *      unreadable hour is treated as quiet.
 *   6. Text is made GSM-7 safe and its segments counted. A member's first text
 *      carries the opt-out disclosure (row `sms_disclosure:{member}`).
 *   7. A provider's answer is written back: `provider_id`, or `failed` with the
 *      error. A failed send is never retried behind anybody's back.
 *
 * `drainCrewQueue` delivers what is `queued` — the reconcile's `partyCancelled`
 * notices and the texts quiet hours held. It CLAIMS each row (`queued` →
 * `sending`, migration 081) before sending, re-reads the member's consent at
 * send time, refuses a row older than the freshness bound
 * (`REMINDER_MAX_LATENESS_HOURS`, 48 h — these are date-anchored: "tomorrow",
 * "cancelled") and refuses one whose subject has moved on (the cover was
 * claimed, the spot was confirmed, the party is no longer on).
 *
 * Nothing here logs an address, a number or a body.
 */

import type { getSupabase } from '@/lib/supabase'
import { sendSMSViaQuo } from '@/lib/quo'
import { sendCrewEmail, type CrewMailOutcome } from '@/lib/crew/mail'
import { checkSmsQuietHours } from '@/lib/quietHours'
import { gsm7Sanitize, smsSegmentInfo } from '@/lib/smsSegments'
import { checkFreshness, reminderMaxLatenessMs } from '@/lib/scheduleFreshness'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { crewAdminEmail, crewEnabled, crewSmsEnabled } from '@/lib/crew/settings'
import { getMember, insertNotification, type CrewMemberRow, type CrewPartyRow } from '@/lib/crew/db'
import { SMS_DISCLOSURE, templates, type PartyRef, type Rendered } from '@/lib/crew/templates'
import { setupStartsAt, TIME_ZONE, type CrewSettings } from '@/lib/crew/rules'

type Supa = ReturnType<typeof getSupabase>

export type Channel = 'in_app' | 'email' | 'sms'

/** The providers, injectable so the tests never reach Quo or Resend. */
export interface CrewSenders {
  sms(to: string, body: string): Promise<string | null>
  email(to: string, rendered: Rendered): Promise<CrewMailOutcome>
}

export const liveSenders: CrewSenders = { sms: sendSMSViaQuo, email: sendCrewEmail }

export interface NotifyCtx {
  sb: Supa
  now: Date
  senders?: CrewSenders
}

export type NotifyMember = Pick<
  CrewMemberRow,
  'id' | 'first_name' | 'email' | 'phone' | 'is_owner' | 'is_test' | 'status' | 'email_opt_in' | 'sms_opt_in'
>

export type ChannelOutcome = 'sent' | 'duplicate' | 'skipped' | 'deferred' | 'failed'

export type NotifyResult =
  | { kind: 'owner' }
  /** Nothing written: a real member while CREW_ENABLED is off, or a member who is not active. */
  | { kind: 'held'; reason: 'crew_disabled' | 'inactive' }
  | { kind: 'done'; channels: Partial<Record<Channel, ChannelOutcome>> }

/** May this member be messaged at all right now? Rule 2 above, in one place. */
export function crewMessagingAllowed(m: Pick<CrewMemberRow, 'is_owner' | 'is_test' | 'status'>): 'ok' | 'owner' | 'crew_disabled' | 'inactive' {
  if (m.is_owner) return 'owner'
  if (m.status !== 'active') return 'inactive'
  if (!crewEnabled() && !m.is_test) return 'crew_disabled'
  return 'ok'
}

/** Why an SMS will not go to this member, or null if it may. */
export function smsSkipReason(m: Pick<CrewMemberRow, 'phone' | 'sms_opt_in'>, opts: { helpReply?: boolean } = {}): string | null {
  if (!crewSmsEnabled()) return 'CREW_SMS_ENABLED is off'
  // A HELP reply answers a text the member just sent us; the carrier rules
  // expect it whatever their opt-in says. Everything else needs the opt-in.
  if (!m.sms_opt_in && !opts.helpReply) return 'sms_opt_in is off'
  if (!m.phone) return 'no phone on file'
  return null
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function finish(sb: Supa, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await sb.from('crew_notifications').update(patch).eq('id', id).select('id')
  // The send already happened; a failed write-back is logged loudly, never retried as a send.
  if (error) console.error(`crew/notify: could not record the outcome of ${id}: ${error.message}`)
}

/**
 * Send one text on an already-claimed row, carrying the disclosure if this is
 * the member's first. Returns the outcome written to the row.
 */
async function deliverSms(
  ctx: NotifyCtx, member: Pick<CrewMemberRow, 'id' | 'phone'>, rowId: string, text: string,
): Promise<'sent' | 'failed'> {
  const senders = ctx.senders ?? liveSenders
  const nowIso = ctx.now.toISOString()

  // The disclosure rides on the first text that actually goes. Its own row is
  // the record that it went; a row that exists but is not `sent` (the first
  // attempt failed) means it has not gone yet.
  let disclosureRowId: string | null = null
  let carry = false
  const claim = await insertNotification(ctx.sb, {
    member_id: member.id, channel: 'sms', template: 'smsDisclosure', status: 'sending',
    dedupe_key: `sms_disclosure:${member.id}`, payload: { text: SMS_DISCLOSURE },
  })
  if (claim.kind === 'inserted') {
    carry = true
    disclosureRowId = claim.id
  } else if (claim.kind === 'duplicate') {
    const { data, error } = await ctx.sb.from('crew_notifications').select('id, status')
      .eq('dedupe_key', `sms_disclosure:${member.id}`).eq('channel', 'sms').maybeSingle()
    const row = data as { id: string; status: string } | null
    // Could not read it: carry the disclosure. Saying it twice costs a few characters.
    carry = !!error || !row || row.status !== 'sent'
    disclosureRowId = row && row.status !== 'sent' ? row.id : null
  } else {
    carry = true
  }

  const body = gsm7Sanitize(carry ? `${text} ${SMS_DISCLOSURE}` : text)
  const seg = smsSegmentInfo(body)
  let providerId: string | null = null
  try {
    providerId = await senders.sms(member.phone as string, body)
  } catch (e) {
    console.error(`crew/notify: sms threw for row ${rowId}: ${errText(e)}`)
  }
  if (providerId) {
    await finish(ctx.sb, rowId, { status: 'sent', provider_id: providerId, sent_at: nowIso, error: null })
    if (carry && disclosureRowId) {
      await finish(ctx.sb, disclosureRowId, { status: 'sent', provider_id: providerId, sent_at: nowIso, error: null })
    }
    console.log(`crew/notify: sms sent row=${rowId} segments=${seg.segments} encoding=${seg.encoding}`)
    return 'sent'
  }
  await finish(ctx.sb, rowId, { status: 'failed', error: 'quo returned no message id (see the quo:sendSMS log line)' })
  if (carry && disclosureRowId) await finish(ctx.sb, disclosureRowId, { status: 'failed', error: 'the text carrying it failed' })
  return 'failed'
}

async function deliverEmail(ctx: NotifyCtx, to: string, rowId: string, rendered: Rendered): Promise<'sent' | 'failed'> {
  const senders = ctx.senders ?? liveSenders
  let out: CrewMailOutcome
  try {
    out = await senders.email(to, rendered)
  } catch (e) {
    out = { kind: 'failed', error: errText(e) }
  }
  if (out.kind === 'sent') {
    await finish(ctx.sb, rowId, { status: 'sent', provider_id: out.providerId, sent_at: ctx.now.toISOString(), error: null })
    return 'sent'
  }
  await finish(ctx.sb, rowId, { status: 'failed', error: out.kind === 'unconfigured' ? 'RESEND_API_KEY is not set' : out.error })
  return 'failed'
}

/**
 * Tell one crew member something, on every channel they can receive. Safe to
 * call again with the same `dedupeKey`: each channel answers `duplicate`.
 */
export async function notifyMember(
  ctx: NotifyCtx,
  member: NotifyMember,
  template: string,
  rendered: Rendered,
  dedupeKey: string,
  opts: { payload?: Record<string, unknown>; helpReply?: boolean } = {},
): Promise<NotifyResult> {
  const allowed = crewMessagingAllowed(member)
  if (allowed === 'owner') return { kind: 'owner' }
  if (allowed !== 'ok') return { kind: 'held', reason: allowed }

  const nowIso = ctx.now.toISOString()
  const base = opts.payload ?? {}
  const channels: Partial<Record<Channel, ChannelOutcome>> = {}

  // in_app: always. Being written IS its delivery.
  const inApp = await insertNotification(ctx.sb, {
    member_id: member.id, channel: 'in_app', template, dedupe_key: dedupeKey, status: 'sent', scheduled_for: nowIso,
    payload: { ...base, text: rendered.inApp },
  })
  channels.in_app = inApp.kind === 'inserted' ? 'sent' : inApp.kind === 'duplicate' ? 'duplicate' : 'failed'
  if (inApp.kind === 'failed') console.error(`crew/notify: in_app ${template} not written: ${inApp.error}`)

  // email
  if (!member.email_opt_in || !member.email) {
    const r = await insertNotification(ctx.sb, {
      member_id: member.id, channel: 'email', template, dedupe_key: dedupeKey, status: 'skipped',
      error: !member.email ? 'no email on file' : 'email_opt_in is off', payload: base,
    })
    channels.email = r.kind === 'duplicate' ? 'duplicate' : r.kind === 'inserted' ? 'skipped' : 'failed'
  } else {
    const r = await insertNotification(ctx.sb, {
      member_id: member.id, channel: 'email', template, dedupe_key: dedupeKey, status: 'sending',
      payload: { ...base, subject: rendered.email.subject },
    })
    if (r.kind === 'duplicate') channels.email = 'duplicate'
    else if (r.kind === 'failed') { channels.email = 'failed'; console.error(`crew/notify: email ${template} not claimed: ${r.error}`) }
    else channels.email = await deliverEmail(ctx, member.email, r.id, rendered)
  }

  // sms
  const skip = smsSkipReason(member, { helpReply: opts.helpReply })
  if (skip) {
    const r = await insertNotification(ctx.sb, {
      member_id: member.id, channel: 'sms', template, dedupe_key: dedupeKey, status: 'skipped', error: skip, payload: base,
    })
    channels.sms = r.kind === 'duplicate' ? 'duplicate' : r.kind === 'inserted' ? 'skipped' : 'failed'
    return { kind: 'done', channels }
  }
  const window = checkSmsQuietHours(ctx.now)
  if (window.kind !== 'open') {
    // DEFER, never cancel. An unreadable hour has no `until`: hold it an hour and ask again.
    const until = window.kind === 'quiet' ? window.until : new Date(ctx.now.getTime() + 3_600_000)
    const r = await insertNotification(ctx.sb, {
      member_id: member.id, channel: 'sms', template, dedupe_key: dedupeKey, status: 'queued',
      scheduled_for: until.toISOString(), error: window.reason, payload: { ...base, sms: rendered.sms },
    })
    channels.sms = r.kind === 'duplicate' ? 'duplicate' : r.kind === 'inserted' ? 'deferred' : 'failed'
    return { kind: 'done', channels }
  }
  const r = await insertNotification(ctx.sb, {
    member_id: member.id, channel: 'sms', template, dedupe_key: dedupeKey, status: 'sending', payload: base,
  })
  if (r.kind === 'duplicate') channels.sms = 'duplicate'
  else if (r.kind === 'failed') { channels.sms = 'failed'; console.error(`crew/notify: sms ${template} not claimed: ${r.error}`) }
  else channels.sms = await deliverSms(ctx, member, r.id, rendered.sms)
  return { kind: 'done', channels }
}

export interface AdminMessage { subject: string; text: string }

/**
 * An alert for Allie: an in-app row (`member_id` null) and an email to
 * `CREW_ADMIN_EMAIL || ownerEmail()`. Not behind CREW_ENABLED — the admin side
 * never is. `test` marks an alert about a TEST party so nobody acts on it.
 */
export async function notifyAdmin(
  ctx: NotifyCtx, template: string, msg: AdminMessage, dedupeKey: string,
  opts: { test?: boolean; payload?: Record<string, unknown> } = {},
): Promise<Partial<Record<'in_app' | 'email', ChannelOutcome>>> {
  const subject = opts.test ? `[TEST] ${msg.subject}` : msg.subject
  const base = opts.payload ?? {}
  const out: Partial<Record<'in_app' | 'email', ChannelOutcome>> = {}
  const inApp = await insertNotification(ctx.sb, {
    member_id: null, channel: 'in_app', template, dedupe_key: dedupeKey, status: 'sent', scheduled_for: ctx.now.toISOString(),
    payload: { ...base, subject, text: msg.text },
  })
  out.in_app = inApp.kind === 'inserted' ? 'sent' : inApp.kind === 'duplicate' ? 'duplicate' : 'failed'
  const r = await insertNotification(ctx.sb, {
    member_id: null, channel: 'email', template, dedupe_key: dedupeKey, status: 'sending', payload: { ...base, subject },
  })
  if (r.kind === 'duplicate') out.email = 'duplicate'
  else if (r.kind === 'failed') { out.email = 'failed'; console.error(`crew/notify: admin ${template} not claimed: ${r.error}`) }
  else out.email = await deliverEmail(ctx, crewAdminEmail(), r.id, { sms: '', inApp: msg.text, email: { subject, text: msg.text } })
  return out
}

// ── The queue ───────────────────────────────────────────────────────────────

export interface QueuedRow {
  id: string
  member_id: string | null
  channel: Channel
  template: string
  payload: Record<string, unknown> | null
  scheduled_for: string
}

/** Rebuild what a queued row says. Deferred rows carry their text; the reconcile's notices carry the facts. */
export function renderQueued(row: Pick<QueuedRow, 'template' | 'payload'>): Rendered | null {
  const p = row.payload ?? {}
  const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : null)
  if (row.template === 'partyCancelled' && str('day_label')) {
    return templates.partyCancelled({
      theme: str('theme') ?? 'Your party', dayLabel: str('day_label') as string, timeLabel: str('time_label') ?? '',
      url: `${CANONICAL_ORIGIN}/crew`,
    })
  }
  const sms = str('sms')
  if (sms) return { sms, inApp: str('text') ?? sms, email: { subject: str('subject') ?? 'Host Hampton crew', text: sms } }
  return null
}

const LIVE_SWAP = ['open', 'escalated']

/**
 * Is a queued message still TRUE? A cover offer held overnight is a lie at 8am
 * if someone took it at 11pm; "please confirm" is noise once they have. Three
 * outcomes: an unreadable subject is `unavailable`, never "still relevant".
 */
export async function queuedStillRelevant(
  sb: Supa, row: Pick<QueuedRow, 'member_id' | 'template' | 'payload'>, now: Date,
): Promise<'yes' | 'no' | 'unavailable'> {
  const p = row.payload ?? {}
  if (typeof p.swap_id === 'string') {
    const { data, error } = await sb.from('crew_swap_requests').select('status').eq('id', p.swap_id).maybeSingle()
    if (error) return 'unavailable'
    const st = (data as { status: string } | null)?.status
    const wantsLive = row.template !== 'coveredRequester' && row.template !== 'coverClaimed'
    if (!st || (wantsLive && !LIVE_SWAP.includes(st))) return 'no'
  }
  if (typeof p.slot_id === 'string' && ['confirmRequest', 'confirmReminder', 'dayBefore'].includes(row.template)) {
    const { data, error } = await sb.from('crew_slots').select('status, member_id, confirmed_at').eq('id', p.slot_id).maybeSingle()
    if (error) return 'unavailable'
    const sl = data as { status: string; member_id: string | null; confirmed_at: string | null } | null
    if (!sl || sl.status !== 'assigned' || sl.member_id !== row.member_id) return 'no'
    if (row.template !== 'dayBefore' && sl.confirmed_at) return 'no'
  }
  if (typeof p.party_id === 'string' && row.template !== 'partyCancelled') {
    const { data, error } = await sb.from('crew_parties').select('status, starts_at').eq('id', p.party_id).maybeSingle()
    if (error) return 'unavailable'
    const party = data as { status: string; starts_at: string } | null
    if (!party || party.status !== 'published' || new Date(party.starts_at).getTime() <= now.getTime()) return 'no'
  }
  return 'yes'
}

export interface DrainSummary {
  scanned: number
  sent: number
  deferred: number
  /** Refused as too late, no longer true, or no longer allowed (consent, flag, member). */
  skipped: number
  failed: number
  /** Another tick claimed it first. */
  raced: number
  unavailable: boolean
}

export const DRAIN_BATCH = 50

/**
 * Deliver what is due in the queue. Claim, check, send, record — in that order,
 * for every row. `memberFilter` narrows the run (the test-only cron scope).
 */
export async function drainCrewQueue(
  ctx: NotifyCtx, opts: { memberFilter?: (m: CrewMemberRow) => boolean } = {},
): Promise<DrainSummary> {
  const sum: DrainSummary = { scanned: 0, sent: 0, deferred: 0, skipped: 0, failed: 0, raced: 0, unavailable: false }
  const nowIso = ctx.now.toISOString()
  const { data, error } = await ctx.sb.from('crew_notifications')
    .select('id, member_id, channel, template, payload, scheduled_for')
    .eq('status', 'queued').lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true }).limit(DRAIN_BATCH)
  if (error) { sum.unavailable = true; return sum }

  for (const row of (data ?? []) as QueuedRow[]) {
    sum.scanned++
    let member: CrewMemberRow | null = null
    if (row.member_id) {
      const m = await getMember(ctx.sb, row.member_id)
      if (m.kind !== 'ok') { sum.unavailable = true; continue }
      member = m.data
      // Out of this run's scope: not claimed, not touched.
      if (member && opts.memberFilter && !opts.memberFilter(member)) continue
    } else if (opts.memberFilter) {
      continue
    }

    // CLAIM before anything else. Only the winner goes on.
    const { data: claimed, error: cErr } = await ctx.sb.from('crew_notifications')
      .update({ status: 'sending', claimed_at: nowIso })
      .eq('id', row.id).eq('status', 'queued')
      .select('id')
    if (cErr) { sum.unavailable = true; continue }
    if ((claimed ?? []).length === 0) { sum.raced++; continue }

    const skip = async (reason: string) => { sum.skipped++; await finish(ctx.sb, row.id, { status: 'skipped', error: reason }) }
    const release = async (reason: string) => { sum.unavailable = true; await finish(ctx.sb, row.id, { status: 'queued', claimed_at: null, error: reason }) }

    const fresh = checkFreshness(row.scheduled_for, ctx.now, reminderMaxLatenessMs(), `crew ${row.template}`)
    if (fresh.kind === 'stale') { await skip(fresh.reason); continue }
    if (fresh.kind === 'unreadable') { await skip(`unreadable scheduled_for: ${fresh.raw}`); continue }

    if (row.member_id) {
      if (!member) { await skip('member no longer exists'); continue }
      const allowed = crewMessagingAllowed(member)
      if (allowed !== 'ok') { await skip(`not messaged: ${allowed}`); continue }
    }

    const relevant = await queuedStillRelevant(ctx.sb, row, ctx.now)
    if (relevant === 'unavailable') { await release('could not check it is still true; left queued'); continue }
    if (relevant === 'no') { await skip('no longer true: its spot, cover request or party has moved on'); continue }

    if (row.channel === 'in_app') {
      sum.sent++
      await finish(ctx.sb, row.id, { status: 'sent', sent_at: nowIso, error: null })
      continue
    }

    const rendered = renderQueued(row)
    if (!rendered) { await skip(`cannot render ${row.template} from its payload`); continue }

    if (row.channel === 'email') {
      const to = member ? member.email : crewAdminEmail()
      if (member && (!member.email_opt_in || !member.email)) { await skip(!member.email ? 'no email on file' : 'email_opt_in is off'); continue }
      const out = await deliverEmail(ctx, to as string, row.id, rendered)
      if (out === 'sent') sum.sent++; else sum.failed++
      continue
    }

    // sms
    if (!member) { await skip('an admin alert is never a text'); continue }
    const smsSkip = smsSkipReason(member)
    if (smsSkip) { await skip(smsSkip); continue }
    const window = checkSmsQuietHours(ctx.now)
    if (window.kind !== 'open') {
      const until = window.kind === 'quiet' ? window.until : new Date(ctx.now.getTime() + 3_600_000)
      sum.deferred++
      await finish(ctx.sb, row.id, { status: 'queued', claimed_at: null, scheduled_for: until.toISOString(), error: window.reason })
      continue
    }
    const out = await deliverSms(ctx, member, row.id, rendered.sms)
    if (out === 'sent') sum.sent++; else sum.failed++
  }
  return sum
}

// ── Words for a party, in Eastern time ──────────────────────────────────────

const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric' })
const hmFmt = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true })

/** "Sat Oct 31". */
export function messageDayLabel(at: Date): string {
  return dayFmt.format(at).replace(',', '')
}

function hm(at: Date): { clock: string; mer: string } {
  const parts = hmFmt.formatToParts(at)
  const hour = parts.find(p => p.type === 'hour')?.value ?? ''
  const minute = parts.find(p => p.type === 'minute')?.value ?? '00'
  const mer = (parts.find(p => p.type === 'dayPeriod')?.value ?? '').toUpperCase()
  return { clock: minute === '00' ? hour : `${hour}:${minute}`, mer }
}

/** "1:30–4:30 PM", or "11 AM–2 PM" across noon. */
export function messageTimeLabel(startsAt: Date, endsAt: Date): string {
  const a = hm(startsAt), b = hm(endsAt)
  return a.mer === b.mer ? `${a.clock}–${b.clock} ${b.mer}` : `${a.clock} ${a.mer}–${b.clock} ${b.mer}`
}

/** "1 PM" / "12:30 PM". */
export function messageClock(at: Date): string {
  const a = hm(at)
  return `${a.clock} ${a.mer}`
}

export function crewLink(path: string): string {
  return `${CANONICAL_ORIGIN}${path}`
}

export function partyRefFor(party: Pick<CrewPartyRow, 'id' | 'title' | 'theme' | 'starts_at' | 'ends_at' | 'guest_count'>, s: CrewSettings, path?: string): PartyRef {
  const startsAt = new Date(party.starts_at)
  return {
    theme: party.theme || party.title,
    dayLabel: messageDayLabel(startsAt),
    timeLabel: messageTimeLabel(startsAt, new Date(party.ends_at)),
    setupLabel: messageClock(setupStartsAt(startsAt, s)),
    kids: party.guest_count ?? null,
    url: crewLink(path ?? `/crew/parties/${party.id}`),
  }
}

/** A party is a TEST party when it has no booking and Allie titled it so (scripts/crew/seed-test-parties.sql). */
export function isTestParty(party: Pick<CrewPartyRow, 'booking_id' | 'title'>): boolean {
  return !party.booking_id && /^TEST\b/.test(party.title)
}
