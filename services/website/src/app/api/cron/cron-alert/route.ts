import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cronAuth'
import { notifyOwnerSms } from '@/lib/ownerNotify'

export const dynamic = 'force-dynamic'

/**
 * The mouth of the cron watchdog (`scripts/cron/hh-cron-watch.sh`).
 *
 * The watchdog runs on the box, reads the log every scheduled job writes, and
 * decides whether a job has failed or gone quiet. It cannot text anybody itself
 * — the SMS credentials live in this app — so it calls here with a short
 * message and this texts the owner (`REVIEWER_PHONES`).
 *
 * Why this exists: from July to October 2026 two jobs answered 401 on every run
 * and then stopped being called at all, and the first sign was a finished event
 * still on /events. Nothing counted and said. Owner-only; never customer-facing.
 *
 * It answers 502 when no text was accepted, so the watchdog keeps the alert
 * unrecorded and tries again on its next pass rather than believing it spoke.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const raw = req.nextUrl.searchParams.get('msg') ?? ''
  const msg = raw.replace(/[\r\n]+/g, ' ').trim().slice(0, 300)
  if (!msg) {
    return NextResponse.json({ error: 'msg is required' }, { status: 400 })
  }

  const delivered = await notifyOwnerSms(`HH cron: ${msg}`)
  if (delivered === 0) {
    console.error('cron:cron-alert — no owner text was accepted for:', msg)
    return NextResponse.json({ ok: false, delivered: 0 }, { status: 502 })
  }
  return NextResponse.json({ ok: true, delivered })
}
