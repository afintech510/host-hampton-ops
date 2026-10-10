/**
 * "Build and send ONE evite email": the single implementation behind the inline hooks
 * (`inlineSends.ts`) and, in P09b, the `evite-sends` cron (spec §9.1, §9.3).
 *
 *   claimAndSend(supabase, key)         claim -> performSend      (a send nobody owns yet)
 *   performSend(supabase, claimed)      re-read -> build -> send -> finishSend   (a row you already own:
 *                                       a fresh claim, or one handed back by `reclaimFailed`)
 *
 * EVERY PATH ENDS AT `finishSend`. A claim is never left `sending` by a code path that knew the
 * outcome: not by a skip, not by a failed read, not by a thrown error. The only time a row stays
 * `sending` is a process that died, and `reclaimFailed` exists for that.
 *
 * WHAT IS CHECKED HERE, AT SEND TIME (not trusted from whoever queued it): the flag, the pilot list,
 * the party's real state, whether the calendar version the message was keyed under is still current,
 * the sendable-until time, the recipient (a plausible address, an RSVP that is still `yes` and not
 * opted out), and for the parent / lead sends, the suppression list. WHAT IS NOT: the DUE time
 * ("send the week-before email at 10:00 ET seven days out"). That is the cron's selection and lives
 * in P09b; this module will happily send a `week_before` that is handed to it at any hour, as long as
 * it is still before its sendable-until time.
 *
 * OUTCOME -> LEDGER
 *   sent      Resend accepted it                                  -> `sent` (+ provider id)
 *   skipped   a guardrail said no (terminal, and says why)        -> `skipped`
 *   failed    anything that might work next time: a read failed, suppression could not be read,
 *             no Resend key, Resend refused, the portal link would not mint -> `failed` (retried by
 *             `reclaimFailed` up to 4 attempts)
 *
 * `unavailable` suppression is a `failed`, not a skip and not a send (rule 12; spec §9.2 "no send, retry
 * next tick"): the ledger keeps a claimable trace, and the attempts counter bounds the retries.
 *
 * NOTHING IN HERE LOGS AN ADDRESS, A NAME OR A BODY.
 */

import type { getSupabase } from '@/lib/supabase'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { etToUtc, shiftEtDate } from '@/lib/partyTime'
import { isPlausibleEmailAddress } from '@/lib/contactLookup'
import { mintPortalLink } from '@/lib/portalLinkMint'
import { generateUnsubscribeToken } from '@/lib/unsubscribeLink'
import { ownerEmail } from '@/lib/ownerNotify'
import { guardRecipient, HOUR_MS } from '@/lib/rateLimit'
import { isUnpricedPlan } from '@/lib/planBalance'
import { STUDIO_MAPS_URL } from '@/lib/studioLocation'
import { buildIcs, type IcsMethod } from '@/lib/evites/ics'
import { eviteSendsMode, isPilotBooking } from '@/lib/evites/config'
import { sendEviteEmail, type EviteMailAttachment } from '@/lib/evites/mail'
import { claimSend, finishSend, type ClaimedSend, type SendKey } from '@/lib/evites/sends'
import { emailSuppressed } from '@/lib/evites/suppression'
import { honoreeFirstName } from '@/lib/evites/pageModel'
import { validPartyDate } from '@/lib/evites/partyWindow'
import { editLink, editTokenExpiry, signEditToken } from '@/lib/evites/rsvpToken'
import { storedImageUrl, pickHostRsvp, summarizeRsvps } from '@/lib/evites/hostView'
import { themeLabelOf } from '@/lib/evites/themes'
import { loadHeadcountRsvps, loadSendContext, readSendGate, type SendContext } from '@/lib/evites/sendContext'
import type { InviteFacts } from '@/lib/evites/facts'
import type { EviteSendType } from '@/lib/evites/types'
import {
  dayBeforeEmail,
  detailsChangedEmail,
  finalHeadcountEmail,
  inviteReadyEmail,
  leadPreviewEmail,
  newRsvpEmail,
  partyCancelledEmail,
  rsvpChangedEmail,
  rsvpConfirmedEmail,
  weekBeforeEmail,
  type EviteEmail,
  type EviteGuestLinks,
  type EviteMailParty,
} from '@/lib/email-templates/evites'

