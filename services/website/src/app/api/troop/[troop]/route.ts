/**
 * GET /api/troop/[troop] — the family board (/troop2514), as anyone holding the
 * link sees it: announcements, upcoming meetings, which snack dates are taken and
 * by whom, the welcome line and the leaders' names.
 *
 * Public because the page is: Allie shares the link with the troop and nothing on
 * the site links to it. So what this returns is the line — never the inbox, never
 * the leaders' email addresses, never a scout's name (`publicSnack`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, MINUTE_MS } from '@/lib/rateLimit'
import {
  troopConfig,
  troopToday,
  publicSnack,
  POST_COLUMNS,
  SCHEDULE_COLUMNS,
  SNACK_COLUMNS,
  type PublicSnack,
  type TroopSnackClaim,
} from '@/lib/troop'

export const dynamic = 'force-dynamic'

const boardRule = { route: 'troop-board', perCaller: 60, perRoute: 1500, windowMs: 10 * MINUTE_MS }

export async function GET(req: NextRequest, { params }: { params: { troop: string } }) {
  const limited = guardRate(req, boardRule)
  if (limited) return limited

  const cfg = troopConfig(params.troop)
  if (!cfg) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const supabase = getSupabase()
  const [posts, sched, snacks, settings] = await Promise.all([
    supabase.from('troop_posts').select(POST_COLUMNS).eq('troop', cfg.number).order('post_date', { ascending: false }).limit(50),
    supabase
      .from('troop_schedule')
      .select(SCHEDULE_COLUMNS)
      .eq('troop', cfg.number)
      .gte('event_date', troopToday())
      .order('event_date', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(60),
    supabase.from('troop_snack_claims').select(SNACK_COLUMNS).eq('troop', cfg.number),
    supabase.from('troop_settings').select('welcome, leader_names').eq('troop', cfg.number).maybeSingle(),
  ])

  const failed = [posts, sched, snacks, settings].find(r => r.error)
  if (failed) {
    console.error('troop board: read failed —', failed.error?.code, failed.error?.message)
    return NextResponse.json({ error: "Couldn't load the troop page. Please try again." }, { status: 503 })
  }

  const taken: Record<string, PublicSnack> = {}
  for (const c of (snacks.data ?? []) as TroopSnackClaim[]) taken[c.schedule_id] = publicSnack(c)

  return NextResponse.json(
    {
      troop: cfg.number,
      name: cfg.name,
      welcome: settings.data?.welcome || cfg.welcome,
      leaders: settings.data?.leader_names ?? [],
      posts: posts.data ?? [],
      schedule: sched.data ?? [],
      snacks: taken,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
