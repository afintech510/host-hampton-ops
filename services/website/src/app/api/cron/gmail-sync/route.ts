import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { recordInboundEvent } from '@/lib/agent/events'
import {
  applyLabel,
  ensureSeenLabel,
  gmailConfigured,
  gmailUser,
  getMessage,
  getProfileHistoryId,
  listHistory,
  listMessages,
  type GmailMessage,
} from '@/lib/gmail'
import { autoIgnoreReason } from '@/lib/agent/triage'
import { notifyOwnerSms } from '@/lib/ownerNotify'

export const dynamic = 'force-dynamic'

/**
 * Gmail ingestion (plan §3, Phase 3 step 3). Runs every 3 minutes on
 * cron-job.org.
 *
 * Each poll resumes from the `history_id` checkpoint in `gmail_sync_state` and
 * asks Gmail only what changed. Gmail keeps roughly a week of history, so an
 * outage longer than that (or a first run) falls back to a bounded
 * `newer_than:2d` query — never an unbounded mailbox read, which on a mailbox
 * this old would be thousands of messages and a very expensive surprise.
 *
 * BOTH DIRECTIONS ARE INGESTED. Mail Allie sends by hand is recorded as
 * `direction='out'` and marked `ignored` so it never triggers a draft. It earns
 * its place twice over: it is the verbatim voice corpus for Phase 6, and it is
 * what tells the agent to stand down on a thread a human has already answered.
 *
 * This route can only read and label. The Gmail grant has no send scope.
 *
 * Auth: x-cron-secret / ?secret=, matching the other cron routes.
 *   ?backfill=1  one-time bounded historical pull (see runBackfill).
 */

function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET
}

type Supa = ReturnType<typeof getSupabase>

/** Messages pulled per poll. The cron is every 3 minutes; this is plenty. */
const POLL_BATCH = 25
/** Messages per backfill request, so one call cannot run for minutes. */
const BACKFILL_BATCH = 60
/**
 * How many consecutive polls may fail on the same batch before the checkpoint
 * is forced past it.
 *
 * The checkpoint deliberately does not advance when a message fails to ingest,
 * so nothing is silently skipped. On its own that is a trap: a message that
 * fails DETERMINISTICALLY (a body that breaks a parser, a row the DB keeps
 * rejecting) stalls the mailbox forever — and because `history.list` keeps
 * returning from the same fixed `startHistoryId` while new mail piles up behind
 * the POLL_BATCH slice, the backlog grows without bound and no new mail is ever
 * read again. Three failed runs is ~9 minutes of retrying, which covers any
 * transient fault; after that the poison ids are recorded, the reviewers are
 * texted, and the mailbox keeps moving.
 */
const MAX_FAIL_STREAK = 3

/* ── Sync state ─────────────────────────────────────────────────────── */

interface SyncState {
  history_id: string | null
  last_full_sync_at: string | null
  fail_streak: number
}

async function readState(supabase: Supa): Promise<SyncState> {
  const { data } = await supabase
    .from('gmail_sync_state')
    .select('history_id, last_full_sync_at, fail_streak')
    .eq('id', 1)
    .maybeSingle()
  return {
    history_id: (data?.history_id as string) ?? null,
    last_full_sync_at: (data?.last_full_sync_at as string) ?? null,
    fail_streak: Number(data?.fail_streak ?? 0) || 0,
  }
}

async function writeState(supabase: Supa, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from('gmail_sync_state')
    .upsert({ id: 1, last_poll_at: new Date().toISOString(), ...patch }, { onConflict: 'id' })
  if (error) console.error('gmail-sync: state write failed:', error.message)
}

/* ── Ingestion ──────────────────────────────────────────────────────── */

/** Display name out of `"Jess Rivera" <jess@…>`, falling back to the local part. */
function displayName(msg: GmailMessage): string {
  return (msg.from.match(/^\s*"?([^"<]+?)"?\s*</)?.[1] || msg.fromEmail.split('@')[0] || '').trim()
}

/**
 * Link to an EXISTING contact. Ingestion never creates one.
 *
 * It used to, for any sender the auto-ignore list did not recognise — which in
 * one real poll meant 52 new contacts for Abercrombie, Royal Caribbean,
 * Priceline and friends. A marketing sender is only KNOWN to be marketing once
 * triage has read it, so ingestion cannot tell and must not guess. The
 * dispatcher creates the contact after triage says the message is worth
 * answering, which is also when the plan's "every contact exists in Supabase,
 * Brevo and Quo" rule starts to matter.
 */
