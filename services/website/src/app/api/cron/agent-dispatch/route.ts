import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { draftForInquiry, AGENT_ACTOR, DRAFT_ENTITY } from '@/lib/agent/draftInquiry'
import { finishEvent, type InboundEvent } from '@/lib/agent/events'
import { agentEnabled, dailyUsdCap, isBusinessHours, NUDGE_AFTER_MS } from '@/lib/agent/config'
import { handleReviewerReply } from '@/lib/agent/reviewLoop'
import { notifyOwnerSms } from '@/lib/ownerNotify'
import { writeLedger } from '@/lib/marketing/graph'

export const dynamic = 'force-dynamic'

/**
 * Booking-agent dispatcher. Runs every 2 minutes on cron-job.org.
 *
 * Two sources of work:
 *   1. `ingested_messages` rows with status='new' — website forms today, Quo
 *      SMS (Phase 2) and Gmail (Phase 3) later.
 *   2. A sweep of `bookings` in 'pending_review' / 'lead' with no live draft,
 *      so a lead is never missed just because a route wasn't instrumented.
 *
 * Claiming: each event is taken with a compare-and-swap UPDATE — set
 * status='claimed' WHERE id=? AND status='new', returning the row. Postgres
 * serialises the two writers, so exactly one run gets the row back and the
 * other sees zero rows and moves on. That gives the same guarantee as
 * SELECT … FOR UPDATE SKIP LOCKED without adding a DB function, and combines
 * with the partial unique index on inquiry_drafts(inbound_event_id) so even a
 * double-claim could only ever produce one draft.
 *
 * Everything is behind AGENT_ENABLED. With the flag off this route claims
 * nothing, spends nothing and sends nothing.
 *
 * Auth: x-cron-secret / ?secret= (matches the other cron routes).
 */

function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET
}

/** Events per run. Small — the cron fires every 2 minutes. */
const EVENT_BATCH = 5
/** Bookings inspected per sweep. */
const SWEEP_BATCH = 5
/**
 * Events older than this are never drafted for. Without it, switching
 * AGENT_ENABLED on after a quiet month would text the reviewers a draft for
 * every lead of that month.
 */
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000
/** How far back the booking sweep looks. */
const SWEEP_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
/**
 * An event claimed longer ago than this is assumed abandoned — the container
 * was rebuilt or the request timed out mid-draft — and is returned to 'new'.
 * Without this a crash between claim and draft parks a lead forever.
 */
const CLAIM_REAP_MS = 15 * 60 * 1000

const EVENT_COLUMNS =
  'id, source, external_id, direction, from_address, to_address, subject, body, parsed, contact_id, booking_id, status, classification, created_at'

const BOOKING_COLUMNS =
  'id, booking_ref, status, event_type, package_type, notes, party_tags, contact_name, contact_email, contact_phone, party_date, party_time, guest_count_approx, child_name, child_age, created_at'

type Supa = ReturnType<typeof getSupabase>

/** Agent LLM spend so far today (UTC), in USD. */
async function spentTodayUsd(supabase: Supa): Promise<number> {
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const { data, error } = await supabase
    .from('marketing_ledger')
    .select('cost_usd')
    .eq('action', 'llm_call')
    .eq('actor', AGENT_ACTOR)
    .gte('created_at', startOfDay.toISOString())
  if (error || !data) return 0
  return data.reduce((sum, r) => sum + Number((r as { cost_usd: number | null }).cost_usd ?? 0), 0)
}

/** Text the reviewers at most once per day that the cap is hit. */
async function noticeCapOnce(supabase: Supa, spent: number, cap: number): Promise<void> {
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const { data } = await supabase
    .from('marketing_ledger')
    .select('id')
    .eq('entity_type', DRAFT_ENTITY)
    .eq('action', 'note')
    .eq('actor', AGENT_ACTOR)
    .gte('created_at', startOfDay.toISOString())
    .contains('meta', { job: 'agent_daily_cap' })
    .limit(1)
  if (data && data.length > 0) return

  await notifyOwnerSms(
    `Host Hampton agent paused: daily LLM cap reached ($${spent.toFixed(2)} / $${cap.toFixed(2)}). No drafts until tomorrow (UTC). Raise AGENT_DAILY_USD_CAP to continue.`,
  )
  await writeLedger(supabase, {
    entityType: DRAFT_ENTITY,
    action: 'note',
    actor: AGENT_ACTOR,
    meta: { job: 'agent_daily_cap', spent, cap },
  })
}

