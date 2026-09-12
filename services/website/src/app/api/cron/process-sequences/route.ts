import { NextRequest, NextResponse } from 'next/server'
import { processSequences, BATCH_SIZE } from '@/lib/sequences/processor'

export const dynamic = 'force-dynamic'

function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return Boolean(process.env.CRON_SECRET) && secret === process.env.CRON_SECRET
}

/**
 * Thin. Everything that can be got wrong lives in lib/sequences/processor.ts,
 * where it can be driven without a cron, a network or a real inbox.
 *
 * `?limit=N` caps how many enrollments one tick processes, between 1 and
 * `BATCH_SIZE`. The scan is `ORDER BY enrolled_at ASC`, so the cap is
 * deterministic — the same N enrollments every time, oldest first — which is
 * what makes it useful rather than a lottery.
 *
 * It exists because of the state this route is actually in. Its cron job
 * disappeared on 2026-08-16 and **44 enrollments are frozen mid-sequence**
 * (PLAN.md, "needs Adam"); turning the schedule back on as it stands mails all
 * 44 at once, months late. `?limit=1` is the drain: one real person per tick,
 * checked in between. It can only ever make a tick do LESS work, and it is
 * behind `CRON_SECRET` like everything else here.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawLimit = req.nextUrl.searchParams.get('limit')
  let batchSize: number | undefined
  if (rawLimit !== null) {
    const n = Number(rawLimit)
    if (!Number.isFinite(n) || n < 1) {
      // Rule 10: a cap that was silently ignored is a cap the operator thinks
      // is protecting them.
      return NextResponse.json({ error: `limit must be a number of at least 1 (got "${rawLimit}")` }, { status: 400 })
    }
    batchSize = Math.min(Math.floor(n), BATCH_SIZE)
  }

  try {
    const summary = await processSequences(batchSize ? { batchSize } : {})
    // Rule 10: a run that decided to do nothing and a run that could not tell
    // must not produce the same output. `deferred` and `notes` are the
    // difference, and they are in the body a cron console shows.
    console.log(
      `cron:sequences limit=${batchSize ?? BATCH_SIZE} scanned=${summary.scanned} sent=${summary.sent} skipped=${summary.skipped} ` +
        `claimedElsewhere=${summary.claimedElsewhere} deferred=${summary.deferred} failed=${summary.failed} ` +
        `unsubscribed=${summary.unsubscribed} completed=${summary.completed} paused=${summary.paused}`
    )
    for (const n of summary.notes) console.log(`cron:sequences note — ${n}`)
    return NextResponse.json(summary)
  } catch (err) {
    // A failed read of the enrollment list is a 500, not a green `processed: 0`.
    // A weekly-green cron console over a dead job is exactly the silence rule 10
    // exists to prevent (plan §23).
    const message = err instanceof Error ? err.message : String(err)
    console.error('cron:sequences failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
