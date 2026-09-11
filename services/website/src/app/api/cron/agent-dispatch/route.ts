import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { draftForInquiry, AGENT_ACTOR, DRAFT_ENTITY } from '@/lib/agent/draftInquiry'
import { finishEvent, type InboundEvent } from '@/lib/agent/events'
import { agentEnabled, dailyUsdCap } from '@/lib/agent/config'
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

    // Phase 1 only knows how to answer website forms. Quo/Gmail events are
    // parked (not deleted) until their phases land.
    if (event.source !== 'website_form') {
      await finishEvent(supabase, event.id, 'ignored', { error: `source '${event.source}' not handled in Phase 1` })
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
      } else {
        await finishEvent(supabase, event.id, 'error', { error: outcome.error })
        results.push({ kind: 'event', id: event.id, outcome: 'error', error: outcome.error })
        // Budget refusal: stop the batch rather than fail every remaining item.
        if (outcome.status === 402) break
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

  for (const booking of (bookings ?? []) as Record<string, unknown>[]) {
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

  console.log(`cron:agent-dispatch drafted ${drafted}`, results)

  return NextResponse.json({
    enabled: true,
    claimed: results.filter(r => r.kind === 'event' && r.outcome !== 'already_claimed').length,
    drafted,
    spentUsd: spent,
    capUsd: cap,
    results,
  })
}
