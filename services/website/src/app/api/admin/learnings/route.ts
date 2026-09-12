import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import {
  proposeLearning,
  setLearningActive,
  loadActiveLearnings,
  learningsPromptAddendum,
  LEARNING_KINDS,
  MAX_LEARNING_CHARS,
} from '@/lib/agent/learnings'
import { activateVoiceProfile } from '@/lib/agent/voice'
import { writeLedger } from '@/lib/marketing/graph'
import { DISTILL_ENTITY } from '@/lib/agent/distill'

export const dynamic = 'force-dynamic'

/**
 * The learned-rules surface in the admin Inbox (Phase 6).
 *
 * GET  → every learning, the recent voice profiles, and the last distill run.
 * POST → add a rule by hand, or activate / retire one.
 *
 * ── This route is the gate ────────────────────────────────────────────────
 *
 * `agent_learnings.is_active` is the only thing that puts a sentence into the
 * draft prompt's TRUSTED section, and this is the only code that sets it true.
 * Everything else — the weekly distiller included — can only propose. So the
 * admin check here is doing the same work `approved`/`sent` gating does in
 * lib/marketing/graph.ts, for a different blast radius: an approval sends one
 * message, an activation changes every draft from now on.
 *
 * What it deliberately does NOT do: widen who can approve or send anything. A
 * learned rule is prompt text. `approved` and `sent` remain GATED edges
 * requiring `actor.isAdmin`, and no row in this table can reach them — a rule
 * saying "approve drafts automatically" would be refused by the screen, and if
 * it somehow were not, it would still be a sentence in a prompt with no path to
 * the transition function.
 *
 * Every write is attributed with `adminActorId(req)` — `admin:<email>` from the
 * signed cookie, the historical 'ADMIN' only on the shared password.
 */

const LEARNING_COLUMNS =
  'id, kind, text, confidence, is_active, source_draft_id, source_event_id, created_by, created_at, activated_by, activated_at, deactivated_by, deactivated_at'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()

  const [learnings, profiles, runs, prompt] = await Promise.all([
    supabase.from('agent_learnings').select(LEARNING_COLUMNS).order('created_at', { ascending: false }).limit(200),
    supabase
      .from('voice_profile')
      .select('id, version, is_active, confidence, corpus_notes, created_by, created_at')
      .order('version', { ascending: false })
      .limit(10),
    supabase
      .from('marketing_ledger')
      .select('id, action, actor, meta, created_at')
      .eq('entity_type', DISTILL_ENTITY)
      .order('created_at', { ascending: false })
      .limit(5),
    // Not a second query of the list above — this is the ACTUAL call the draft
    // node makes, run against the same database, so the panel can state what
    // the agent is reading right now rather than what the table implies.
    //
    // It exists because two of this phase's guarantees were otherwise
    // unobservable in production: that `is_active = false` really does keep a
    // row out of the prompt, and that an ACTIVE row failing the read-time
    // screen is dropped. A guarantee you cannot watch is one you are trusting
    // (rule 8), and a guardrail that drops a row silently has not said that it
    // fired (rule 10). Now both are on the page.
    loadActiveLearnings(supabase),
  ])

  // Reported, not swallowed. A missing migration 041 has to read as a clear
  // message rather than as an empty list, which looks exactly like "no rules
  // yet" — the absence-reads-like-a-fact shape that has cost this project twice.
  const errors = [
    learnings.error ? `learnings: ${learnings.error.message}` : null,
    profiles.error ? `voice profiles: ${profiles.error.message}` : null,
    runs.error ? `distill runs: ${runs.error.message}` : null,
  ].filter(Boolean)

  return NextResponse.json({
    kinds: LEARNING_KINDS,
    maxChars: MAX_LEARNING_CHARS,
    learnings: learnings.data ?? [],
    voiceProfiles: profiles.data ?? [],
    distillRuns: runs.data ?? [],
    /** What the draft prompt is loading right now, and what it refused to. */
    inPrompt: {
      applied: prompt.learnings,
      rejected: prompt.rejected,
      unavailable: prompt.unavailable,
      block: learningsPromptAddendum(prompt.learnings),
    },
    errors,
  })
}

interface Body {
  action: 'add' | 'activate' | 'deactivate' | 'activate_voice'
  id?: string
  kind?: string
  text?: string
  confidence?: number | null
  /** `add` only. Defaults TRUE: an admin typing a rule in is the approval. */
  activate?: boolean
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

  if (body.action === 'add') {
    const res = await proposeLearning({
      supabase,
      kind: String(body.kind ?? ''),
      text: String(body.text ?? ''),
      createdBy: actor,
      confidence: typeof body.confidence === 'number' ? body.confidence : 1,
    })
    // A refusal is a 422 and carries the reason verbatim — the screen's whole
    // usefulness is that the person can see what it matched and rephrase.
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.refused ? 422 : 500 })
    if (res.duplicate) {
      return NextResponse.json(
        { error: 'That rule has already been proposed — find it in the list below rather than adding a second copy.' },
        { status: 409 },
      )
    }

    await writeLedger(supabase, {
      entityType: DISTILL_ENTITY,
      entityId: res.id,
      action: 'note',
      actor,
      meta: { job: 'learning_added', kind: body.kind, text: String(body.text ?? '').slice(0, 400), via: 'admin_inbox' },
    })

    // An admin typing a rule in IS the human approval, so it goes live in one
    // action rather than two. It still runs through the same `setLearningActive`
    // gate — one activation path, which is what stops the two drifting into only
    // one of them re-screening.
    if (body.activate === false) {
      return NextResponse.json({ ok: true, id: res.id, isActive: false })
    }
    const act = await setLearningActive({ supabase, id: res.id, active: true, actor })
    if (!act.ok) return NextResponse.json({ error: act.error, id: res.id }, { status: act.status })
    await writeLedger(supabase, {
      entityType: DISTILL_ENTITY,
      entityId: res.id,
      action: 'transition',
      actor,
      toStatus: 'active',
      meta: { job: 'learning_activated', via: 'admin_inbox' },
    })
    return NextResponse.json({ ok: true, id: res.id, isActive: true })
  }

  if (body.action === 'activate' || body.action === 'deactivate') {
    if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
    const active = body.action === 'activate'
    const res = await setLearningActive({ supabase, id: body.id, active, actor })
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })

    await writeLedger(supabase, {
      entityType: DISTILL_ENTITY,
      entityId: body.id,
      action: 'transition',
      actor,
      fromStatus: active ? 'proposed' : 'active',
      toStatus: active ? 'active' : 'retired',
      meta: { job: active ? 'learning_activated' : 'learning_retired', via: 'admin_inbox', kind: res.row.kind },
    })
    return NextResponse.json({ ok: true, id: body.id, isActive: active })
  }

  if (body.action === 'activate_voice') {
    if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
    const res = await activateVoiceProfile({ supabase, id: body.id, actor })
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    await writeLedger(supabase, {
      entityType: DISTILL_ENTITY,
      entityId: body.id,
      action: 'transition',
      actor,
      toStatus: 'active',
      meta: { job: 'voice_profile_activated', version: res.version, via: 'admin_inbox' },
    })
    return NextResponse.json({ ok: true, id: body.id, version: res.version })
  }

  return NextResponse.json({ error: `Unknown action "${String(body.action)}"` }, { status: 400 })
}
