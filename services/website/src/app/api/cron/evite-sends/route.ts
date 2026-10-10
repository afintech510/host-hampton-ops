import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cronAuth'
import { getSupabase } from '@/lib/supabase'
import { runEviteSendsTick } from '@/lib/evites/cronTick'

export const dynamic = 'force-dynamic'

/**
 * The evite scheduler (spec §9.3): backfill, go-live, calendar changes, renders, the retry of failed sends,
 * the lead preview, "your invitation is ready", the guest reminders, the parent's headcount, the
 * cancellation notice and retention. Every 15 minutes from the box crontab (NOT scheduled yet).
 *
 * All of it is in `lib/evites/cronTick.ts`. This file is the door: the one credential check
 * (`isCronAuthorized`, fail-closed) and the answer.
 *
 * THE ANSWER IS COUNTS, never a customer list (AGENTS.md: "a cron response is not a place to put a customer
 * list"): no name, address, slug or booking ref. A tick that hit an error answers 500 so a scheduler shows
 * red, but only for a failure of the scan itself; a partial failure is a 200 with `ok:false` and the names
 * of the steps that failed.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const report = await runEviteSendsTick(getSupabase())
    return NextResponse.json(report, { status: report.scan.unavailable ? 503 : 200 })
  } catch (e) {
    // Never echo the message: it can carry a row's content.
    console.error(`evite-sends: tick threw: ${e instanceof Error ? e.name : 'error'}`)
    return NextResponse.json({ ok: false, error: 'tick failed' }, { status: 500 })
  }
}