async function existingContactFor(supabase: Supa, msg: GmailMessage): Promise<string | null> {
  if (!msg.fromEmail) return null
  const { data } = await supabase.from('contacts').select('id').eq('email', msg.fromEmail).maybeSingle()
  return data?.id ? String(data.id) : null
}

/**
 * Link a message to an existing party plan (plan §3, Phase 3 step 5).
 *
 * Only ever ATTACHES to a plan that already exists — it does not create one.
 * Creating a plan from an email is Phase 4's job ("every lead is a Party
 * Plan"), and doing it here would mint `lead` rows the sweep would then draft
 * for, from mail triage has not looked at yet.
 */
async function bookingFor(supabase: Supa, contactId: string | null): Promise<string | null> {
  if (!contactId) return null
  const { data } = await supabase
    .from('bookings')
    .select('id')
    .eq('contact_id', contactId)
    .not('status', 'in', '("cancelled","completed")')
    .order('created_at', { ascending: false })
    .limit(1)
  return ((data ?? [])[0] as { id: string } | undefined)?.id ?? null
}

interface IngestOutcome {
  id: string
  outcome: 'recorded' | 'ignored' | 'duplicate' | 'unreadable'
  reason?: string
}

/**
 * Record one Gmail message as an inbound event.
 *
 * `forceHandled` is the backfill: historical mail is written straight to
 * `handled` so the dispatcher never drafts a reply to a year-old email.
 */
async function ingestOne(supabase: Supa, id: string, labelId: string | null, forceHandled = false): Promise<IngestOutcome> {
  const msg = await getMessage(id)
  if (!msg || !msg.id) return { id, outcome: 'unreadable' }

  // Outbound mail and machine senders are kept as history, never drafted for.
  const ignore = msg.direction === 'out' ? 'outbound — voice corpus, stands the agent down on this thread' : autoIgnoreReason(msg.fromEmail, msg.subject)
  const needsAction = !forceHandled && !ignore

  const contactId = await existingContactFor(supabase, msg)
  const bookingId = await bookingFor(supabase, contactId)

  const eventId = await recordInboundEvent({
    supabase,
    route: 'gmail-sync',
    source: 'gmail',
    externalId: `gmail:${msg.id}`,
    contactId,
    bookingId,
    fromAddress: msg.fromEmail,
    toAddress: msg.to || null,
    subject: msg.subject || null,
    body: msg.body || null,
    threadId: msg.threadId || null,
    direction: msg.direction,
    // The message's OWN date, not the moment we read it. `sent_at` is what the
    // stand-down check compares ("did a human reply after this came in?") and
    // what the admin Inbox sorts by, so ingestion time is the wrong answer
    // twice over: the 12-month backfill stamped a year of mail with today, and
    // every one of those 119 outbound rows then looked newer than any inbound
    // message on its thread.
    sentAt: msg.sentAt,
    needsAction,
    classification: ignore ? 'auto_ignored' : null,
    parsed: {
      // `name` and `email` are the keys inquiryFromEvent() reads, so a drafted
      // reply is addressed to a person rather than to nobody.
      name: displayName(msg),
      email: msg.fromEmail,
      details: msg.body || null,
      gmail_id: msg.id,
      thread_id: msg.threadId,
      from_display: msg.from,
      sent_at: msg.sentAt,
      label_ids: msg.labelIds,
      auto_ignore_reason: ignore ?? null,
    },
  })

  // The SEEN label, whatever happened — including on a duplicate, which just
  // means a previous run recorded it but did not get as far as the label. SEEN
  // claims only that the message is in `ingested_messages`. The HANDLED label
  // is the dispatcher's to apply, once a message has actually produced a draft.
  if (labelId) await applyLabel(msg.id, labelId)

  if (!eventId) return { id, outcome: 'duplicate' }
  return { id, outcome: ignore || forceHandled ? 'ignored' : 'recorded', reason: ignore ?? undefined }
}

/* ── Backfill ───────────────────────────────────────────────────────── */

/**
 * One bounded historical pull (plan §3, Phase 3 step 6): the last 12 months of
 * inbox and sent mail, written as `handled` so it feeds the Phase 6 voice
 * corpus without ever triggering a draft.
 *
 * Paged — call it repeatedly with the returned `pageToken` until `done`. It is
 * NOT on a schedule; it is run by hand once.
 */
