import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isCmCheerAuthorized, cmCheerUnauthorized, CM_CHEER_ORDER_COLUMNS } from '@/lib/cmCheerAuth'

export const dynamic = 'force-dynamic'

/**
 * The CM Cheer / LI High order book.
 *
 * Auth: `lib/cmCheerAuth.ts` — one definition, fail-closed. This route used to
 * hold its own copy with a literal default password, and `CM_CHEER_PASSWORD` was
 * unset in production, so that literal WAS the credential over 21 real customers'
 * contact details. See the note in that module.
 *
 * Columns are an ALLOW-list rather than `select('*')`: the table's `cost_cents`
 * and `profit_cents` are Host Hampton's own margin, not the order book's business,
 * and a column added by the next migration is private until somebody decides
 * otherwise (the rule `/api/portal/booking` and `/api/checkin/[token]` follow).
 */
export async function GET(req: NextRequest) {
  if (!isCmCheerAuthorized(req)) return cmCheerUnauthorized()

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const paymentMethod = searchParams.get('payment_method')

  const supabase = getSupabase()
  let query = supabase
    .from('cm_cheer_orders')
    .select(CM_CHEER_ORDER_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(500)

  if (status) query = query.eq('status', status)
  if (paymentMethod) query = query.eq('payment_method', paymentMethod)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ orders: data || [] })
}
