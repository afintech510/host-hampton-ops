import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { loadExperiment } from '@/lib/experiments/load'
import { analyseExperiment, outcomeLabel, summarise, droppedArmsNote, type AnalysisResult } from '@/lib/experiments/analysis'
import { writeLedger } from '@/lib/marketing/graph'
import { CONVERSION_WINDOW_DAYS, EXPERIMENT_ENTITY } from '@/lib/experiments/types'

export const dynamic = 'force-dynamic'

/**
 * INTEL's weekly run (Phase 5, migration 045).
 *
 * Reads every live experiment, attributes any outstanding conversions inside
 * the stated window, and RECORDS what it found — including, and especially,
 * when what it found is "not enough data".
 *
 * ── It concludes nothing and changes no copy ───────────────────────────────
 *
 * This route writes `marketing_ledger` rows and `variant_events` conversion
 * rows. It does **not** set `content_experiments.outcome`, does not move a
 * status, and does not touch a single `email_sequence_steps` row. Concluding an
 * experiment is a human pressing a button in the panel — because a conclusion is
 * a sentence somebody will repeat, and a cron job that starts declaring winners
 * every Monday is how an A/B programme turns noise into standing rules
 * (hard-won rule 15).
 *
 * ── Three different outputs for three different situations (rule 10) ───────
 *
 *   no live experiments   → 200, `experiments: 0`, and a ledger row. A run that
 *                           did nothing must not look like a run that never
 *                           fired.
 *   a read failed         → the route answers **503**, so cron-job.org shows a
 *                           red run. Collapsed into a zero it would show a
 *                           green run every Monday while the measurement was
 *                           dead — which is exactly what §23 designed the
 *                           distiller's 503 to avoid.
 *   analysed              → 200 with a verdict per experiment.
 *
 * It costs nothing. There is no model call in this route at all: the analysis is
 * arithmetic, so there is no budget to check and none is checked. A report that
 * asked an LLM what the numbers mean would be a model opining on a p-value it
 * cannot compute.
 */

function isCronAuthorized(req: NextRequest): boolean {
  // The same `!!CRON_SECRET` guard the other cron routes carry: without it an
  // unset secret makes the route world-callable to anyone sending no header.
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET
}

const LIVE_STATUSES = ['active', 'paused']

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabase()
  const actor = 'INTEL'

  const { data, error } = await supabase
    .from('content_experiments')
    .select('id, name, status')
    .in('status', LIVE_STATUSES)
    .order('created_at', { ascending: true })
    .limit(25)

  if (error) {
    // Rule 12. A failed read is not "no experiments".
    return NextResponse.json(
      { ok: false, error: `Could not read content_experiments: ${error.message}` },
      { status: 503 }
    )
  }

  const rows = (data ?? []) as Record<string, unknown>[]

  if (rows.length === 0) {
    await writeLedger(supabase, {
      entityType: EXPERIMENT_ENTITY,
      action: 'note',
      actor,
      meta: { job: 'experiment_report', experiments: 0, outcome: 'no live experiments' },
    })
    return NextResponse.json({
      ok: true,
      experiments: 0,
      message: 'no active or paused experiments',
      conversionWindowDays: CONVERSION_WINDOW_DAYS,
      results: [],
    })
  }

  const results: {
    id: string
    name: string
    outcome: string | null
    kind: AnalysisResult['kind']
    summary: string
    unattributed?: number
    /**
     * Arms the READ-TIME screen dropped.
     *
     * This is the only SCHEDULED reader of an experiment, and it could not say
     * this. Measured in production on 2026-09-12: a hostile arm C was dropped,
     * its nine clicks were held out, and the weekly report said
     * `winner: "Arm B beat the control"` with no mention that a third of the
     * click volume belonged to an arm nobody could see. The admin panel showed
     * it — but the panel needs a human to open it, and §24's whole lesson is a
     * correct screen whose finding nobody was shown.
     */
    rejectedVariants?: { label: string; reason: string }[]
  }[] = []
  const failures: string[] = []

  for (const row of rows) {
    const id = String(row.id)
    const name = String(row.name ?? id)

    const loaded = await loadExperiment(supabase, id)
    if (loaded.kind === 'unavailable') {
      failures.push(`${name}: ${loaded.error}`)
      results.push({ id, name, outcome: 'unavailable', kind: 'unavailable', summary: loaded.error })
      continue
    }
    if (loaded.kind === 'absent') {
      // It was in the list a moment ago. Reported rather than skipped.
      failures.push(`${name}: disappeared between the list and the read`)
      results.push({ id, name, outcome: 'unavailable', kind: 'unavailable', summary: 'row disappeared mid-run' })
      continue
    }

    // `attribute` at its default: this is the run that is allowed to attribute
    // conversions, because it is the only one that runs on a schedule.
    const analysis = await analyseExperiment(supabase, loaded.value)
    if (analysis.kind === 'unavailable') failures.push(`${name}: ${analysis.error}`)

    const rejected = loaded.value.rejected.map(r => ({ label: r.label, reason: r.reason }))
    // Rule 10, in the sentence and not only in the payload: a run that dropped
    // an arm says so where the arm's absence would otherwise read as a verdict.
    // One definition of that sentence, in `analysis.ts` (rule 11).
    const droppedNote = droppedArmsNote(rejected)

    results.push({
      id,
      name,
      outcome: outcomeLabel(analysis),
      kind: analysis.kind,
      summary: summarise(analysis) + droppedNote,
      unattributed: 'unattributed' in analysis ? analysis.unattributed : undefined,
      rejectedVariants: rejected.length ? rejected : undefined,
    })

    await writeLedger(supabase, {
      entityType: EXPERIMENT_ENTITY,
      entityId: id,
      action: 'note',
      actor,
      meta: {
        job: 'experiment_report',
        name,
        kind: analysis.kind,
        outcome: outcomeLabel(analysis),
        summary: (summarise(analysis) + droppedNote).slice(0, 1000),
        arms: 'arms' in analysis ? analysis.arms : null,
        rejected_variants: rejected.length ? rejected : null,
        unattributed: 'unattributed' in analysis ? analysis.unattributed : null,
        conversion_window_days: CONVERSION_WINDOW_DAYS,
      },
    })

    console.log(`cron:experiment-report "${name}" → ${analysis.kind}: ${summarise(analysis)}${droppedNote}`)
  }

  // If EVERY experiment failed to read, this run measured nothing and must say
  // so with a red status. A partial failure stays 200 and names the failures:
  // the experiments that did analyse produced real verdicts and hiding them
  // behind a 503 would lose them.
  const allFailed = results.length > 0 && results.every(r => r.kind === 'unavailable')

  return NextResponse.json(
    {
      ok: !allFailed,
      experiments: rows.length,
      conversionWindowDays: CONVERSION_WINDOW_DAYS,
      results,
      failures,
      applied: false,
      appliedNote:
        'Nothing was concluded and no copy was changed. Concluding an experiment is a human action in the admin panel.',
    },
    { status: allFailed ? 503 : 200 }
  )
}
