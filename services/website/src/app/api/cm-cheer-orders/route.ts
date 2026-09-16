import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isCmCheerAuthorized, cmCheerUnauthorized, CM_CHEER_ORDER_COLUMNS } from '@/lib/cmCheerAuth'
import { isFundraiserTeamSlug } from '@/lib/fundraiserTeams'

export const dynamic = 'force-dynamic'

/**
 * The CM Cheer / LI High order book.
 *
 * Auth: `lib/cmCheerAuth.ts` — one definition, fail-closed. This route used to
 * hold its own copy with a literal default password, and `CM_CHEER_PASSWORD` was
 * unset in production, so that literal WAS the credential over 21 real customers'
 * contact details. See the note in that module.
 *
 * Columns are an ALLOW-list rather than `select('*')`: a column added by the next
 * migration is private until somebody decides otherwise (the rule
 * `/api/portal/booking` and `/api/checkin/[token]` follow). `cost_cents` is still
 * withheld. `profit_cents` was too, as "Host Hampton's margin" — until Adam
 * pointed out that on a fundraiser it is the opposite: it is what the SCHOOL
 * nets after paying us. It is published now; see the note in `lib/cmCheerAuth.ts`.
 */
export async function GET(req: NextRequest) {
  if (!isCmCheerAuthorized(req)) return cmCheerUnauthorized()

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const paymentMethod = searchParams.get('payment_method')
  const team = searchParams.get('team')

  /**
   * `?team=` is how each organizer dashboard sees only its own fundraiser.
   *
   * An UNKNOWN team is refused rather than ignored, because a filter that is
   * silently dropped returns EVERY team's orders — which is the precise failure
   * this parameter exists to prevent, arriving as a success. A CM Cheer parent
   * volunteer mistyping the URL must not be handed the Sharks' customer list.
   *
   * Omitting it entirely still returns everything: that is Adam's own
   * cross-fundraiser view, and it is the behaviour this route had before there
   * was more than one team.
   */
  if (team !== null && !isFundraiserTeamSlug(team)) {
    return NextResponse.json({ error: 'Unknown fundraiser' }, { status: 400 })
  }

  const supabase = getSupabase()
  let query = supabase
    .from('cm_cheer_orders')
    .select(CM_CHEER_ORDER_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(500)

  if (team) query = query.eq('team', team)
  if (status) query = query.eq('status', status)
  if (paymentMethod) query = query.eq('payment_method', paymentMethod)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ orders: data || [] })
}
