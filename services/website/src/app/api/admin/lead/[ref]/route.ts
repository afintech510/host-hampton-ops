import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { loadLeadTimeline } from '@/lib/agent/threadTimeline'
import { writeLedger } from '@/lib/marketing/graph'
import { coerceIsoDate } from '@/lib/plan'
import { isPartyType } from '@/lib/pipelineStages'

export const dynamic = 'force-dynamic'

/**
 * The Lead Thread Workspace's data route (plan §11.2, §11.6).
 *
 * GET   → everything `/admin/lead/[ref]` renders: the lead, its drafts, the
 *         assembled timeline and the plan's line items.
 * PATCH → the plan panel's inline edits — a WHITELIST of `bookings` columns.
 *
 * Mutations to a DRAFT are not here. They go to `/api/admin/agent`, which is
 * where approve / send / edit / revise already live and where the GATED
 * `approved` and `sent` transitions are made through `advance()`. Two routes
 * that could both approve a draft is how one of them ends up being the one
 * nobody remembered to guard.
 */

const BOOKING_COLUMNS =
  'id, booking_ref, status, party_type, event_type, package_type, invoice_number, ' +
  'contact_id, contact_name, contact_email, contact_phone, party_date, party_time, ' +
  'guest_count_approx, child_name, child_age, party_tags, notes, admin_notes, ' +
  'total_cents, deposit_amount, balance_due_cents, source, created_at, updated_at'

const DRAFT_COLUMNS =
  'id, review_code, status, party_type, contact_path, draft_kind, channel, missing_fields, ' +
  'subject, email_draft, sms_draft, error, reviewer_note, booking_id, contact_id, ' +
  'inbound_event_id, approved_at, approved_by, sent_at, sent_for_review_at, created_at, updated_at'

/** Draft statuses that still represent live, actionable work on this lead. */
const OPEN_DRAFT_STATUSES = ['drafted', 'sent_for_review', 'revision_requested', 'approved']

/**
 * Find the lead by whatever `[ref]` turns out to be. Allie will arrive here
 * from three places with three different identifiers — a booking ref from the
 * Parties tab, a review code from an SMS, a draft UUID from the Inbox — and
 * making her know which one she is holding would defeat the point of a single
 * lead page.
 */
async function resolveLead(supabase: ReturnType<typeof getSupabase>, ref: string) {
  // Booking ref (HH-xxxx style or whatever `bookings.booking_ref` holds).
  const byRef = await supabase.from('bookings').select(BOOKING_COLUMNS).eq('booking_ref', ref).maybeSingle()
  if (byRef.data) return { booking: byRef.data as unknown as Record<string, unknown>, draftId: null as string | null }

  // Review code from a reviewer SMS, e.g. HH-2026-0042.
  const byCode = await supabase
    .from('inquiry_drafts')
    .select('id, booking_id, contact_id')
    .eq('review_code', ref)
    .maybeSingle()
  if (byCode.data) {
    const bookingId = (byCode.data as { booking_id: string | null }).booking_id
    if (bookingId) {
      const { data } = await supabase.from('bookings').select(BOOKING_COLUMNS).eq('id', bookingId).maybeSingle()
      if (data) return { booking: data as unknown as Record<string, unknown>, draftId: String((byCode.data as { id: string }).id) }
    }
    // A draft with no plan row yet is still a lead — it just has no right rail.
    return { booking: null, draftId: String((byCode.data as { id: string }).id), contactId: (byCode.data as { contact_id: string | null }).contact_id }
  }

  // A raw UUID: try bookings, then drafts.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) {
    const b = await supabase.from('bookings').select(BOOKING_COLUMNS).eq('id', ref).maybeSingle()
    if (b.data) return { booking: b.data as unknown as Record<string, unknown>, draftId: null }
    const d = await supabase.from('inquiry_drafts').select('id, booking_id, contact_id').eq('id', ref).maybeSingle()
    if (d.data) {
      return {
        booking: null,
        draftId: ref,
        contactId: (d.data as { contact_id: string | null }).contact_id,
      }
    }
  }

  return null
}

