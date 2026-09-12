import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { generateWeek } from '@/lib/social/calendar'

export const dynamic = 'force-dynamic'

function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return Boolean(process.env.CRON_SECRET) && secret === process.env.CRON_SECRET
}

/**
 * Weekly social content calendar. Drafts only — `social_posts.status` takes its
 * column default of `draft`, and `approved`/`published` are GATED edges in
 * lib/marketing/graph.ts requiring an authenticated admin. This route cannot
 * publish anything anywhere and has no credentials to do so if it wanted to.
 *
 * Self-throttling: it asks which of the coming week's slots already hold a live
 * draft BEFORE calling the model, so a duplicate cron delivery costs nothing,
 * and the partial unique index on (scheduled_for, platform) is the backstop if
 * two ticks race past that read.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabase()

  try {
    const outcome = await generateWeek(supabase, { actor: 'SOC' })
    console.log(
      `cron:social-calendar ok=${outcome.ok} weekOf=${outcome.weekOf ?? '-'} slots=${outcome.slots ?? 0} ` +
        `inserted=${outcome.inserted ?? 0} alreadyDrafted=${outcome.alreadyDrafted ?? 0} ` +
        `refused=${outcome.refused?.length ?? 0} cost=$${(outcome.costUsd ?? 0).toFixed(4)}`
    )
    for (const r of outcome.refused ?? []) console.warn(`cron:social-calendar refused ${r.date}: ${r.reason}`)
    return NextResponse.json(outcome, { status: outcome.status })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('cron:social-calendar failed:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
