import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { isPartyType } from '@/lib/pipelineStages'
import { ALL_STAGES, isBookingStage, partyStatuses } from '@/lib/bookingStatus'
import { sumPayments } from '@/lib/bookingBalance'
import { loadPricingCatalog } from '@/lib/pricingCatalog'
import { etDateString } from '@/lib/partyTime'

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

/**
 * The last three are jsonb reads, not columns: the customer's pizza-or-bagels and
 * cupcake-flavour choices live inside `quote_snapshot` (see lib/partyFood.ts).
 * They are pulled out with `->>` rather than selecting the whole snapshot
 * because a snapshot carries its full line-item array — 25 of them is a payload
 * nobody needs to page a table. Adam asked for these on the summary so the
 * morning-of question is answerable without opening the customer's portal.
 */
const LIST_COLUMNS =
  'id, booking_ref, status, party_type, source, event_type, party_date, party_time, package_type, ' +
  'guest_count_approx, child_name, contact_name, contact_email, contact_phone, total_cents, ' +
  'balance_due_cents, deposit_amount, payment_method_preference, approved_at, paid_in_full_at, photo_gallery_url, created_at, ' +
  'pizza_or_bagels:quote_snapshot->>pizzaOrBagels, ' +
  'cupcake_flavor:quote_snapshot->>cupcakeFlavor, ' +
  'add_mobile_cupcakes:quote_snapshot->>addMobileCupcakes'

/**
 * Cap on the rows scanned to build the pipeline counts. The business runs ~16
 * leads a month, so this is years of headroom; the cap is here so a runaway
 * table can never turn the Parties tab into a full-table scan. When it is hit
 * the response says so rather than quietly showing wrong numbers.
 */
const COUNT_SCAN_LIMIT = 2000

/** One row of `LIST_COLUMNS`, as far as the sort/merge below need to know it. */
interface ListRow {
  party_date: string | null
  contact_name: string | null
  status: string | null
  stage?: string
  [key: string]: unknown
}

type SortColumn = 'party_date' | 'contact_name' | 'status'

/**
 * Compares two rows for the in-memory sort `hidePast` needs (see below). Nulls
 * sort last regardless of direction — the same `nullsFirst: false` the plain
 * DB-ordered path below asks Postgres for, kept consistent here by hand.
 */
