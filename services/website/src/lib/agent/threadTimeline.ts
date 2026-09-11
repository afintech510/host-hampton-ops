/**
 * The lead timeline — one chronological stream per lead (plan §11.2).
 *
 * ── The one design decision worth not re-deriving ────────────────────────
 *
 * This module creates NO new storage. Every row it returns already exists and
 * is already written by some other part of the system:
 *
 *   ingested_messages        the real conversation (forms, SMS, Gmail)
 *   inquiry_drafts.revisions every draft version and the note that caused it
 *   marketing_ledger         transitions, sends, LLM cost, nudges
 *   booking_payments         deposit paid, balance paid
 *   contact_interactions     calls, opt-outs, portal messages
 *
 * A sixth table holding "the thread" would be the one row nobody could explain
 * the provenance of — written by the UI, agreeing with the ledger only as long
 * as someone remembered to keep it in step. So this is a READ-SIDE ASSEMBLY:
 * if the timeline is wrong, the underlying table is wrong, and fixing the table
 * fixes the timeline. There is no third state where they disagree.
 *
 * It is also why this file has no writes at all, not even a ledger note. The
 * surfaces that mutate (api/admin/agent, api/admin/lead) do their own writing
 * through advance()/writeLedger() with a real admin actor, and this module then
 * reads what they left.
 *
 * ── Anchors ──────────────────────────────────────────────────────────────
 *
 * A lead is identified by up to three anchors and they are all optional
 * because real leads arrive with different ones: a website form gives a
 * booking, a cold Gmail reply gives only a contact, and a draft created by hand
 * may briefly have neither. Every query below is skipped when its anchor is
 * absent — never issued with an `undefined` filter, which PostgREST would
 * happily interpret as "all rows".
 */

import type { getSupabase } from '@/lib/supabase'

type Supa = ReturnType<typeof getSupabase>

/* ── The item union ─────────────────────────────────────────────────────── */

/**
 * Which side of the thread an item renders on. `system` items are the thin
 * rules between messages — a transition, a cost, a nudge — and deliberately do
 * not look like something anybody said.
 */
export type TimelineSide = 'inbound' | 'outbound' | 'system'

interface TimelineBase {
  /** Stable across reloads: `<kind>:<row id>[:<index>]`. Used as the React key. */
  id: string
  /** ISO timestamp. The single sort key. */
  at: string
  side: TimelineSide
}

export interface TimelineMessage extends TimelineBase {
  kind: 'message'
  source: string
  /** 'in' | 'out' as stored; kept raw so an unexpected value is visible. */
  direction: string | null
  from: string | null
  subject: string | null
  body: string | null
  classification: string | null
  status: string | null
}

export interface TimelineDraftVersion extends TimelineBase {
  kind: 'draft_version'
  draftId: string
  reviewCode: string | null
  /** 1-based, as Allie counts them: "v2 · warmer, mom-to-mom". */
  version: number
  /** 'agent' | 'reviewer' | 'admin' — who caused this version. */
  author: string
  /** The instruction that produced it, when there was one. */
  note: string | null
  subject: string | null
  emailDraft: string | null
  smsDraft: string | null
  /** The immediately preceding version's bodies, for the v1→v2 diff. */
  previousEmailDraft: string | null
  previousSmsDraft: string | null
}

export interface TimelineLedger extends TimelineBase {
  kind: 'ledger'
  entityType: string
  entityId: string
  action: string
  actor: string | null
  fromStatus: string | null
  toStatus: string | null
  costUsd: number | null
  tokens: number | null
  meta: Record<string, unknown> | null
}

export interface TimelinePayment extends TimelineBase {
  kind: 'payment'
  paymentType: string
  paymentMethod: string
  amountCents: number
  totalChargedCents: number
  recordedBy: string
  notes: string | null
}

export interface TimelineInteraction extends TimelineBase {
  kind: 'interaction'
  type: string
  channel: string | null
  summary: string | null
}

export type TimelineItem =
  | TimelineMessage
  | TimelineDraftVersion
  | TimelineLedger
  | TimelinePayment
  | TimelineInteraction

export interface LeadTimelineAnchors {
  supabase: Supa
  bookingId?: string | null
  contactId?: string | null
  draftId?: string | null
}