export async function GET(req: NextRequest, { params }: { params: { ref: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()
  const ref = decodeURIComponent(params.ref || '')
  if (!ref) return NextResponse.json({ error: 'ref is required' }, { status: 400 })

  const found = await resolveLead(supabase, ref)
  if (!found) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const booking = found.booking
  const bookingId = booking ? String(booking.id) : null
  const contactId = (booking?.contact_id as string | null) ?? (found as { contactId?: string | null }).contactId ?? null

  const [timeline, drafts, lineItems] = await Promise.all([
    loadLeadTimeline({ supabase, bookingId, contactId, draftId: found.draftId }),
    supabase
      .from('inquiry_drafts')
      .select(DRAFT_COLUMNS)
      .or(
        [
          found.draftId ? `id.eq.${found.draftId}` : null,
          bookingId ? `booking_id.eq.${bookingId}` : null,
          contactId ? `contact_id.eq.${contactId}` : null,
        ]
          .filter(Boolean)
          .join(','),
      )
      .order('created_at', { ascending: false })
      .limit(25),
    bookingId
      ? supabase
          .from('booking_line_items')
          .select('id, name, category, quantity, unit_price_cents, price_type, guest_multiplied, sort_order')
          .eq('booking_id', bookingId)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ])

  const draftRows = (drafts.data ?? []) as unknown as Record<string, unknown>[]
  const openDrafts = draftRows.filter(d => OPEN_DRAFT_STATUSES.includes(String(d.status)))

  return NextResponse.json({
    ref,
    booking,
    drafts: draftRows,
    // The one the composer acts on by default: the newest still-open draft.
    activeDraftId: openDrafts[0] ? String(openDrafts[0].id) : null,
    lineItems: lineItems.data ?? [],
    timeline: timeline.items,
    // Never swallowed: a source that failed to load is shown as a failure, not
    // as an absence that reads exactly like "nothing happened".
    errors: [...timeline.errors, drafts.error?.message, lineItems.error?.message].filter(Boolean),
  })
}

/* ── Plan panel edits ───────────────────────────────────────────────────── */

/**
 * The only `bookings` columns this route will write.
 *
 * A whitelist, not a blocklist, and deliberately excluding every money column
 * (`total_cents`, `deposit_amount`, `balance_due_cents`) and `status`. Pricing
 * is derived from the catalog and the line items by `lib/plan.ts`, and the
 * pipeline stage moves through `advance()` — letting a text field on a panel
 * set either of them would make this route a second, unguarded writer of the
 * two things the ledger exists to explain.
 */
const EDITABLE: Record<string, 'text' | 'int' | 'date' | 'party_type'> = {
  contact_name: 'text',
  contact_email: 'text',
  contact_phone: 'text',
  party_date: 'date',
  party_time: 'text',
  guest_count_approx: 'int',
  child_name: 'text',
  child_age: 'int',
  event_type: 'text',
  package_type: 'text',
  notes: 'text',
  admin_notes: 'text',
  party_type: 'party_type',
}

export async function PATCH(req: NextRequest, { params }: { params: { ref: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()
  const ref = decodeURIComponent(params.ref || '')

  const found = await resolveLead(supabase, ref)
  if (!found?.booking) {
    return NextResponse.json({ error: 'This lead has no party plan to edit yet' }, { status: 404 })
  }
  const booking = found.booking
  const bookingId = String(booking.id)

  const body = (await req.json()) as { fields?: Record<string, unknown> }
  const fields = body.fields && typeof body.fields === 'object' ? body.fields : {}

  const patch: Record<string, unknown> = {}
  const changed: Record<string, { from: unknown; to: unknown }> = {}
  for (const [key, raw] of Object.entries(fields)) {
    const type = EDITABLE[key]
    if (!type) continue
    let value: unknown
    if (raw === null || raw === '') {
      value = null
    } else if (type === 'int') {
      const n = Number(raw)
      if (!Number.isFinite(n) || n < 0) continue
      value = Math.round(n)
    } else if (type === 'date') {
      value = coerceIsoDate(String(raw))
      if (!value) continue
    } else if (type === 'party_type') {
      if (!isPartyType(String(raw))) continue
      value = String(raw)
    } else {
      value = String(raw).slice(0, 4000)
    }
    if (value === booking[key]) continue
    patch[key] = value
    changed[key] = { from: booking[key] ?? null, to: value }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, changed: {}, staleDraftIds: [] })
  }
  patch.updated_at = new Date().toISOString()

  const { error } = await supabase.from('bookings').update(patch).eq('id', bookingId)
  if (error) {
    console.error('admin/lead PATCH error:', error.message)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  // Any open draft for this lead now describes a plan that no longer exists.
  // Marking it stale is a NOTE, not a status change: the draft is still
  // approvable and the human decides. But a quote that silently stops matching
  // the plan is worse than no quote, so the fact is recorded and shown.
  const { data: open } = await supabase
    .from('inquiry_drafts')
    .select('id')
    .eq('booking_id', bookingId)
    .in('status', OPEN_DRAFT_STATUSES)
  const staleDraftIds = ((open ?? []) as { id: string }[]).map(d => d.id)

  const actor = adminActorId(req)
  await writeLedger(supabase, {
    entityType: 'booking',
    entityId: bookingId,
    action: 'note',
    actor,
    meta: { job: 'plan_edit', via: 'admin_lead', fields: changed, stale_draft_ids: staleDraftIds },
  })
  for (const draftId of staleDraftIds) {
    await writeLedger(supabase, {
      entityType: 'inquiry_draft',
      entityId: draftId,
      action: 'note',
      actor,
      meta: { job: 'plan_changed', via: 'admin_lead', fields: Object.keys(changed) },
    })
  }

  return NextResponse.json({ ok: true, changed, staleDraftIds, sentToCustomer: false })
}