type Supa = ReturnType<typeof getSupabase>

/* ── constants the cron and the tests share ───────────────────── */

/** `lead_preview` stops being sendable this long after the booking was created. */
export const LEAD_PREVIEW_WINDOW_MS = 14 * 24 * HOUR_MS
/** `invite_ready` stops being sendable this long before the party starts. */
export const INVITE_READY_CUTOFF_MS = 2 * 24 * HOUR_MS
/** `week_before` stops being sendable this long before the party starts. */
export const WEEK_BEFORE_CUTOFF_MS = 48 * HOUR_MS
/** The in-memory per-parent limiter on `new_rsvp` / `rsvp_changed` (label, max per window). */
export const HOST_NOTIFY_LABEL = 'evite-host'
export const HOST_NOTIFY_MAX_PER_HOUR = 40

/** The send types whose message is keyed on the calendar version (`ref_version = cal_version`). */
export const CAL_VERSIONED_TYPES: readonly EviteSendType[] = ['week_before', 'day_before', 'details_changed', 'final_headcount']
/** The guest sends that attach an .ics and so set `cal_version_seen`. */
export const ICS_GUEST_TYPES: readonly EviteSendType[] = ['rsvp_confirmed', 'week_before', 'day_before', 'details_changed', 'party_cancelled']

/* ── results ──────────────────────────────────────────────────── */

export type SendResult =
  | { kind: 'sent'; providerId: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; error: string }

export type ClaimAndSendResult =
  | SendResult
  /** Another caller owns this message already. Nothing was sent. */
  | { kind: 'duplicate' }
  /** The claim could not be written (or the pilot gate could not be read). Nothing was sent, nothing is owed. */
  | { kind: 'unavailable'; error: string }
  /** `EVITES_SENDS` says no (off, or pilot and not a pilot booking). Nothing was claimed. */
  | { kind: 'disabled'; reason: 'sends-off' | 'not-pilot' }

interface Ready {
  kind: 'ready'
  to: string
  mail: EviteEmail
  attachments?: EviteMailAttachment[]
  /** After a successful send: `evite_rsvps.cal_version_seen = version`. */
  stamp?: { rsvpId: string; version: number }
}
type Prep = Ready | { kind: 'skip'; reason: string } | { kind: 'fail'; error: string }

const skip = (reason: string): Prep => ({ kind: 'skip', reason })
const fail = (error: string): Prep => ({ kind: 'fail', error })

/* ── small helpers ────────────────────────────────────────────── */

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function firstToken(name: string | null | undefined): string | null {
  const t = (name ?? '').trim().split(/\s+/)[0]
  return t ? t : null
}

function partyOf(facts: InviteFacts): EviteMailParty {
  const label = themeLabelOf(facts.themeWord)
  return {
    honoree: honoreeFirstName(facts),
    partyNoun: label ? `${label} Party` : 'Birthday Party',
    title: facts.title,
    dateLine: facts.dateLine,
    placeLine: facts.placeLine,
    fullAddress: facts.calendarLocation,
    hostContactLine: facts.hostContactLine,
    locationType: facts.locationType,
  }
}

function urlsOf(slug: string): { invite: string; calendar: string; host: string } {
  const invite = `${CANONICAL_ORIGIN}/i/${slug}`
  return { invite, calendar: `${invite}/cal`, host: `${CANONICAL_ORIGIN}/my-booking/invitation` }
}

function childNamesOf(children: unknown): string[] {
  if (!Array.isArray(children)) return []
  return children
    .map((c) => (c && typeof c === 'object' ? (c as { first_name?: unknown }).first_name : null))
    .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
}