/**
 * Compare-and-swap claim. Returns the row when THIS caller won it, null when
 * another runner (or a human) already moved it out of 'new'.
 */
async function claimEvent(supabase: Supa, id: string): Promise<InboundEvent | null> {
  const { data, error } = await supabase
    .from('ingested_messages')
    .update({ status: 'claimed', claimed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'new')
    .select(EVENT_COLUMNS)
  if (error) {
    console.error('cron:agent-dispatch claim error:', error.message)
    return null
  }
  const rows = (data ?? []) as unknown as InboundEvent[]
  return rows.length === 1 ? rows[0] : null
}

/**
 * Return abandoned claims to the queue. Safe to run every time: it only touches
 * rows still in 'claimed' whose claimed_at is older than CLAIM_REAP_MS, and the
 * work it re-enables is itself idempotent (the partial unique index on
 * inquiry_drafts(inbound_event_id) means a re-drafted event can only ever have
 * one live draft).
 */
async function reapStaleClaims(supabase: Supa): Promise<number> {
  const cutoff = new Date(Date.now() - CLAIM_REAP_MS).toISOString()
  const { data, error } = await supabase
    .from('ingested_messages')
    .update({ status: 'new', claimed_at: null })
    .eq('status', 'claimed')
    .lt('claimed_at', cutoff)
    .select('id')
  if (error) {
    console.error('cron:agent-dispatch reap error:', error.message)
    return 0
  }
  const n = (data ?? []).length
  if (n > 0) console.warn(`cron:agent-dispatch reaped ${n} abandoned claim(s)`)
  return n
}

/**
 * Booking ids in `ids` that already have an inquiry_drafts row of ANY status.
 *
 * The sweep must skip these. The per-booking live-draft check inside
 * draftForInquiry deliberately ignores 'sent' and 'cancelled' rows so a
 * re-opened booking can be drafted again — but on its own that means a draft
 * Adam DISMISSES is re-created (and re-texted) by the next sweep two minutes
 * later, forever, until the daily cap stops it. One draft attempt per booking
 * from the sweep; a deliberate re-draft is the Inbox tab's "Draft now" button.
 */
async function bookingsWithAnyDraft(supabase: Supa, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const { data, error } = await supabase.from('inquiry_drafts').select('booking_id').in('booking_id', ids)
  if (error) {
    // Unknown → skip the whole sweep rather than risk re-texting. The event
    // path is the primary trigger; the sweep is belt and braces.
    console.error('cron:agent-dispatch sweep draft-lookup error:', error.message)
    return new Set(ids)
  }
  return new Set((data ?? []).map(r => String((r as { booking_id: string | null }).booking_id)))
}

/**
 * One nudge SMS per draft that has sat in `sent_for_review` for two hours, and
 * only during waking hours.
 *
 * "At most one per draft" is enforced by `nudged_at`: it is stamped in the same
 * statement that the partial index filters on, so two overlapping cron runs
 * cannot both send. A revision resets it to null (see redraftForReviewer) —
 * that is deliberate, the new text deserves its own two-hour clock.
 */
async function nudgeStaleReviews(supabase: Supa): Promise<number> {
  if (!isBusinessHours()) return 0

  const cutoff = new Date(Date.now() - NUDGE_AFTER_MS).toISOString()
  const { data, error } = await supabase
    .from('inquiry_drafts')
    .select('id, review_code, party_type, contact_path, sms_draft, sent_for_review_at')
    .eq('status', 'sent_for_review')
    .is('nudged_at', null)
    .lt('sent_for_review_at', cutoff)
    .order('sent_for_review_at', { ascending: true })
    .limit(3)

  if (error) {
    console.error('cron:agent-dispatch nudge query error:', error.message)
    return 0
  }

  let sent = 0
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    // Claim the nudge before sending it: the compare-and-swap on nudged_at IS
    // NULL means only one runner can ever win this row.
    const { data: claimedRows, error: claimErr } = await supabase
      .from('inquiry_drafts')
      .update({ nudged_at: new Date().toISOString() })
      .eq('id', row.id as string)
      .is('nudged_at', null)
      .select('id')
    if (claimErr || (claimedRows ?? []).length !== 1) continue

    const hours = Math.round((Date.now() - new Date(row.sent_for_review_at as string).getTime()) / 3_600_000)
    await notifyOwnerSms(
      `[${row.review_code}] still waiting — drafted ${hours}h ago for a ${String(row.party_type).replace(/_/g, ' ')} ` +
        `${row.contact_path === 'quote' ? 'quote' : 'info-gather'} and nobody has replied. ` +
        `Reply SEND, CANCEL, or say what to change. This is the only reminder.`,
    )
    await writeLedger(supabase, {
      entityType: DRAFT_ENTITY,
      entityId: row.id as string,
      action: 'note',
      actor: AGENT_ACTOR,
      meta: { job: 'review_nudge', review_code: row.review_code, waited_hours: hours },
    })
    sent++
  }
  return sent
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!agentEnabled()) {
    return NextResponse.json({ enabled: false, claimed: 0, drafted: 0, message: 'AGENT_ENABLED is off' })
  }

  const supabase = getSupabase()

  const cap = dailyUsdCap()
  const spent = await spentTodayUsd(supabase)
  if (spent >= cap) {
    await noticeCapOnce(supabase, spent, cap)
    return NextResponse.json({ enabled: true, claimed: 0, drafted: 0, capped: true, spentUsd: spent, capUsd: cap })
  }

  const results: { kind: 'event' | 'booking'; id: string; outcome: string; draftId?: string; error?: string }[] = []
  let drafted = 0

  // ── 0. Return abandoned claims to the queue ─────────────────────────
  const reaped = await reapStaleClaims(supabase)

  // ── 1. New inbound events ───────────────────────────────────────────
  const { data: candidates, error: candErr } = await supabase
    .from('ingested_messages')
    .select('id, created_at')
    .eq('status', 'new')
    .order('created_at', { ascending: true })
    .limit(EVENT_BATCH)

  if (candErr) console.error('cron:agent-dispatch fetch error:', candErr.message)

  for (const candidate of candidates ?? []) {
    const event = await claimEvent(supabase, candidate.id as string)
    if (!event) {
      results.push({ kind: 'event', id: candidate.id as string, outcome: 'already_claimed' })
      continue
    }

    if (Date.now() - new Date(event.created_at).getTime() > MAX_EVENT_AGE_MS) {
      await finishEvent(supabase, event.id, 'ignored', { error: 'stale: older than the dispatch window' })
      results.push({ kind: 'event', id: event.id, outcome: 'stale' })
      continue
    }

    // ── Inbound SMS (Phase 2). A reviewer's text drives the review loop; a
    // customer's text is recorded and parked, because deciding whether an
    // arbitrary message needs an answer is triage, which is Phase 3. It shows up
    // in Admin → Inbox with a "Draft now" button in the meantime.
    if (event.source === 'quo') {
      const review = await handleReviewerReply({
        supabase,
        from: event.from_address || '',
        text: event.body || '',
        eventId: event.id,
      })
      if (review.handled) {
        await finishEvent(supabase, event.id, 'handled', {
          draftId: review.draftId ?? null,
          classification: `reviewer_${review.intent ?? 'reply'}`,
          error: review.error ?? null,
        })
        results.push({ kind: 'event', id: event.id, outcome: `reviewer_${review.outcome}`, draftId: review.draftId })
      } else {
        await finishEvent(supabase, event.id, 'ignored', {
          classification: 'sms_inbound',
          error: 'inbound customer SMS: triage lands in Phase 3. Use Draft now in Admin → Inbox.',
        })
        results.push({ kind: 'event', id: event.id, outcome: 'sms_awaiting_triage' })
      }
      continue
    }

    // Gmail events are parked (not deleted) until Phase 3 lands.
    if (event.source !== 'website_form') {
      await finishEvent(supabase, event.id, 'ignored', { error: `source '${event.source}' not handled yet` })
      results.push({ kind: 'event', id: event.id, outcome: 'unsupported_source' })
      continue
    }

    try {
      const outcome = await draftForInquiry({ supabase, event })
      if (outcome.ok) {
        drafted++
        await finishEvent(supabase, event.id, 'handled', { draftId: outcome.draftId, classification: 'lead' })
        results.push({ kind: 'event', id: event.id, outcome: 'drafted', draftId: outcome.draftId })
      } else if (outcome.skipped) {
        await finishEvent(supabase, event.id, 'handled', { error: outcome.error })
        results.push({ kind: 'event', id: event.id, outcome: 'skipped', error: outcome.error })
      } else if (outcome.status === 402) {
        // Budget refusal is about US, not about this lead. Put it back in the
        // queue (marking it 'error' would silently drop the lead for good) and
        // stop the batch rather than fail every remaining item.
        await supabase
          .from('ingested_messages')
          .update({ status: 'new', claimed_at: null, error: outcome.error })
          .eq('id', event.id)
        results.push({ kind: 'event', id: event.id, outcome: 'requeued_budget', error: outcome.error })
        break
      } else {
        await finishEvent(supabase, event.id, 'error', { error: outcome.error })
        results.push({ kind: 'event', id: event.id, outcome: 'error', error: outcome.error })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'dispatch failed'
      await finishEvent(supabase, event.id, 'error', { error: msg })
      results.push({ kind: 'event', id: event.id, outcome: 'error', error: msg })
    }
  }

  // ── 2. Sweep: recent leads/requests with no live draft ──────────────
  // Belt and braces for the routes that create a booking without an event.
  const since = new Date(Date.now() - SWEEP_WINDOW_MS).toISOString()
  const { data: bookings, error: bookErr } = await supabase
    .from('bookings')
    .select(BOOKING_COLUMNS)
    .in('status', ['pending_review', 'lead'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(SWEEP_BATCH)

  if (bookErr) console.error('cron:agent-dispatch sweep error:', bookErr.message)

  const sweepRows = (bookings ?? []) as Record<string, unknown>[]
  const alreadyDrafted = await bookingsWithAnyDraft(supabase, sweepRows.map(b => String(b.id)))

  for (const booking of sweepRows) {
    if (alreadyDrafted.has(String(booking.id))) {
      results.push({ kind: 'booking', id: String(booking.id), outcome: 'already_drafted' })
      continue
    }
    try {
      const outcome = await draftForInquiry({
        supabase,
        booking: booking as unknown as Parameters<typeof draftForInquiry>[0]['booking'],
      })
      if (outcome.ok) {
        drafted++
        results.push({ kind: 'booking', id: String(booking.id), outcome: 'drafted', draftId: outcome.draftId })
      } else if (outcome.skipped) {
        results.push({ kind: 'booking', id: String(booking.id), outcome: 'skipped' })
      } else {
        results.push({ kind: 'booking', id: String(booking.id), outcome: 'error', error: outcome.error })
        if (outcome.status === 402) break
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'sweep failed'
      results.push({ kind: 'booking', id: String(booking.id), outcome: 'error', error: msg })
    }
  }

  // ── 3. Nudge: drafts sitting unreviewed for 2 business hours ────────
  const nudged = await nudgeStaleReviews(supabase)

  console.log(`cron:agent-dispatch drafted ${drafted} nudged ${nudged}`, results)

  return NextResponse.json({
    enabled: true,
    claimed: results.filter(r => r.kind === 'event' && r.outcome !== 'already_claimed').length,
    reaped,
    drafted,
    nudged,
    spentUsd: spent,
    capUsd: cap,
    results,
  })
}
