/**
 * The market vendor book.
 *
 * This route exists because the last one did not. `vendor_registration` rows
 * have been written into `bookings` since the Spring Market and both admin list
 * routes explicitly filter them out (`NON_PARTY_EVENT_TYPES`), so a paid vendor
 * appeared on exactly zero screens — the ledger knew, the contact list knew,
 * and the person running the market did not.
 *
 * Auth is `isAdminAuthorized` and nothing else. There is no second shared
 * password the way the fundraiser order book has one: that existed so PTO
 * volunteers could see their own orders without Adam's credential, and there is
 * no equivalent third party here. Fewer doors, and the one door already
 * fails closed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { CHRISTMAS_MARKET_2026, resolveMarket, marketPricing } from '@/lib/christmasMarket'

export const dynamic = 'force-dynamic'

/**
 * An explicit allow-list rather than `select('*')`, the same discipline
 * `CM_CHEER_ORDER_COLUMNS` applies: a column added by a future migration stays
 * private until somebody decides it should not be.
 *
 * Everything here is Adam's own business data and he is the only reader, so the
 * list is wide — but it is a LIST, so the decision is recorded.
 */
const VENDOR_COLUMNS = [
  'id',
  'vendor_ref',
  'market_slug',
  'contact_name',
  'business_name',
  'ig_handle',
  'email',
  'phone',
  'product_category',
  'product_description',
  'needs_electricity',
  'booth_note',
  'payment_method',
  'booth_fee_cents',
  'service_fee_cents',
  'total_cents',
  'status',
  'status_note',
  'notes',
  'paid_at',
  'created_at',
].join(', ')

/**
 * The client cannot infer a row shape from a column list built at runtime, so
 * it falls back to `GenericStringError`. Only the fields this route actually
 * reasons about are declared — the rest are passed through to the caller
 * untouched and do not need to be named twice.
 */
interface VendorRow {
  status: string
  total_cents: number
  needs_electricity: boolean
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const url = new URL(req.url)
  const marketSlug = url.searchParams.get('market') || CHRISTMAS_MARKET_2026.slug
  const status = url.searchParams.get('status')

  // An unknown market is a 400, not a silent read of everything. That is the
  // shape `/api/cm-cheer-orders` uses for `team` and for the same reason: a
  // typo must not quietly widen the result set.
  const market = resolveMarket(marketSlug)
  if (!market) {
    return NextResponse.json({ error: `Unknown market "${marketSlug}"` }, { status: 400 })
  }

  const supabase = getSupabase()
  let query = supabase
    .from('market_vendors')
    .select(VENDOR_COLUMNS)
    .eq('market_slug', market.slug)
    .order('created_at', { ascending: false })
    .limit(500)

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) {
    console.error('admin market-vendors read failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as VendorRow[]

  // The counts are computed from the same rows the caller is getting, so the
  // tiles and the table can never disagree with each other.
  const paid = rows.filter(r => r.status === 'paid')
  const pending = rows.filter(r => r.status === 'pending_payment')
  const waitlist = rows.filter(r => r.status === 'waitlist')

  return NextResponse.json({
    market: {
      slug: market.slug,
      name: market.name,
      dateLabel: market.dateLabel,
      capacity: market.boothCapacity,
      // Both, because a booth no longer has one price — Venmo carries no card
      // fee. The admin screen does not currently render either (every row
      // carries the amount that vendor was actually charged, which is the
      // number that matters historically), but a caller asking "what does a
      // booth cost" must not be handed one of two answers as though it were
      // the only one.
      boothFeeCents: market.boothFeeCents,
      cardTotalCents: marketPricing(market, 'card').totalCents,
      venmoTotalCents: marketPricing(market, 'venmo').totalCents,
    },
    vendors: rows,
    stats: {
      paid: paid.length,
      pending: pending.length,
      waitlist: waitlist.length,
      // Only money that actually landed. A `pending_payment` row is a vendor who
      // started, not revenue — counting it here is how a dashboard starts lying.
      // No `|| 0` fallback: `total_cents` is NOT NULL with a CHECK that it
      // equals booth + fee, so a zero here would be a real zero and coalescing
      // would only hide a column that had stopped being selected. That idiom is
      // banned on the admin surface (rule R9) because it is how an unpriced
      // booking silently read as $0 owing.
      collectedCents: paid.reduce((s, r) => s + r.total_cents, 0),
      boothsLeft: Math.max(0, market.boothCapacity - paid.length - pending.length),
      needElectricity: paid.filter(r => r.needs_electricity).length,
    },
  })
}