function parentAddress(ctx: SendContext): string | null {
  const email = (ctx.booking.contact_email ?? '').trim()
  return isPlausibleEmailAddress(email) ? email : null
}

type GuestTarget = { ok: true; email: string } | { ok: false; reason: string }

function guestAddress(ctx: SendContext): GuestTarget {
  const r = ctx.rsvp
  if (!r) return { ok: false, reason: 'rsvp-gone' }
  if (r.status !== 'yes') return { ok: false, reason: 'rsvp-no' }
  if (r.reminder_opt_out_at) return { ok: false, reason: 'opted-out' }
  const email = (r.reminder_email ?? '').trim()
  if (!isPlausibleEmailAddress(email)) return { ok: false, reason: 'no-email' }
  return { ok: true, email }
}

/** 23:59 Eastern the day before the party, or null when the date is unusable. */
function dayBeforeEnd(ctx: SendContext): Date | null {
  const date = validPartyDate(ctx.booking.party_date)
  if (!date) return null
  const prev = shiftEtDate(date, -1)
  if (!prev) return null
  const d = etToUtc(prev, 23, 59)
  return Number.isFinite(d.getTime()) ? d : null
}

/**
 * When this message stops being sendable, or null if it cannot be worked out (the send is then skipped).
 * Exported so the cron's selection (`cronDue.ts`) uses THE SAME window the sender enforces (P09b).
 */
export function sendableUntil(type: EviteSendType, ctx: SendContext): Date | null {
  const win = ctx.facts.window
  switch (type) {
    case 'lead_preview': {
      const made = Date.parse(String(ctx.booking.created_at ?? ''))
      return Number.isFinite(made) ? new Date(made + LEAD_PREVIEW_WINDOW_MS) : null
    }
    case 'invite_ready':
      return win ? new Date(win.startUtc.getTime() - INVITE_READY_CUTOFF_MS) : null
    case 'week_before':
      return win ? new Date(win.startUtc.getTime() - WEEK_BEFORE_CUTOFF_MS) : null
    case 'day_before':
    case 'final_headcount':
      return dayBeforeEnd(ctx)
    case 'new_rsvp':
    case 'rsvp_changed':
    case 'rsvp_confirmed':
    case 'details_changed':
    case 'party_cancelled':
      return win ? win.startUtc : null
  }
}

function icsAttachment(ctx: SendContext, method: IcsMethod, editUrl: string): EviteMailAttachment {
  const ics = buildIcs(ctx.facts, { id: ctx.evite.id, cal_version: ctx.evite.cal_version }, urlsOf(ctx.evite.slug).invite, { method, now: ctx.now, editUrl })
  return { filename: 'party.ics', content: Buffer.from(ics, 'utf8'), contentType: `text/calendar; method=${method}; charset=UTF-8` }
}

function guestLinks(ctx: SendContext): { ok: true; links: EviteGuestLinks } | { ok: false; error: string } {
  const rsvp = ctx.rsvp
  if (!rsvp) return { ok: false, error: 'no rsvp for an edit link' }
  const exp = editTokenExpiry(ctx.facts.window, ctx.booking.party_date)
  if (exp === null) return { ok: false, error: 'no expiry for the edit link (party has no usable date)' }
  try {
    const token = signEditToken({ id: rsvp.id, edit_nonce: rsvp.edit_nonce }, exp)
    const edit = editLink(ctx.evite.slug, token)
    return { ok: true, links: { calendar: urlsOf(ctx.evite.slug).calendar, edit, stop: `${edit}?stop=1` } }
  } catch (e) {
    return { ok: false, error: `edit link not signed: ${errorMessage(e)}` }
  }
}

/** Checks a PARENT or LEAD recipient against the suppression list. */
async function suppressionGate(supabase: Supa, email: string): Promise<Prep | null> {
  const s = await emailSuppressed(supabase, email)
  if (s === 'suppressed') return skip('suppressed')
  if (s === 'unavailable') return fail('suppression list could not be read')
  return null
}

/* ── per-type preparation ─────────────────────────────────────── */

