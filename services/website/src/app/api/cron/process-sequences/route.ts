import { NextRequest, NextResponse } from 'next/server'
import { processSequences } from '@/lib/sequences/processor'

export const dynamic = 'force-dynamic'

function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return Boolean(process.env.CRON_SECRET) && secret === process.env.CRON_SECRET
}

/**
 * Thin. Everything that can be got wrong lives in lib/sequences/processor.ts,
 * where it can be driven without a cron, a network or a real inbox.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await processSequences()
    // Rule 10: a run that decided to do nothing and a run that could not tell
    // must not produce the same output. `deferred` and `notes` are the
    // difference, and they are in the body a cron console shows.
    console.log(
      `cron:sequences scanned=${summary.scanned} sent=${summary.sent} skipped=${summary.skipped} ` +
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