export interface LeadTimeline {
  items: TimelineItem[]
  /** Every draft id the timeline touched, newest first. */
  draftIds: string[]
  /**
   * Per-source failures, not thrown. A timeline that renders four of five
   * sources and SAYS which one it could not read beats a blank page — and
   * silence about a source we failed to load is exactly the shape of bug that
   * made a held draft look like a sent one.
   */
  errors: string[]
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

/** `a,b` — a PostgREST `.or()` term list, only for the anchors we actually have. */
function orFilter(pairs: Array<[string, string | null | undefined]>): string | null {
  const terms = pairs.filter(([, v]) => !!v).map(([col, v]) => `${col}.eq.${v}`)
  return terms.length ? terms.join(',') : null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

/**
 * A revision entry as `draftInquiry.ts` and `api/admin/agent` write it. Both
 * writers are loose about which fields they include — a `reviewer` entry
 * carries only a note, an `agent` entry carries the bodies — so every field is
 * optional here and the reader never assumes.
 */
interface RevisionEntry {
  at?: string
  actor?: string
  note?: string
  subject?: string
  email_draft?: string
  sms_draft?: string
}

/* ── The load ───────────────────────────────────────────────────────────── */

const MESSAGE_COLUMNS =
  'id, source, direction, from_address, subject, body, classification, status, sent_at, created_at'
const DRAFT_COLUMNS =
  'id, review_code, status, subject, email_draft, sms_draft, revisions, created_at, booking_id, contact_id'
const LEDGER_COLUMNS =
  'id, entity_type, entity_id, action, actor, from_status, to_status, cost_usd, tokens, meta, created_at'

/** Enough history for a lead; a lead with more than this is an outlier worth seeing truncated. */
const ROW_LIMIT = 200

export async function loadLeadTimeline(input: LeadTimelineAnchors): Promise<LeadTimeline> {
  const { supabase, bookingId, contactId, draftId } = input
  const items: TimelineItem[] = []
  const errors: string[] = []

  if (!bookingId && !contactId && !draftId) {
    return { items, draftIds: [], errors: ['No booking, contact or draft to build a timeline from'] }
  }

  /* ── Drafts first: they supply the draft ids the ledger query needs. ──── */
  const draftOr = orFilter([
    ['id', draftId],
    ['booking_id', bookingId],
    ['contact_id', contactId],
  ])
  let drafts: Record<string, unknown>[] = []
  if (draftOr) {
    const { data, error } = await supabase
      .from('inquiry_drafts')
      .select(DRAFT_COLUMNS)
      .or(draftOr)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) errors.push(`drafts: ${error.message}`)
    drafts = (data ?? []) as Record<string, unknown>[]
  }
  const draftIds = drafts.map(d => String(d.id))

  /* ── The rest, in parallel. Each is skipped when its anchor is absent. ── */
  const messageOr = orFilter([
    ['booking_id', bookingId],
    ['contact_id', contactId],
    ['draft_id', draftId],
  ])

  const [messages, ledger, payments, interactions] = await Promise.all([
    messageOr
      ? supabase
          .from('ingested_messages')
          .select(MESSAGE_COLUMNS)
          .or(messageOr)
          .order('created_at', { ascending: false })
          .limit(ROW_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    // Two entity types in one query: the drafts' own transitions and the
    // booking's. `.in` on an empty array is a valid "match nothing", but the
    // whole query is skipped when there is nothing to match at all.
    draftIds.length || bookingId
      ? supabase
          .from('marketing_ledger')
          .select(LEDGER_COLUMNS)
          .or(
            [
              draftIds.length ? `and(entity_type.eq.inquiry_draft,entity_id.in.(${draftIds.join(',')}))` : null,
              bookingId ? `and(entity_type.eq.booking,entity_id.eq.${bookingId})` : null,
            ]
              .filter(Boolean)
              .join(','),
          )
          .order('created_at', { ascending: false })
          .limit(ROW_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    bookingId
      ? supabase
          .from('booking_payments')
          .select('id, payment_type, payment_method, amount_cents, total_charged_cents, recorded_by, notes, paid_at, created_at')
          .eq('booking_id', bookingId)
          .order('paid_at', { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [], error: null }),
    contactId
      ? supabase
          .from('contact_interactions')
          .select('id, type, channel, summary, created_at')
          .eq('contact_id', contactId)
          .order('created_at', { ascending: false })
          .limit(ROW_LIMIT)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (messages.error) errors.push(`messages: ${messages.error.message}`)
  if (ledger.error) errors.push(`ledger: ${ledger.error.message}`)
  if (payments.error) errors.push(`payments: ${payments.error.message}`)
  if (interactions.error) errors.push(`interactions: ${interactions.error.message}`)

  /* ── Messages ────────────────────────────────────────────────────────── */
  for (const raw of (messages.data ?? []) as Record<string, unknown>[]) {
    const direction = str(raw.direction)
    items.push({
      kind: 'message',
      id: `message:${raw.id}`,
      // `sent_at` is when the human sent it; `created_at` is when we ingested
      // it. The Gmail backfill made that gap twelve months wide, so ordering by
      // ingestion time would have put a 2024 email at the top of today's thread.
      at: str(raw.sent_at) || str(raw.created_at) || new Date(0).toISOString(),
      side: direction === 'out' ? 'outbound' : 'inbound',
      source: String(raw.source ?? 'unknown'),
      direction,
      from: str(raw.from_address),
      subject: str(raw.subject),
      body: str(raw.body),
      classification: str(raw.classification),
      status: str(raw.status),
    })
  }

  /* ── Draft versions ──────────────────────────────────────────────────── */
  for (const draft of drafts) {
    const revisions = Array.isArray(draft.revisions) ? (draft.revisions as RevisionEntry[]) : []
    const reviewCode = str(draft.review_code)
    const draftRowId = String(draft.id)

    // v1 is the draft as first generated. It is not in `revisions[]` — that
    // array only records what happened AFTER — so it is synthesised from the
    // row's creation, and the current bodies are used only when there are no
    // revisions at all (otherwise they are the LATEST text, not the first).
    const bodied = revisions.filter(r => r.email_draft != null || r.sms_draft != null)
    let version = 0
    let prevEmail: string | null = null
    let prevSms: string | null = null

    if (bodied.length === 0) {
      version += 1
      items.push({
        kind: 'draft_version',
        id: `draft:${draftRowId}:0`,
        at: str(draft.created_at) || new Date(0).toISOString(),
        side: 'outbound',
        draftId: draftRowId,
        reviewCode,
        version,
        author: 'agent',
        note: null,
        subject: str(draft.subject),
        emailDraft: str(draft.email_draft),
        smsDraft: str(draft.sms_draft),
        previousEmailDraft: null,
        previousSmsDraft: null,
      })
    }

    revisions.forEach((rev, i) => {
      const hasBody = rev.email_draft != null || rev.sms_draft != null
      if (!hasBody) {
        // A note-only entry (`{actor: 'reviewer', note}`) is the INSTRUCTION,
        // not a version — it belongs in the stream as the thing Allie said,
        // which is exactly what makes the next version explicable.
        items.push({
          kind: 'draft_version',
          id: `draft:${draftRowId}:${i}`,
          at: str(rev.at) || str(draft.created_at) || new Date(0).toISOString(),
          side: 'system',
          draftId: draftRowId,
          reviewCode,
          version: 0,
          author: rev.actor || 'reviewer',
          note: str(rev.note),
          subject: null,
          emailDraft: null,
          smsDraft: null,
          previousEmailDraft: null,
          previousSmsDraft: null,
        })
        return
      }
      version += 1
      items.push({
        kind: 'draft_version',
        id: `draft:${draftRowId}:${i}`,
        at: str(rev.at) || str(draft.created_at) || new Date(0).toISOString(),
        side: 'outbound',
        draftId: draftRowId,
        reviewCode,
        version,
        author: rev.actor || 'agent',
        note: str(rev.note),
        subject: str(rev.subject) ?? str(draft.subject),
        emailDraft: str(rev.email_draft),
        smsDraft: str(rev.sms_draft),
        previousEmailDraft: prevEmail,
        previousSmsDraft: prevSms,
      })
      prevEmail = str(rev.email_draft)
      prevSms = str(rev.sms_draft)
    })
  }

  /* ── Ledger ──────────────────────────────────────────────────────────── */
  for (const raw of (ledger.data ?? []) as Record<string, unknown>[]) {
    items.push({
      kind: 'ledger',
      id: `ledger:${raw.id}`,
      at: str(raw.created_at) || new Date(0).toISOString(),
      side: 'system',
      entityType: String(raw.entity_type ?? ''),
      entityId: String(raw.entity_id ?? ''),
      action: String(raw.action ?? ''),
      actor: str(raw.actor),
      fromStatus: str(raw.from_status),
      toStatus: str(raw.to_status),
      costUsd: typeof raw.cost_usd === 'number' ? raw.cost_usd : null,
      tokens: typeof raw.tokens === 'number' ? raw.tokens : null,
      meta: asRecord(raw.meta),
    })
  }

  /* ── Payments ────────────────────────────────────────────────────────── */
  for (const raw of (payments.data ?? []) as Record<string, unknown>[]) {
    items.push({
      kind: 'payment',
      id: `payment:${raw.id}`,
      at: str(raw.paid_at) || str(raw.created_at) || new Date(0).toISOString(),
      side: 'system',
      paymentType: String(raw.payment_type ?? ''),
      paymentMethod: String(raw.payment_method ?? ''),
      amountCents: Number(raw.amount_cents ?? 0),
      totalChargedCents: Number(raw.total_charged_cents ?? 0),
      recordedBy: String(raw.recorded_by ?? 'system'),
      notes: str(raw.notes),
    })
  }

  /* ── Interactions ────────────────────────────────────────────────────── */
  for (const raw of (interactions.data ?? []) as Record<string, unknown>[]) {
    items.push({
      kind: 'interaction',
      id: `interaction:${raw.id}`,
      at: str(raw.created_at) || new Date(0).toISOString(),
      side: 'system',
      type: String(raw.type ?? ''),
      channel: str(raw.channel),
      summary: str(raw.summary),
    })
  }

  // Oldest first — the thread reads downward like a conversation does. Ties
  // break on id so two events written in the same millisecond (a transition and
  // its cost row) keep a stable order between renders.
  items.sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at.localeCompare(b.at)))

  return { items, draftIds, errors }
}