async function prepare(supabase: Supa, send: ClaimedSend, ctx: SendContext): Promise<Prep> {
  const type = send.send_type
  const { evite, booking, facts, state } = ctx
  const now = ctx.now

  // ---- state
  if (type === 'party_cancelled') {
    if (booking.status !== 'cancelled' && booking.status !== 'lost') return skip('not-cancelled')
  } else if (type === 'lead_preview') {
    if (state !== 'preview') return skip(`state-${state}`)
  } else if (state !== 'live') {
    return skip(`state-${state}`)
  }

  // ---- the calendar version the message was keyed under must still be the current one
  if ((CAL_VERSIONED_TYPES as readonly string[]).includes(type) && send.ref_version !== evite.cal_version) return skip('stale-cal-version')

  // ---- sendable until
  const until = sendableUntil(type, ctx)
  if (until === null) return skip('no-deadline')
  if (now.getTime() > until.getTime()) return skip('past-sendable-window')

  const party = partyOf(facts)
  const urls = urlsOf(evite.slug)

  switch (type) {
    // ------------------------------------------------------------ to the lead / parent
    case 'lead_preview': {
      const to = parentAddress(ctx)
      if (!to) return skip('no-email')
      const gate = await suppressionGate(supabase, to)
      if (gate) return gate
      const imageUrl = storedImageUrl(evite, 'invite', process.env.SUPABASE_URL)
      if (!imageUrl) return fail('the invitation has not been rendered yet')
      const token = generateUnsubscribeToken(to)
      if (!token) return fail('unconfigured: no unsubscribe signing secret')

      // "Reserve your date": the planner, or the invoice when the plan is priced. If the mint fails
      // the BUTTON is omitted; the preview is still worth sending without it.
      let reserveUrl: string | null = null
      if (booking.booking_ref) {
        const tot = await supabase.from('bookings').select('total_cents').eq('id', booking.id).maybeSingle<{ total_cents: number | null }>()
        const priced = !tot.error && !!tot.data && !isUnpricedPlan(Number(tot.data.total_cents ?? 0))
        const destination = priced ? `/plan/${encodeURIComponent(booking.booking_ref)}/summary` : '/party-planner'
        const minted = await mintPortalLink(supabase, booking.id, booking.booking_ref, destination)
        reserveUrl = minted.ok ? minted.url : null
      }
      const mail = leadPreviewEmail({
        party,
        recipientFirstName: firstToken(booking.contact_name),
        imageUrl,
        inviteUrl: urls.invite,
        reserveUrl,
        unsubscribeToken: token,
      })
      return { kind: 'ready', to, mail }
    }

    case 'invite_ready': {
      const to = parentAddress(ctx)
      if (!to) return skip('no-email')
      if (!ctx.renderFresh) return fail('the invitation image is not up to date yet')
      const gate = await suppressionGate(supabase, to)
      if (gate) return gate
      if (!booking.booking_ref) return fail('booking has no reference to mint a link for')
      const minted = await mintPortalLink(supabase, booking.id, booking.booking_ref, '/my-booking/invitation')
      // Never send a dead link: the one email whose whole point is the link.
      if (!minted.ok) return fail(`portal link not minted: ${minted.reason}`)
      return {
        kind: 'ready',
        to,
        mail: inviteReadyEmail({ party, recipientFirstName: firstToken(booking.contact_name), magicUrl: minted.url }),
      }
    }

    case 'new_rsvp':
    case 'rsvp_changed': {
      const rsvp = ctx.rsvp
      if (!rsvp) return skip('rsvp-gone')
      const to = parentAddress(ctx)
      if (!to) return skip('no-email')
      const gate = await suppressionGate(supabase, to)
      if (gate) return gate
      if (guardRecipient(to.toLowerCase(), { label: HOST_NOTIFY_LABEL, max: HOST_NOTIFY_MAX_PER_HOUR, windowMs: HOUR_MS }, now.getTime())) {
        return skip('host-rate-limited')
      }
      const input = {
        party,
        recipientFirstName: firstToken(booking.contact_name),
        rsvp: {
          status: rsvp.status,
          parentName: rsvp.parent_name,
          childNames: childNamesOf(rsvp.children),
          adultCount: rsvp.adult_count,
          hasAllergy: rsvp.has_allergy,
          allergyNote: rsvp.allergy_note,
        },
        hostUrl: urls.host,
      }
      return { kind: 'ready', to, mail: type === 'new_rsvp' ? newRsvpEmail(input) : rsvpChangedEmail(input) }
    }

    case 'final_headcount': {
      const to = parentAddress(ctx)
      if (!to) return skip('no-email')
      const gate = await suppressionGate(supabase, to)
      if (gate) return gate
      const all = await loadHeadcountRsvps(supabase, evite.id)
      if (all.kind === 'unavailable') return fail(all.error)
      const picked = all.rsvps.map((r) => pickHostRsvp(r as unknown as Record<string, unknown>))
      const summary = summarizeRsvps(picked, facts.guestCap)
      const notes = picked
        .filter((r) => typeof r.note_to_honoree === 'string' && r.note_to_honoree.trim() !== '')
        .map((r) => ({ parent: r.parent_name, note: r.note_to_honoree as string }))
      return {
        kind: 'ready',
        to,
        mail: finalHeadcountEmail({
          party,
          recipientFirstName: firstToken(booking.contact_name),
          hostUrl: urls.host,
          summary: {
            kidsYes: summary.kidsYes,
            adultsYes: summary.adultsYes,
            adultsPlus: summary.adultsPlus,
            noCount: summary.noCount,
            cap: summary.cap,
            allergies: summary.allergies,
            notes,
          },
        }),
      }
    }

    // ------------------------------------------------------------ to a guest
    case 'rsvp_confirmed':
    case 'week_before':
    case 'day_before':
    case 'details_changed':
    case 'party_cancelled': {
      const target = guestAddress(ctx)
      if (!target.ok) return skip(target.reason)
      const rsvp = ctx.rsvp as NonNullable<SendContext['rsvp']>
      // A cancellation carries no links of its own (it has nothing to edit or stop), so a signing
      // problem must not stop the one message that tells a family the party is off.
      const linked = type === 'party_cancelled' ? null : guestLinks(ctx)
      if (linked && !linked.ok) return fail(linked.error)
      const links: EviteGuestLinks = linked && linked.ok ? linked.links : { calendar: urls.calendar, edit: urls.invite, stop: urls.invite }
      const guest = { parentName: rsvp.parent_name, childNames: childNamesOf(rsvp.children) }
      const input = {
        party,
        guest,
        links,
        ...(type === 'day_before' ? { mapsUrl: facts.locationType === 'studio' ? STUDIO_MAPS_URL : null } : {}),
      }
      let mail: EviteEmail
      let method: IcsMethod = 'PUBLISH'
      switch (type) {
        case 'rsvp_confirmed':
          mail = rsvpConfirmedEmail(input)
          break
        case 'week_before':
          mail = weekBeforeEmail(input)
          break
        case 'day_before':
          mail = dayBeforeEmail(input)
          break
        case 'details_changed':
          mail = detailsChangedEmail(input)
          break
        default:
          mail = partyCancelledEmail({ party, guest })
          method = 'CANCEL'
      }
      if (!facts.window) return skip('no-window')
      return {
        kind: 'ready',
        to: target.email,
        mail,
        attachments: [icsAttachment(ctx, method, links.edit)],
        stamp: { rsvpId: rsvp.id, version: evite.cal_version },
      }
    }
  }
}

