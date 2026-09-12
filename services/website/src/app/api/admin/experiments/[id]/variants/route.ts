import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { loadExperiment } from '@/lib/experiments/load'
import { generateVariants } from '@/lib/experiments/generate'
import { htmlToPlainText, safeSiteLink } from '@/lib/content/contentSafety'
import { isExcludedFromTracking } from '@/lib/experiments/track'
import { MAX_VARIANTS } from '@/lib/experiments/types'

export const dynamic = 'force-dynamic'

/**
 * `POST /api/admin/experiments/<id>/variants` — COPY writes the challengers.
 *
 * The CONTROL is the copy that is live today, read out of
 * `email_sequence_steps` and copied in unchanged (bar the screen). See the note
 * at the top of `lib/experiments/generate.ts` for why the model does not write
 * the control: a test between two things the model wrote says nothing about
 * whether the pipeline beats what Host Hampton actually sends.
 *
 * ── The step body is HTML and the variant is plain text ───────────────────
 *
 * `email_sequence_steps.body_html` is hand-written HTML. `body_text` exists but
 * is nullable, and on the live rows it mostly is null. So the control's plain
 * text comes from `htmlToPlainText` when there is no `body_text` — the SAME
 * reducer the content renderer uses, which is the one that link 7 found had a
 * different idea of "a tag" from the predicate beside it (`"Groups of <10
 * guests"` became `"Groups of"`). It is one shared implementation now, and using
 * it here rather than writing a third stripper is rule 11 doing its job.
 *
 * The rendered HTML for a variant is built by us from that plain text, so no
 * model-written markup reaches an inbox.
 */

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()
  const actor = adminActorId(req)

  const loaded = await loadExperiment(supabase, params.id)
  if (loaded.kind === 'unavailable') return NextResponse.json({ error: loaded.error }, { status: 503 })
  if (loaded.kind === 'absent') return NextResponse.json({ error: 'No such experiment' }, { status: 404 })
  const { experiment } = loaded.value

  let body: { count?: number } = {}
  try {
    body = (await req.json()) as { count?: number }
  } catch {
    // An empty body is fine — one challenger is the default.
  }
  const count = Math.max(1, Math.min(MAX_VARIANTS - 1, Number(body.count ?? 1) || 1))

  // Generating into a concluded or archived experiment is a mistake, not a
  // request. Refused rather than quietly allowed: a new arm appearing after the
  // verdict was recorded would make the recorded verdict a statement about a
  // different test.
  if (experiment.status === 'concluded' || experiment.status === 'archived') {
    return NextResponse.json(
      { error: `This experiment is ${experiment.status}. Variants can only be added while it is a draft, paused or active.` },
      { status: 422 }
    )
  }

  if (experiment.surface !== 'sequence_step') {
    return NextResponse.json(
      {
        error:
          `Variant generation is only wired for the "sequence_step" surface. ` +
          `"${experiment.surface}" has no sender in this codebase, so there is nothing to copy a control from.`,
      },
      { status: 422 }
    )
  }

  if (!experiment.target_key) {
    return NextResponse.json(
      {
        error:
          'This experiment has no target_key, so there is no single live email to use as the control. ' +
          'Set target_key to "<sequence_id>:<step_number>".',
      },
      { status: 422 }
    )
  }

  const [sequenceId, stepRaw] = experiment.target_key.split(':')
  const stepNumber = Number(stepRaw)
  if (!sequenceId || !Number.isInteger(stepNumber)) {
    return NextResponse.json(
      { error: `target_key "${experiment.target_key}" is not "<sequence_id>:<step_number>"` },
      { status: 422 }
    )
  }

  // Three outcomes (rule 12). A blip reading the step must not present as "no
  // such step", which would send somebody to check a sequence that is fine.
  const { data: step, error: stepErr } = await supabase
    .from('email_sequence_steps')
    .select('id, sequence_id, step_number, subject, body_html, body_text')
    .eq('sequence_id', sequenceId)
    .eq('step_number', stepNumber)
    .maybeSingle()

  if (stepErr) return NextResponse.json({ error: `Could not read the sequence step: ${stepErr.message}` }, { status: 503 })
  if (!step) {
    return NextResponse.json(
      { error: `No step ${stepNumber} on sequence ${sequenceId} — check the target_key.` },
      { status: 404 }
    )
  }

  const { data: seq } = await supabase
    .from('email_sequences')
    .select('name, trigger_event, description')
    .eq('id', sequenceId)
    .maybeSingle()

  const controlSubject = String(step.subject ?? '')
  const controlBody = String(step.body_text ?? '').trim() || htmlToPlainText(String(step.body_html ?? ''))

  if (!controlSubject || !controlBody) {
    return NextResponse.json(
      { error: 'The live step has no subject or no readable body, so there is no control to test against.' },
      { status: 422 }
    )
  }

  /**
   * The links the live step carries, taken from its HTML `href`s.
   *
   * `htmlToPlainText` correctly throws hrefs away, so the model is shown a
   * control body with no URL in it and has no way to reproduce one. Measured in
   * production on the first real run: the challenger came back as "Take a look
   * at the calendar." with no link, and the send reported "variant B sent with
   * NO tracked link" — an arm that can never register a click, against a control
   * whose copy is the live step and always can. The control would have won by
   * construction and the result would have read as a finding about the words.
   */
  const stepLinks = Array.from(String(step.body_html ?? '').matchAll(/\shref\s*=\s*["']([^"']+)["']/gi))
    .map(m => safeSiteLink(m[1]))
    .filter((u): u is string => !!u && !isExcludedFromTracking(u))
  const requiredLinks = Array.from(new Set(stepLinks))

  if (experiment.metric === 'clicked' && requiredLinks.length === 0) {
    return NextResponse.json(
      {
        error:
          'This experiment measures CLICKS and the live step carries no trackable Host Hampton link, ' +
          'so neither arm could ever score. Add a link to the step, or change the metric.',
      },
      { status: 422 }
    )
  }

  const audience = [
    seq?.name ? `sequence "${String(seq.name)}"` : null,
    seq?.description ? String(seq.description) : null,
    `step ${stepNumber}`,
    'the recipient has already enquired about an event at Host Hampton',
  ]
    .filter(Boolean)
    .join(' — ')

  const outcome = await generateVariants({
    supabase,
    experiment,
    control: { subject: controlSubject, bodyText: controlBody },
    audience,
    requiredLinks,
    count,
    actor,
  })

  return NextResponse.json(outcome, { status: outcome.ok ? 200 : outcome.status })
}
