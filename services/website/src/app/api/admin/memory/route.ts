import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { listMemory, promoteMemory, MEMORY_PREVIEW_CHARS } from '@/lib/agent/memoryImport'
import { writeLedger } from '@/lib/marketing/graph'
import { LEARNING_KINDS, MAX_LEARNING_CHARS } from '@/lib/agent/learnings'
import { DISTILL_ENTITY } from '@/lib/agent/distill'

export const dynamic = 'force-dynamic'

/**
 * `agent_memory` — the retired orchestrator store, and the one door out of it.
 *
 * GET  → all 44 rows with a screen verdict on each, so somebody reading them
 *        can see which carry February prices or dead HoneyBook links before
 *        they copy a sentence out.
 * POST → promote a row's knowledge into `agent_learnings` as an INACTIVE
 *        proposal, written by a human who read it.
 *
 * ── Why this route exists and a "memory pipeline" does not ────────────────
 *
 * Measured 2026-09-12: the Host Hampton orchestrator and all seven agent
 * services are gone (compose defines `nginx` and `website` only,
 * app.hosthampton.com answers 520), `services/website` references
 * `agent_memory` zero times, and the last write to it was INTEL's
 * `analytics.last_report` on 2026-04-22.
 *
 * So Phase 5's "agents write back learnings post-task" cannot mean those
 * agents. The live loop is Phase 6's — `draft_feedback` → distiller →
 * `agent_learnings` → the prompt — and building a second one here would be a
 * concept defined twice, which is a concept nothing is checking (rule 11).
 *
 * This route is therefore a RETIREMENT, not a pipeline: one door, screened,
 * landing inactive, into the loop that already exists.
 *
 * ── It is read-only about the memory itself ──────────────────────────────
 *
 * There is no edit and no delete here. The rows are a February snapshot with 89
 * rows of history behind them; rewriting them would produce a store that is
 * neither a historical record nor a live one. The only write is
 * `promoted_learning_id`, which is a back-reference.
 */

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()

  const listing = await listMemory(supabase)

  if (listing.kind === 'unavailable') {
    // Rule 12. Reported as a failure, not as an empty table — an empty list here
    // reads as "the orchestrator never wrote anything", which is false and is
    // the opposite of the finding this panel exists to show.
    return NextResponse.json({ error: `Could not read agent_memory: ${listing.error}` }, { status: 503 })
  }

  if (listing.kind === 'absent') {
    return NextResponse.json({
      rows: [],
      retired: true,
      note: 'agent_memory does not exist in this database. It belongs to the decommissioned orchestrator schema.',
      kinds: LEARNING_KINDS,
      maxChars: MAX_LEARNING_CHARS,
      previewChars: MEMORY_PREVIEW_CHARS,
    })
  }

  const flagged = listing.rows.filter(r => r.warnings.length > 0).length

  return NextResponse.json({
    rows: listing.rows,
    retired: true,
    kinds: LEARNING_KINDS,
    maxChars: MAX_LEARNING_CHARS,
    previewChars: MEMORY_PREVIEW_CHARS,
    /**
     * The measurement, on the page rather than in a document. It is the whole
     * argument for why nothing reads this table into a prompt: plan §24's
     * headline defect was a hand-written store feeding prices into a prompt
     * that forbids prices, and this is the same store one size larger.
     */
    summary: {
      total: listing.rows.length,
      flagged,
      promoted: listing.rows.filter(r => r.promoted_learning_id).length,
      lastWrite: listing.rows.reduce((acc, r) => (r.updated_at > acc ? r.updated_at : acc), ''),
    },
    note:
      'This store is RETIRED: nothing in the running app reads it. Promote a row to turn its knowledge into a ' +
      'learned rule the booking agent can use — it arrives inactive and has to be activated separately.',
  })
}

interface Body {
  action: 'promote'
  memoryId?: string
  kind?: string
  text?: string
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

  if (body?.action !== 'promote') {
    return NextResponse.json({ error: `Unknown action "${String(body?.action)}"` }, { status: 400 })
  }
  if (!body.memoryId) return NextResponse.json({ error: 'memoryId is required' }, { status: 400 })
  if (!body.text) {
    return NextResponse.json(
      {
        error:
          'text is required. Write the rule yourself after reading the row — this route deliberately does not ' +
          'derive a rule from the stored value, because guessing at an input it cannot interpret is the one ' +
          'thing a pipeline whose output becomes a standing instruction must never do.',
      },
      { status: 400 }
    )
  }

  const res = await promoteMemory({
    supabase,
    memoryId: body.memoryId,
    kind: String(body.kind ?? 'fact'),
    text: String(body.text),
    actor,
  })

  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })

  if (res.duplicate) {
    return NextResponse.json(
      { error: 'That rule has already been proposed — find it in the Learned rules list rather than adding a second copy.' },
      { status: 409 }
    )
  }

  await writeLedger(supabase, {
    entityType: DISTILL_ENTITY,
    entityId: res.learningId,
    action: 'note',
    actor,
    meta: {
      job: 'learning_added',
      via: 'agent_memory_promote',
      source_memory_id: body.memoryId,
      kind: body.kind ?? 'fact',
      text: String(body.text).slice(0, 400),
    },
  })

  return NextResponse.json({
    ok: true,
    learningId: res.learningId,
    isActive: false,
    /** Said explicitly: promoting is not activating. */
    note: 'Proposed as an INACTIVE learned rule. Activate it in the Learned rules panel to put it in the agent’s prompt.',
  })
}