/* ── the send ─────────────────────────────────────────────────── */

async function stampCalVersionSeen(supabase: Supa, stamp: { rsvpId: string; version: number }): Promise<void> {
  const { error } = await supabase
    .from('evite_rsvps')
    .update({ cal_version_seen: stamp.version })
    .eq('id', stamp.rsvpId)
    .lt('cal_version_seen', stamp.version)
    .select('id')
  if (error) console.error(`evites/sendOne: cal_version_seen not recorded for ${stamp.rsvpId}: ${error.message}`)
}

/**
 * Work a send this caller already owns. NEVER THROWS, and always finishes the row.
 * `opts.now` is injectable for the cron's fake clock.
 */
export async function performSend(supabase: Supa, send: ClaimedSend, opts: { now?: Date } = {}): Promise<SendResult> {
  const finish = async (outcome: Parameters<typeof finishSend>[2]): Promise<SendResult> => {
    const done = await finishSend(supabase, send.id, outcome)
    if (!done.ok) console.error(`evites/sendOne: ledger row ${send.id} not finished as ${outcome.kind}: ${done.reason}`)
    if (outcome.kind === 'sent') return { kind: 'sent', providerId: outcome.providerId }
    if (outcome.kind === 'skipped') return { kind: 'skipped', reason: outcome.reason }
    return { kind: 'failed', error: outcome.error }
  }

  try {
    const now = opts.now ?? new Date()

    // The flag, re-read: it may have been switched off since the claim.
    if (eviteSendsMode() === 'off') return await finish({ kind: 'failed', error: 'sends-off' })

    const read = await loadSendContext(supabase, send.evite_id, send.rsvp_id, now)
    if (read.kind === 'unavailable') return await finish({ kind: 'failed', error: read.error })
    if (read.kind === 'absent') return await finish({ kind: 'skipped', reason: `gone-${read.what}` })
    const ctx = read.ctx

    if (eviteSendsMode() === 'pilot' && !isPilotBooking(ctx.booking.booking_ref)) {
      return await finish({ kind: 'skipped', reason: 'not-pilot' })
    }

    const prep = await prepare(supabase, send, ctx)
    if (prep.kind === 'skip') return await finish({ kind: 'skipped', reason: prep.reason })
    if (prep.kind === 'fail') return await finish({ kind: 'failed', error: prep.error })

    const out = await sendEviteEmail({
      to: prep.to,
      subject: prep.mail.subject,
      html: prep.mail.html,
      text: prep.mail.text,
      ...(prep.attachments ? { attachments: prep.attachments } : {}),
      ...(prep.mail.headers ? { headers: prep.mail.headers } : {}),
      replyTo: ownerEmail(),
    })
    if (out.kind === 'unconfigured') return await finish({ kind: 'failed', error: 'unconfigured: no RESEND_API_KEY' })
    if (out.kind === 'failed') return await finish({ kind: 'failed', error: out.error })

    // The email is out. Record that FIRST: it is the write whose loss causes a re-send.
    const result = await finish({ kind: 'sent', providerId: out.providerId })
    if (prep.stamp) await stampCalVersionSeen(supabase, prep.stamp)
    return result
  } catch (e) {
    const error = `threw: ${errorMessage(e)}`
    try {
      return await finish({ kind: 'failed', error })
    } catch {
      return { kind: 'failed', error }
    }
  }
}

/**
 * Claim a send and, if this caller won it, work it. The inline hooks and the cron's fresh sends use
 * this. `disabled` means the flag said no BEFORE anything was written.
 */
export async function claimAndSend(supabase: Supa, key: SendKey, opts: { now?: Date } = {}): Promise<ClaimAndSendResult> {
  const mode = eviteSendsMode()
  if (mode === 'off') return { kind: 'disabled', reason: 'sends-off' }
  if (mode === 'pilot') {
    const gate = await readSendGate(supabase, key.evite_id)
    if (gate.kind === 'unavailable') return { kind: 'unavailable', error: gate.error }
    if (!gate.allowed) return { kind: 'disabled', reason: 'not-pilot' }
  }
  const claim = await claimSend(supabase, key, opts.now)
  if (claim.kind === 'duplicate') return { kind: 'duplicate' }
  if (claim.kind === 'unavailable') return { kind: 'unavailable', error: claim.error }
  return performSend(supabase, claim.send, opts)
}
