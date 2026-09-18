import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { PIPELINE_STAGES, PARTY_TYPES, isPartyType } from '@/lib/pipelineStages'
import { loadPricingCatalog } from '@/lib/pricingCatalog'

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
  'balance_due_cents, payment_method_preference, approved_at, paid_in_full_at, photo_gallery_url, created_at, ' +
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
  [key: string]: unknown
}

type SortColumn = 'party_date' | 'contact_name' | 'status'

/**
 * Compares two rows for the in-memory sort `hidePast` needs (see below). Nulls
 * sort last regardless of direction — the same `nullsFirst: false` the plain
 * DB-ordered path below asks Postgres for, kept consistent here by hand.
 */
function compareRows(a: ListRow, b: ListRow, sortBy: SortColumn, sortDir: 'asc' | 'desc'): number {
  const av = a[sortBy] as string | null
  const bv = b[sortBy] as string | null
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
  const status = req.nextUrl.searchParams.get('status')
  const partyType = req.nextUrl.searchParams.get('party_type')
  const past = req.nextUrl.searchParams.get('past') === 'true'
  const photoFilter = req.nextUrl.searchParams.get('photos') // 'missing' | 'set' | null
  const page = parseInt(req.nextUrl.searchParams.get('page') || '1', 10)
  const limit = 25

  // Column sort for the main list (ignored by the `past=true` photo-backfill
  // view below, which has its own fixed ordering). Date is the default and
  // ascending, so with `hidePast` also defaulted on, the soonest upcoming
  // party — today's, if one exists — sorts to the top rather than whatever
  // was created most recently.
  const sortByParam = req.nextUrl.searchParams.get('sortBy')
  const sortBy: SortColumn =
    sortByParam === 'contact_name' || sortByParam === 'status' ? sortByParam : 'party_date'
  const sortDir = req.nextUrl.searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc'
  // Opt OUT with `hidePast=false`; any other value (including absent) hides.
  const hidePast = req.nextUrl.searchParams.get('hidePast') !== 'false'

  // Every filter shared by every shape of this query except party_date/order/
  // range/count, which differ by branch below. `.select()` is left to each
  // caller since the two `hidePast` halves don't want a `count`.
  function withCommonFilters<T extends { eq: Function; neq: Function; not: Function; is: Function }>(q: T): T {
    let out = q.not('event_type', 'in', `(${NON_PARTY_EVENT_TYPES.join(',')})`)
    if (status) {
      out = out.eq('status', status)
    } else {
      // Cancelled is an exit from the pipeline, not a stage in it, and it is
      // the bucket that fills up with abandoned duplicates and throwaway
      // rows. It is hidden unless you ask for it by name — the Cancelled
      // chip still shows the true count and still lists them, so nothing
      // becomes unreachable.
      out = out.neq('status', 'cancelled')
    }
    // Ignore an unrecognised value rather than returning nothing: a typo in
    // the query string should not read as "there are no parties".
    if (isPartyType(partyType)) out = out.eq('party_type', partyType)
    if (photoFilter === 'missing') out = out.is('photo_gallery_url', null)
    else if (photoFilter === 'set') out = out.not('photo_gallery_url', 'is', null)
    return out
  }

  let data: ListRow[] | null = null
  let error: { message: string } | null = null
  let count = 0

  if (past) {
    // Photo backfill view: parties whose date has passed, most recent first.
    const today = new Date().toISOString().split('T')[0]
    const res = await withCommonFilters(
      supabase.from('bookings').select(LIST_COLUMNS, { count: 'exact' }),
    )
      .lt('party_date', today)
      .order('party_date', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)
    data = res.data as ListRow[] | null
    error = res.error
    count = res.count || 0
  } else if (hidePast) {
    // "party_date >= today OR party_date IS NULL" — a null date is "not yet
    // scheduled", not "past", so it stays visible rather than vanishing from
    // the list. PostgREST has no safe way to express that OR through this
    // client except the raw `.or()` filter string, which this codebase bans
    // outright (R10/R4: it is an injection vector once any part of the
    // expression can carry a caller-influenced value, and an exemption for
    // "but this part is server-generated" is exactly the exception that got
    // it removed last time). So: two filtered queries, merged and paginated
    // by hand instead of by PostgREST.
    const today = new Date().toISOString().split('T')[0]
    const [futureRes, undatedRes] = await Promise.all([
      withCommonFilters(supabase.from('bookings').select(LIST_COLUMNS)).gte('party_date', today).limit(COUNT_SCAN_LIMIT),
      withCommonFilters(supabase.from('bookings').select(LIST_COLUMNS)).is('party_date', null).limit(COUNT_SCAN_LIMIT),
    ])
    if (futureRes.error || undatedRes.error) {
      error = futureRes.error || undatedRes.error
    } else {
      const merged = [...(futureRes.data || []), ...(undatedRes.data || [])] as unknown as ListRow[]
      merged.sort((a, b) => compareRows(a, b, sortBy, sortDir))
      count = merged.length
      data = merged.slice((page - 1) * limit, page * limit)
    }
  } else {
    const res = await withCommonFilters(
      supabase.from('bookings').select(LIST_COLUMNS, { count: 'exact' }),
    )
      .order(sortBy, { ascending: sortDir === 'asc', nullsFirst: false })
      .range((page - 1) * limit, page * limit - 1)
    data = res.data as ListRow[] | null
    error = res.error
    count = res.count || 0
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

  const [{ data: countRows, error: countErr }, catalog] = await Promise.all([
    countQuery,
    loadPricingCatalog(supabase),
  ])

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const activeType = isPartyType(partyType) ? partyType : null
  const byStatus: Record<string, number> = {}
  const byPartyType: Record<string, number> = {}
  let inScope = 0
  let allTypes = 0
  for (const row of countRows ?? []) {
    const r = row as { status: string | null; party_type: string | null }
    const pt = r.party_type || 'unknown'
    // Every stage chip, including Cancelled, counts every row — that chip is
    // the only way back to a cancelled party now that the default list hides
    // them, so its number has to be the real one.
    if (r.status && (!activeType || pt === activeType)) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
    }
    // The type chips and the two "All" chips describe the DEFAULT list, which
    // no longer contains cancelled rows. Counting them here would make All read
    // higher than the list it labels.
    if (r.status === 'cancelled') continue
    byPartyType[pt] = (byPartyType[pt] ?? 0) + 1
    allTypes++
    if (activeType && pt !== activeType) continue
    inScope++
  }

  return NextResponse.json({
    bookings: data || [],
    total: count || 0,
    page,
    limit,
    stages: PIPELINE_STAGES,
    // The live studio rate card, so the tab's re-pricing helper text cannot
    // describe prices `edit_rental` no longer charges.
    studioRates: catalog.studioRates,
    counts: {
      byStatus,
      byPartyType,
      /** Non-cancelled rows matching the party-type filter, across all stages. */
      all: inScope,
      /** Every non-cancelled party row, ignoring the party-type filter. */
      allTypes,
      // True when the cap was hit, i.e. the counts are a floor not a total.
      truncated: (countRows ?? []).length >= COUNT_SCAN_LIMIT,
      error: countErr?.message ?? null,
    },
  })
}