async function runBackfill(supabase: Supa, pageToken: string | null) {
  const { ids, nextPageToken } = await listMessages(
    'newer_than:12m (in:inbox OR in:sent)',
    BACKFILL_BATCH,
    pageToken || undefined,
  )
  const results: IngestOutcome[] = []
  for (const id of ids) {
    // No label on backfill: relabelling a year of mail is noise in the mailbox,
    // and `external_id` is already the dedupe.
    results.push(await ingestOne(supabase, id, null, true))
  }
  await writeState(supabase, { last_full_sync_at: new Date().toISOString() })
  return {
    mode: 'backfill' as const,
    scanned: ids.length,
    recorded: results.filter(r => r.outcome !== 'duplicate').length,
    duplicates: results.filter(r => r.outcome === 'duplicate').length,
    nextPageToken,
    done: !nextPageToken,
  }
}

/* ── Route ──────────────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!gmailConfigured()) {
    // Not an error: this is the documented state before Adam's one-time consent.
    return NextResponse.json({ configured: false, message: 'GMAIL_* env not set', scanned: 0 })
  }

  const supabase = getSupabase()

  if (req.nextUrl.searchParams.get('backfill') === '1') {
    const res = await runBackfill(supabase, req.nextUrl.searchParams.get('pageToken'))
    return NextResponse.json({ configured: true, user: gmailUser(), ...res })
  }

  const state = await readState(supabase)
  const labelId = await ensureSeenLabel()

  let ids: string[] = []
  let nextHistoryId: string | null = null
  let mode: 'history' | 'query' = 'history'

  if (state.history_id) {
    const hist = await listHistory(state.history_id)
    if (hist.expired) {
      // Gmail dropped the checkpoint. Catch up with a bounded window rather
      // than reading the whole mailbox.
      mode = 'query'
      ids = (await listMessages('newer_than:2d', POLL_BATCH)).ids
      nextHistoryId = await getProfileHistoryId()
    } else {
      ids = hist.messageIds.slice(0, POLL_BATCH)
      nextHistoryId = hist.historyId
    }
  } else {
    // First run ever: seed the checkpoint and take a bounded look back.
    mode = 'query'
    ids = (await listMessages('newer_than:2d', POLL_BATCH)).ids
    nextHistoryId = await getProfileHistoryId()
  }

  const results: IngestOutcome[] = []
  let failure: string | null = null
  const failedIds: string[] = []
  for (const id of ids) {
    try {
      results.push(await ingestOne(supabase, id, labelId))
    } catch (err) {
      failure = err instanceof Error ? err.message : 'ingest failed'
      failedIds.push(id)
      console.error('gmail-sync: ingest failed for', id, failure)
    }
  }

  // Only advance the checkpoint when the batch came through cleanly. Moving it
  // past a message we failed to read would lose that message permanently.
  //
  // …unless the SAME batch has now failed MAX_FAIL_STREAK runs in a row, which
  // means the failure is not transient. Retrying a deterministic failure every
  // three minutes forever does not eventually succeed; it just stops the
  // mailbox. Force the checkpoint past it, record which ids were skipped so a
  // human can go and look, and say so out loud.
  let forcedPast: string[] = []
  if (nextHistoryId && !failure) {
    await writeState(supabase, { history_id: nextHistoryId, last_error: null, fail_streak: 0 })
  } else {
    const streak = state.fail_streak + 1
    if (failure && nextHistoryId && streak >= MAX_FAIL_STREAK) {
      forcedPast = failedIds
      await writeState(supabase, {
        history_id: nextHistoryId,
        fail_streak: 0,
        skipped_message_ids: failedIds,
        last_error: `skipped ${failedIds.length} unreadable message(s) after ${streak} failed runs: ${failure}`,
      })
      await notifyOwnerSms(
        `Gmail sync skipped ${failedIds.length} message(s) it could not ingest after ${streak} tries ` +
          `(${failedIds.join(', ').slice(0, 120)}). Mail is flowing again; those ids need a look.`,
      ).catch(() => 0)
    } else {
      await writeState(supabase, { last_error: failure, fail_streak: failure ? streak : state.fail_streak })
    }
  }

  const body = {
    forcedPast,
    configured: true,
    user: gmailUser(),
    mode,
    scanned: ids.length,
    recorded: results.filter(r => r.outcome === 'recorded').length,
    ignored: results.filter(r => r.outcome === 'ignored').length,
    duplicates: results.filter(r => r.outcome === 'duplicate').length,
    unreadable: results.filter(r => r.outcome === 'unreadable').length,
    labelled: !!labelId,
    error: failure,
  }
  console.log('cron:gmail-sync', body)
  return NextResponse.json(body)
}
