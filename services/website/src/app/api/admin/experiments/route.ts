import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { advance, writeLedger, IllegalTransitionError, TransitionNotAuthorizedError } from '@/lib/marketing/graph'
import { loadExperiment } from '@/lib/experiments/load'
import { analyseExperiment, outcomeLabel, summarise } from '@/lib/experiments/analysis'
import { flattenToOneLine } from '@/lib/agent/extractPlanFields'
import {
  EXPERIMENT_METRICS,
  EXPERIMENT_SURFACES,
  WIRED_SURFACES,
  DEFAULT_MIN_PER_ARM,
  DEFAULT_ALPHA,
  CONVERSION_WINDOW_DAYS,
  isExperimentMetric,
  isExperimentSurface,
  EXPERIMENT_ENTITY,
} from '@/lib/experiments/types'

export const dynamic = 'force-dynamic'

/**
 * The A/B experiment surface in the admin panel (Phase 5, migration 045).
 *
 * GET  → every experiment, with the ANALYSIS of each one and the unattributed
 *        signals nobody has looked at.
 * POST → create; transition (draft → active is GATED); conclude.
 *
 * ── What this route is the gate for ────────────────────────────────────────
 *
 * `content_experiments.status = 'active'` is the only thing that makes a
 * sender substitute model-written copy into mail a real customer receives, and
 * `advance()` refuses that edge without `actor.isAdmin`. Same shape, same
 * reasoning and the same choke point as `approved`/`sent` on an inquiry draft
 * and `published` on website content.
 *
 * ── What it deliberately does NOT do ──────────────────────────────────────
 *
 * **Apply a winner.** `conclude` writes the verdict, the winning variant id and
 * the note; it changes no `email_sequence_steps` row, no live copy and nothing a
 * customer would see. A pipeline that promoted its own winner into the live step
 * would be the whole chain from "a model wrote this" to "a customer received
 * this" with no human in it — which is exactly what `agent_learnings.is_active`
 * defaulting FALSE exists to prevent, one surface over. The winner is a
 * sentence Allie reads.
 *
 * **Send anything.** There is no send path in this file at all.
 */

const EXPERIMENT_COLS =
  'id, name, surface, target_key, metric, min_per_arm, alpha, hypothesis, status, outcome, outcome_note, winning_variant, concluded_at, created_by, activated_by, activated_at, created_at'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()

  const [list, unattributed] = await Promise.all([
    supabase.from('content_experiments').select(EXPERIMENT_COLS).order('created_at', { ascending: false }).limit(50),
    supabase
      .from('unattributed_signals')
      .select('id, kind, reason, meta, created_at')
      .order('created_at', { ascending: false })
      .limit(25),
  ])

  // Reported, not swallowed. A missing migration 045 must read as a message,
  // not as an empty list — an empty list looks exactly like "no experiments
  // yet", which is the absence-reads-like-a-fact shape this project has paid
  // for three times.
  const errors = [
    list.error ? `experiments: ${list.error.message}` : null,
    unattributed.error ? `unattributed signals: ${unattributed.error.message}` : null,
  ].filter(Boolean)

  /**
   * The analysis is run per experiment with `attribute: false`, so OPENING the
   * panel never writes a conversion row. Reading a page must not change the
   * numbers the page is showing (rule 6's converse).
   */
  const analysed: Record<string, unknown>[] = []
  for (const row of (list.data ?? []) as Record<string, unknown>[]) {
    const loaded = await loadExperiment(supabase, String(row.id))
    if (loaded.kind !== 'found') {
      analysed.push({
        ...row,
        variants: [],
        rejectedVariants: [],
        analysis: { kind: loaded.kind === 'unavailable' ? 'unavailable' : 'unconfigured', note: loaded.kind === 'unavailable' ? loaded.error : 'the experiment row could not be loaded' },
      })
      continue
    }
    const analysis = await analyseExperiment(supabase, loaded.value, { attribute: false })
    analysed.push({
      ...row,
      variants: loaded.value.variants.map(v => ({
        id: v.id,
        label: v.label,
        is_control: v.is_control,
        subject: v.subject,
        body_text: v.body_text,
        screen_notes: v.screen_notes,
        created_by: v.created_by,
      })),
      /** Rule 10: a read-time screen that dropped an arm has to say so. */
      rejectedVariants: loaded.value.rejected,
      analysis: { ...analysis, summary: summarise(analysis) },
    })
  }

  return NextResponse.json({
    surfaces: EXPERIMENT_SURFACES,
    wiredSurfaces: WIRED_SURFACES,
    metrics: EXPERIMENT_METRICS,
    defaults: { minPerArm: DEFAULT_MIN_PER_ARM, alpha: DEFAULT_ALPHA, conversionWindowDays: CONVERSION_WINDOW_DAYS },
    experiments: analysed,
    unattributedSignals: unattributed.data ?? [],
    errors,
  })
}

