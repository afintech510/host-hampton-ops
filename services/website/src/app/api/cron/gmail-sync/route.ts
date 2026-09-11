import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { upsertContact } from '@/lib/contacts'
import { recordInboundEvent } from '@/lib/agent/events'
import {
  applyHandledLabel,
  ensureHandledLabel,
  gmailConfigured,
  gmailUser,
  getMessage,
  getProfileHistoryId,
  listHistory,
  listMessages,
  type GmailMessage,
} from '@/lib/gmail'
import { autoIgnoreReason } from '@/lib/agent/triage'

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

/* ── Sync state ─────────────────────────────────────────────────────── */

interface SyncState {
  history_id: string | null
  last_full_sync_at: string | null
}

async function readState(supabase: Supa): Promise<SyncState> {
  const { data } = await supabase
    .from('gmail_sync_state')
    .select('history_id, last_full_sync_at')
    .eq('id', 1)
    .maybeSingle()
  return {
    history_id: (data?.history_id as string) ?? null,
    last_full_sync_at: (data?.last_full_sync_at as string) ?? null,
  }
}

async function writeState(supabase: Supa, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from('gmail_sync_state')
    .upsert({ id: 1, last_poll_at: new Date().toISOString(), ...patch }, { onConflict: 'id' })
  if (error) console.error('gmail-sync: state write failed:', error.message)
}

/* ── Ingestion ──────────────────────────────────────────────────────── */

/**
 * The contact behind an inbound message, created if we have not seen them.
 *
 * Only for real inbound mail from a human: `autoIgnoreReason` has already
 * excluded receipts and platform senders, so this does not fill the address
 * book (and Brevo, and Quo, via contactSync) with robots.
 */
/** Display name out of `"Jess Rivera" <jess@…>`, falling back to the local part. */
function displayName(msg: GmailMessage): string {
  return (msg.from.match(/^\s*"?([^"<]+?)"?\s*</)?.[1] || msg.fromEmail.split('@')[0] || '').trim()
}

async function contactFor(msg: GmailMessage): Promise<string | null> {
  if (msg.direction === 'out') return null
  if (autoIgnoreReason(msg.fromEmail, msg.subject)) return null

  const supabase = getSupabase()
  const { data: existing } = await supabase
    .from('contacts')
    .select('id')
    .eq('email', msg.fromEmail)
    .maybeSingle()
  if (existing?.id) return String(existing.id)

  return upsertContact({
    name: displayName(msg),
    email: msg.fromEmail,
    phone: null,
    sourceDetail: 'gmail-inbound',
    serviceInterests: ['general'],
    marketingConsent: false,
  })
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

  // The backfill is a CORPUS pull, and contactSync mirrors every new contact
  // into Brevo and Quo. Creating one per sender across twelve months would
  // push a year of strangers into both address books — a large, outward-facing
  // side effect nobody asked for. It links to contacts that already exist and
  // creates none.
  const contactId = forceHandled
    ? ((await supabase.from('contacts').select('id').eq('email', msg.fromEmail).maybeSingle()).data?.id ?? null)
    : await contactFor(msg)
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

  // Label it whatever happened — including on a duplicate, which just means a
  // previous run recorded it but did not get as far as the label.
  if (labelId) await applyHandledLabel(msg.id, labelId)

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
  const labelId = await ensureHandledLabel()

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
  for (const id of ids) {
    try {
      results.push(await ingestOne(supabase, id, labelId))
    } catch (err) {
      failure = err instanceof Error ? err.message : 'ingest failed'
      console.error('gmail-sync: ingest failed for', id, failure)
    }
  }

  // Only advance the checkpoint when the batch came through cleanly. Moving it
  // past a message we failed to read would lose that message permanently.
  if (nextHistoryId && !failure) {
    await writeState(supabase, { history_id: nextHistoryId, last_error: null })
  } else {
    await writeState(supabase, { last_error: failure })
  }

  const body = {
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
