import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cronAuth'
import { getSupabase } from '@/lib/supabase'
import { crewEnabled, crewTestLoginEnabled, loadCrewSettings } from '@/lib/crew/settings'
import { reconcileCrewParties } from '@/lib/crew/sync'
import { runCrewJobs } from '@/lib/crew/jobs'

export const dynamic = 'force-dynamic'

/**
 * Crew scheduling's tick (spec §7). Every 5 minutes from the box crontab
 * (`scripts/cron/jobs.tsv`, row `crew`).
 *
 * 1. The booking reconcile ALWAYS runs, so Allie's schedule stays current
 *    before launch (spec §9).
 * 2. Everything else — confirmations, cover requests, alerts, reminders, the
 *    queue — runs only when CREW_ENABLED is exactly `true`. Otherwise the answer
 *    is `{ ok: true, skipped: 'disabled' }` and nothing is sent.
 *
 *    The one exception is `?scope=test`, honoured only while CREW_ENABLED is
 *    OFF and CREW_TEST_LOGIN is ON: the jobs run against TEST parties and test
 *    members only (invented people on the business inbox, no phones). That is
 *    how the send path is proven in production before anybody real is in it.
 *
 * The answer is COUNTS, never a list of people or booking refs. A failure to
 * read the settings is a 503; a job that could not read what it needed is a
 * 200 with `ok: false` and the job's NAME, which the watchdog
 * (`scripts/cron/hh-cron-watch.sh`) treats as a break.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const sb = getSupabase()
    const now = new Date()
    const settings = await loadCrewSettings(sb)
    if (settings.kind !== 'ok') {
      console.error(`cron/crew: crew_settings unreadable: ${settings.error}`)
      return NextResponse.json({ ok: false, error: 'crew settings unavailable' }, { status: 503 })
    }

    const rec = await reconcileCrewParties({ now, supabase: sb, settings: settings.settings })
    const reconcile = rec.kind === 'ok'
      ? {
          ok: rec.summary.errors.length === 0,
          created: rec.summary.created, updated: rec.summary.updated, cancelled: rec.summary.cancelled,
          spotsAdded: rec.summary.spotsAdded, notificationsQueued: rec.summary.notificationsQueued,
          raced: rec.summary.raced, errors: rec.summary.errors.length,
          needsTime: rec.summary.needsTime.length,
        }
      : { ok: false, unavailable: true }
    if (rec.kind === 'ok' && rec.summary.errors.length > 0) {
      console.error(`cron/crew: reconcile finished with ${rec.summary.errors.length} error(s)`)
    }

    const testScope = req.nextUrl.searchParams.get('scope') === 'test'
    if (!crewEnabled() && !(testScope && crewTestLoginEnabled())) {
      return NextResponse.json({ ok: reconcile.ok, skipped: 'disabled', reconcile })
    }

    const scope = crewEnabled() ? 'all' : 'test'
    const jobs = await runCrewJobs({ sb, now, settings: settings.settings, scope })
    return NextResponse.json({ scope, reconcile, ...jobs, ok: reconcile.ok && jobs.ok })
  } catch (e) {
    // Never echo the message: it can carry a row's content.
    console.error(`cron/crew: tick threw: ${e instanceof Error ? e.name : 'error'}`)
    return NextResponse.json({ ok: false, error: 'tick failed' }, { status: 500 })
  }
}