interface Body {
  action: 'create' | 'transition' | 'conclude'
  id?: string
  to?: string
  name?: string
  surface?: string
  targetKey?: string | null
  metric?: string
  minPerArm?: number
  alpha?: number
  hypothesis?: string | null
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()
  const actor = adminActorId(req)

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body?.action) return NextResponse.json({ error: 'action is required' }, { status: 400 })

  /* ── create ────────────────────────────────────────────────────────────── */
  if (body.action === 'create') {
    const name = flattenToOneLine(String(body.name ?? '')).slice(0, 120)
    if (name.length < 4) return NextResponse.json({ error: 'name must be at least 4 characters' }, { status: 400 })
    if (!isExperimentSurface(body.surface)) {
      return NextResponse.json({ error: `surface must be one of ${EXPERIMENT_SURFACES.join(', ')}` }, { status: 400 })
    }
    const metric = body.metric ?? 'clicked'
    if (!isExperimentMetric(metric)) {
      return NextResponse.json({ error: `metric must be one of ${EXPERIMENT_METRICS.join(', ')}` }, { status: 400 })
    }

    // Bounded and validated rather than clamped silently: `min_per_arm: 1` is a
    // request to turn the refusal off, and answering 400 says so. Clamping it to
    // 2 would have granted a weaker test than the caller asked for and told
    // nobody.
    const minPerArm = body.minPerArm == null ? DEFAULT_MIN_PER_ARM : Number(body.minPerArm)
    if (!Number.isInteger(minPerArm) || minPerArm < 2 || minPerArm > 100000) {
      return NextResponse.json({ error: 'minPerArm must be an integer of at least 2' }, { status: 400 })
    }
    const alpha = body.alpha == null ? DEFAULT_ALPHA : Number(body.alpha)
    if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 0.2) {
      return NextResponse.json({ error: 'alpha must be greater than 0 and at most 0.2' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('content_experiments')
      .insert({
        name,
        surface: body.surface,
        target_key: body.targetKey ? flattenToOneLine(String(body.targetKey)).slice(0, 200) : null,
        metric,
        min_per_arm: minPerArm,
        alpha,
        hypothesis: body.hypothesis ? flattenToOneLine(String(body.hypothesis)).slice(0, 1000) : null,
        // NOT set: `status` takes the column DEFAULT of 'draft'. The safe value
        // is the default so a writer that forgets fails safe.
        created_by: actor,
      })
      .select('id, name, status')
      .single()

    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json(
          { error: `An experiment called "${name}" already exists — open that one rather than making a rival.` },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await writeLedger(supabase, {
      entityType: EXPERIMENT_ENTITY,
      entityId: String(data.id),
      action: 'note',
      actor,
      meta: { job: 'experiment_created', name, surface: body.surface, metric, min_per_arm: minPerArm, alpha },
    })

    return NextResponse.json({
      ok: true,
      id: String(data.id),
      status: String(data.status),
      note:
        WIRED_SURFACES.includes(body.surface)
          ? 'Created as a DRAFT. Generate the variants, then activate it — activation is what makes it live.'
          : `Created as a DRAFT. Note that no sender in this codebase reads the "${body.surface}" surface yet, so activating it will change nothing.`,
    })
  }

  /* ── transition ────────────────────────────────────────────────────────── */
  if (body.action === 'transition') {
    if (!body.id || !body.to) return NextResponse.json({ error: 'id and to are required' }, { status: 400 })

    // Activating a test with fewer than two usable arms would substitute copy
    // with nothing to compare it against. Checked here rather than in the graph,
    // because the graph is about legality and this is about the experiment
    // making sense.
    if (body.to === 'active') {
      const loaded = await loadExperiment(supabase, body.id)
      if (loaded.kind === 'unavailable') return NextResponse.json({ error: loaded.error }, { status: 503 })
      if (loaded.kind === 'absent') return NextResponse.json({ error: 'No such experiment' }, { status: 404 })
      const { variants, rejected } = loaded.value
      if (variants.length < 2) {
        return NextResponse.json(
          {
            error:
              `Refused to activate: this experiment has ${variants.length} usable variant(s) and needs at least two.` +
              (rejected.length
                ? ` The read-time screen dropped: ${rejected.map(r => `${r.label} — ${r.reason}`).join('; ')}`
                : ''),
          },
          { status: 422 }
        )
      }
      if (!variants.some(v => v.is_control)) {
        return NextResponse.json(
          { error: 'Refused to activate: no variant is marked as the control, so a result could not be compared against anything.' },
          { status: 422 }
        )
      }
    }

    try {
      const res = await advance({
        supabase,
        entity: EXPERIMENT_ENTITY,
        id: body.id,
        to: body.to,
        actor: { id: actor, isAdmin: true },
        patch:
          body.to === 'active'
            ? { activated_by: actor, activated_at: new Date().toISOString(), updated_at: new Date().toISOString() }
            : { updated_at: new Date().toISOString() },
        meta: { via: 'admin_experiments' },
      })
      return NextResponse.json({ ok: true, id: body.id, from: res.from, to: res.to })
    } catch (err) {
      if (err instanceof IllegalTransitionError) return NextResponse.json({ error: err.message }, { status: 422 })
      if (err instanceof TransitionNotAuthorizedError) return NextResponse.json({ error: err.message }, { status: 403 })
      return NextResponse.json({ error: err instanceof Error ? err.message : 'transition failed' }, { status: 500 })
    }
  }

  /* ── conclude ──────────────────────────────────────────────────────────── */
  if (body.action === 'conclude') {
    if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const loaded = await loadExperiment(supabase, body.id)
    if (loaded.kind === 'unavailable') return NextResponse.json({ error: loaded.error }, { status: 503 })
    if (loaded.kind === 'absent') return NextResponse.json({ error: 'No such experiment' }, { status: 404 })

    // `attribute` left at its default: concluding is the moment to attribute
    // outstanding conversions, because it is the last reading that will matter.
    const analysis = await analyseExperiment(supabase, loaded.value)

    // A read failure does NOT get written as a conclusion. Recording
    // `not_enough_data` over an unreadable table would be the pipeline stating a
    // result it does not have — rule 10's expensive half, which is what
    // `send-reminders` did six different ways.
    if (analysis.kind === 'unavailable') {
      return NextResponse.json({ error: `Refused to conclude: ${analysis.error}` }, { status: 503 })
    }

    const label = outcomeLabel(analysis)
    const note = summarise(analysis)

    const { error } = await supabase
      .from('content_experiments')
      .update({
        outcome: label,
        outcome_note: note.slice(0, 2000),
        winning_variant: analysis.kind === 'winner' ? analysis.winner.variantId : null,
        concluded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeLedger(supabase, {
      entityType: EXPERIMENT_ENTITY,
      entityId: body.id,
      action: 'note',
      actor,
      meta: { job: 'experiment_concluded', outcome: label, note: note.slice(0, 1000), analysis },
    })

    // The status move is separate and NOT forced: an experiment can be read
    // without being closed, and `concluded` is one-way (there is no edge back).
    let statusMoved = false
    if (loaded.value.experiment.status === 'active' || loaded.value.experiment.status === 'paused') {
      try {
        await advance({
          supabase,
          entity: EXPERIMENT_ENTITY,
          id: body.id,
          to: 'concluded',
          actor: { id: actor, isAdmin: true },
          meta: { via: 'admin_experiments', outcome: label },
        })
        statusMoved = true
      } catch (err) {
        console.error('experiments: conclusion recorded but status move failed:', err)
      }
    }

    return NextResponse.json({
      ok: true,
      id: body.id,
      outcome: label,
      note,
      statusMoved,
      analysis,
      /** Said every time, so nobody reads a winner as a change. */
      applied: false,
      appliedNote:
        'Nothing was changed. A winner here is a proposal: updating the live copy is a deliberate edit to the sequence step.',
    })
  }

  return NextResponse.json({ error: `Unknown action "${String(body.action)}"` }, { status: 400 })
}
