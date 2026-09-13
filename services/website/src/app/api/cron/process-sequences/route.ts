import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cronAuth'
import { processSequences, BATCH_SIZE } from '@/lib/sequences/processor'

export const dynamic = 'force-dynamic'

/**
 * Thin. Everything that can be got wrong lives in lib/sequences/processor.ts,
 * where it can be driven without a cron, a network or a real inbox.
 *
 * `?limit=N` caps how many EMAILS one tick sends, between 1 and `BATCH_SIZE`.
 * The scan is `ORDER BY enrolled_at ASC`, so the drain is deterministic: the
 * longest-waiting enrollment that can actually be sent to goes first.
 *
 * **It used to cap rows READ, and that made it a no-op.** Measured against the
 * live table on 2026-09-13: the two oldest of the 45 active enrollments
 * (enrolled 2026-03-10) are on `Post-Booking Prep`, whose `is_active` is false,
 * so they are skipped and stay `active` forever at the top of the scan.
 * `?limit=1` therefore read one row, skipped it, changed nothing and answered
 * `200 {"scanned":1,"sent":0}` — indistinguishable from "nothing was due".
 * `?limit=2` … `?limit=5` were the same. PLAN.md and AGENTS.md both described
 * this as "the drain: one real person per tick", for 45 real people. It drained
 * nobody, and it could not have.
 *
 * It exists because of the state this route is actually in. Its cron job
 * disappeared on 2026-08-16 and **45 enrollments are frozen mid-sequence**
 * (PLAN.md, "needs Adam"); turning the schedule back on as it stands is ~34
 * emails at once, months late. `?limit=1` is the drain: one real person per
 * tick, checked in between. It can only ever make a tick do LESS work, and it
 * is behind `CRON_SECRET` like everything else here.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawLimit = req.nextUrl.searchParams.get('limit')
  let sendCap: number | undefined
  if (rawLimit !== null) {
    const n = Number(rawLimit)
    if (!Number.isFinite(n) || n < 1) {
      // Rule 10: a cap that was silently ignored is a cap the operator thinks
      // is protecting them.
      return NextResponse.json({ error: `limit must be a number of at least 1 (got "${rawLimit}")` }, { status: 400 })
    }
    sendCap = Math.min(Math.floor(n), BATCH_SIZE)
  }

  /**
   * `?scan=N` bounds how many enrollment ROWS the tick reads, which is what
   * `?limit=` used to do. It exists for one reason: it is the only way to drive
   * this route in production and be able to PROVE beforehand that no real
   * customer's enrollment was in the scan. Give a throwaway enrollment an
   * `enrolled_at` that sorts first, read the top of the scan, then fire with a
   * `scan` no larger than the number of throwaway rows.
   *
   * `?limit=` is the cap an operator wants (sends); `?scan=` is the cap a probe
   * wants (rows). They are different questions and conflating them is what made
   * the old drain a no-op.
   */
  const rawScan = req.nextUrl.searchParams.get('scan')
  let scanSize: number | undefined
  if (rawScan !== null) {
    const n = Number(rawScan)
    if (!Number.isInteger(n) || n < 1 || n > BATCH_SIZE) {
      return NextResponse.json({ error: `scan must be an integer 1..${BATCH_SIZE} (got "${rawScan}")` }, { status: 400 })
    }
    scanSize = n
  }

  try {
    // With no ?limit and no ?scan the tick behaves exactly as it did before.
    const summary = await processSequences({
      ...(sendCap ? { sendCap } : {}),
      ...(scanSize ? { batchSize: scanSize } : {}),
    })
    // Rule 10: a run that decided to do nothing and a run that could not tell
    // must not produce the same output. `deferred` and `notes` are the
    // difference, and they are in the body a cron console shows.
    console.log(
      `cron:sequences sendCap=${sendCap ?? 'none'} scan=${scanSize ?? BATCH_SIZE} scanned=${summary.scanned} sent=${summary.sent} skipped=${summary.skipped} ` +
        `claimedElsewhere=${summary.claimedElsewhere} deferred=${summary.deferred} failed=${summary.failed} ` +
        `unsubscribed=${summary.unsubscribed} completed=${summary.completed} paused=${summary.paused} ` +
        `stale=${summary.stale} capped=${summary.capped} inactiveSequence=${summary.inactiveSequence}`
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