function compareRows(a: ListRow, b: ListRow, sortBy: SortColumn, sortDir: 'asc' | 'desc'): number {
  // "Status" sorts by booking stage, in pipeline order.
  const key = (r: ListRow): string | null =>
    sortBy === 'status'
      ? String((ALL_STAGES as readonly string[]).indexOf(r.stage as string)).padStart(2, '0')
      : (r[sortBy] as string | null)
  const av = key(a)
  const bv = key(b)
  if (av == null && bv == null) return 0
  if (av == null) return 1
  if (bv == null) return -1
  if (av === bv) return 0
  const dir = sortDir === 'asc' ? 1 : -1
  return av < bv ? -dir : dir
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  // `stage` is the derived booking stage (lib/bookingStatus.ts). The old
  // `status` param filtered the raw column, whose values stopped meaning one
  // thing; it is still honoured for any bookmarked URL.
  const stageParam = req.nextUrl.searchParams.get('stage')
  const rawStatus = req.nextUrl.searchParams.get('status')
  const stage = isBookingStage(stageParam) ? stageParam : null
  const partyType = req.nextUrl.searchParams.get('party_type')
  const past = req.nextUrl.searchParams.get('past') === 'true'
  const photoFilter = req.nextUrl.searchParams.get('photos') // 'missing' | 'set' | null
  const page = parseInt(req.nextUrl.searchParams.get('page') || '1', 10)
  const limit = 25

  const sortByParam = req.nextUrl.searchParams.get('sortBy')
  const sortBy: SortColumn =
    sortByParam === 'contact_name' || sortByParam === 'status' ? sortByParam : 'party_date'
  const sortDir = req.nextUrl.searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc'
  // Opt OUT with `hidePast=false`; any other value (including absent) hides.
  const hidePast = req.nextUrl.searchParams.get('hidePast') !== 'false'

  // One read of every party row and every payment. The stage depends on the
  // money, so it cannot be a PostgREST filter; the table is ~100 rows and the
  // cap makes a runaway table say so instead of becoming a full scan.
  const [rowsRes, paysRes, catalog] = await Promise.all([
    supabase
      .from('bookings')
      .select(LIST_COLUMNS)
      .not('event_type', 'in', `(${NON_PARTY_EVENT_TYPES.join(',')})`)
      .limit(COUNT_SCAN_LIMIT),
    supabase.from('booking_payments').select('booking_id, amount_cents, payment_type').limit(COUNT_SCAN_LIMIT * 5),
    loadPricingCatalog(supabase),
  ])
  if (rowsRes.error) return NextResponse.json({ error: rowsRes.error.message }, { status: 500 })
  // A failed payments read must not render every booked party as an unpaid
  // inquiry (rule 12): refuse instead.
  if (paysRes.error) {
    return NextResponse.json({ error: `Could not read payments: ${paysRes.error.message}` }, { status: 503 })
  }

  type PayRow = { booking_id: string; amount_cents: number | null; payment_type: string | null }
  const paysBy = new Map<string, PayRow[]>()
  for (const p of (paysRes.data ?? []) as PayRow[]) {
    const list = paysBy.get(p.booking_id) ?? []
    list.push(p)
    paysBy.set(p.booking_id, list)
  }

  const today = etDateString()
  const all: ListRow[] = ((rowsRes.data ?? []) as unknown as ListRow[]).map(r => {
    const paid = sumPayments(paysBy.get(r.id as string))
    const s = partyStatuses({
      status: r.status,
      paidCents: paid,
      partyDate: r.party_date,
      today,
      totalCents: r.total_cents as number | null,
      depositCents: r.deposit_amount as number | null,
    })
    return { ...r, paid_cents: paid, stage: s.stage, payment_status: s.payment_status }
  })

  const activeType = isPartyType(partyType) ? partyType : null
  const inType = (r: ListRow) => !activeType || ((r.party_type as string) || 'unknown') === activeType
  const isExit = (r: ListRow) => r.stage === 'cancelled' || r.stage === 'lost'

  let list = all.filter(r => {
    if (stage) {
      if (r.stage !== stage) return false
    } else if (rawStatus) {
      if (r.status !== rawStatus) return false
    } else if (isExit(r)) {
      // Cancelled and Lost are exits, hidden unless asked for by name; their
      // chips still show the real count and still list them.
      return false
    }
    if (!inType(r)) return false
    if (photoFilter === 'missing' && r.photo_gallery_url) return false
    if (photoFilter === 'set' && !r.photo_gallery_url) return false
    return true
  })

  if (past) {
    // Photo backfill view: parties on or before today (Eastern — the album
    // goes out the evening of the party), most recent first.
    list = list.filter(r => !!r.party_date && r.party_date <= today)
    list.sort((a, b) => compareRows(a, b, 'party_date', 'desc'))
  } else {
    // A null date is "not yet scheduled", not "past", so it stays visible.
    if (hidePast) list = list.filter(r => !r.party_date || r.party_date >= today)
    list.sort((a, b) => compareRows(a, b, sortBy, sortDir))
  }

  const total = list.length
  const data = list.slice((page - 1) * limit, page * limit)

  // Chip counts are never scoped by their own filter: stage counts keep every
  // stage visible while you stand in one, type counts keep every product. They
  // count every date, past included — the list below them is what hides past.
  const byStage: Record<string, number> = {}
  const byPartyType: Record<string, number> = {}
  let inScope = 0
  let allTypes = 0
  for (const r of all) {
    if (inType(r)) byStage[r.stage as string] = (byStage[r.stage as string] ?? 0) + 1
    if (isExit(r)) continue
    const pt = (r.party_type as string) || 'unknown'
    byPartyType[pt] = (byPartyType[pt] ?? 0) + 1
    allTypes++
    if (inType(r)) inScope++
  }

  return NextResponse.json({
    bookings: data,
    total,
    page,
    limit,
    stages: ALL_STAGES,
    // The live studio rate card, so the tab's re-pricing helper text cannot
    // describe prices `edit_rental` no longer charges.
    studioRates: catalog.studioRates,
    counts: {
      byStage,
      byPartyType,
      /** Open (not cancelled/lost) rows matching the party-type filter. */
      all: inScope,
      /** Every open party row, ignoring the party-type filter. */
      allTypes,
      // True when the cap was hit, i.e. the counts are a floor not a total.
      truncated: (rowsRes.data ?? []).length >= COUNT_SCAN_LIMIT,
      error: null,
    },
  })
}
