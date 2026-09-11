import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { PIPELINE_STAGES, PARTY_TYPES, isPartyType } from '@/lib/pipelineStages'

/**
 * Admin Parties list — the pipeline view (Phase 4 item 5).
 *
 * Two things changed here when every lead became a `bookings` row:
 *
 * 1. **The event_type allowlist had to go.** This route used to select
 *    `event_type IN ('kid-party','kids-party','kids_party','studio-rental')`,
 *    which silently hid seven real parties in production — the four
 *    `room-rental` studio bookings and the three whose event_type is the label
 *    `'Kids Birthday Party'` — and would have hidden every mobile lead, since
 *    `ensureLeadPlan` keeps the form's own words in `event_type`. A pipeline
 *    view whose first job is "no lead gets lost" cannot be built on an
 *    allowlist of spellings. It now EXCLUDES the handful of non-party form
 *    types instead, so anything new shows up by default.
 *
 * 2. **`party_type` is the filter**, not `event_type`. Migration 035 added it
 *    and backfilled all 41 existing rows, which is exactly what `event_type`
 *    could never be: consistent.
 */

/**
 * Rows that live in `bookings` but are not parties. Everything else is, and a
 * new form that starts writing bookings shows up in the pipeline without a
 * code change — the failure mode is "an extra row to triage", not "an invisible
 * lead".
 */
const NON_PARTY_EVENT_TYPES = ['vendor_registration']

const LIST_COLUMNS =
  'id, booking_ref, status, party_type, source, event_type, party_date, party_time, package_type, ' +
  'guest_count_approx, child_name, contact_name, contact_email, contact_phone, total_cents, ' +
  'balance_due_cents, payment_method_preference, approved_at, paid_in_full_at, photo_gallery_url, created_at'

/**
 * Cap on the rows scanned to build the pipeline counts. The business runs ~16
 * leads a month, so this is years of headroom; the cap is here so a runaway
 * table can never turn the Parties tab into a full-table scan. When it is hit
 * the response says so rather than quietly showing wrong numbers.
 */
const COUNT_SCAN_LIMIT = 2000

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const status = req.nextUrl.searchParams.get('status')
  const partyType = req.nextUrl.searchParams.get('party_type')
  const past = req.nextUrl.searchParams.get('past') === 'true'
  const photoFilter = req.nextUrl.searchParams.get('photos') // 'missing' | 'set' | null
  const page = parseInt(req.nextUrl.searchParams.get('page') || '1', 10)
  const limit = 25

  let query = supabase
    .from('bookings')
    .select(LIST_COLUMNS, { count: 'exact' })
    .not('event_type', 'in', `(${NON_PARTY_EVENT_TYPES.join(',')})`)
    .range((page - 1) * limit, page * limit - 1)

  if (past) {
    // Photo backfill view: parties whose date has passed, most recent first
    const today = new Date().toISOString().split('T')[0]
    query = query.lt('party_date', today).order('party_date', { ascending: false })
  } else {
    query = query.order('created_at', { ascending: false })
  }

  if (status) {
    query = query.eq('status', status)
  }

  // Ignore an unrecognised value rather than returning nothing: a typo in the
  // query string should not read as "there are no parties".
  if (isPartyType(partyType)) {
    query = query.eq('party_type', partyType)
  }

  if (photoFilter === 'missing') {
    query = query.is('photo_gallery_url', null)
  } else if (photoFilter === 'set') {
    query = query.not('photo_gallery_url', 'is', null)
  }

  // One unfiltered scan feeds both chip rows. Neither count may be scoped by
  // its own filter: the stage counts must keep showing every stage while you
  // are standing inside one, and the party-type counts must keep showing every
  // product — a chip that reads 0 because it is not the selected chip is worse
  // than no number at all.
  const countQuery = supabase
    .from('bookings')
    .select('status, party_type')
    .not('event_type', 'in', `(${NON_PARTY_EVENT_TYPES.join(',')})`)
    .limit(COUNT_SCAN_LIMIT)

  const [{ data, error, count }, { data: countRows, error: countErr }] = await Promise.all([query, countQuery])

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const activeType = isPartyType(partyType) ? partyType : null
  const byStatus: Record<string, number> = {}
  const byPartyType: Record<string, number> = {}
  let inScope = 0
  for (const row of countRows ?? []) {
    const r = row as { status: string | null; party_type: string | null }
    const pt = r.party_type || 'unknown'
    byPartyType[pt] = (byPartyType[pt] ?? 0) + 1
    if (activeType && pt !== activeType) continue
    inScope++
    if (r.status) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
  }

  return NextResponse.json({
    bookings: data || [],
    total: count || 0,
    page,
    limit,
    stages: PIPELINE_STAGES,
    counts: {
      byStatus,
      byPartyType,
      /** Rows matching the party-type filter, across all stages. */
      all: inScope,
      /** Every party row, ignoring the party-type filter. */
      allTypes: (countRows ?? []).length,
      // True when the cap was hit, i.e. the counts are a floor not a total.
      truncated: (countRows ?? []).length >= COUNT_SCAN_LIMIT,
      error: countErr?.message ?? null,
    },
  })
}
