import { NextRequest, NextResponse } from 'next/server'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { featureEnabled } from '@/tenant'
import { getSupabase } from '@/lib/supabase'
import { verifyProposal } from '@/lib/assistant/proposals'
import { claimProposal, releaseProposal } from '@/lib/assistant/usedProposals'
import { executeProposal } from '@/lib/assistant/execute'
import { contextKey, screenContext } from '@/lib/assistant/context'
import { recordCardOutcome } from '@/lib/assistant/threads'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/assistant/confirm — the manager pressed Confirm on a card.
 *
 * Body: `{ token, context? }`. The token is the proposal, signed by this server
 * for THIS admin; it is verified, claimed (single use, durably — a row whose
 * primary key is the claim, so a restart cannot make a card replayable), and
 * then carried out by replaying the dashboard's own admin API call
 * (lib/assistant/execute.ts). `context` only says which saved thread to note
 * the outcome in; it grants nothing.
 */
const REASONS: Record<string, string> = {
  malformed: 'That card is not valid — ask the assistant again.',
  bad_signature: 'That card is not valid — ask the assistant again.',
  expired: 'That card has expired (30 minutes) — ask the assistant again.',
  wrong_actor: 'That card was prepared for a different admin login.',
  already_used: 'That card was already confirmed.',
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  if (!featureEnabled('managerAssistant')) {
    return NextResponse.json({ error: 'The Manager assistant is not enabled on this site.' }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as { token?: unknown; context?: unknown } | null
  const actor = adminActorId(req)
  const verified = verifyProposal(body?.token, actor)
  if (!verified.ok) {
    return NextResponse.json({ ok: false, error: REASONS[verified.reason] }, { status: 400 })
  }
  const proposal = verified.proposal

  const supabase = getSupabase()
  const claim = await claimProposal(supabase, proposal)
  if (claim === 'already_used') {
    return NextResponse.json({ ok: false, error: REASONS.already_used }, { status: 409 })
  }
  if (claim === 'unavailable') {
    // Executing something we could not record as claimed is the replayable
    // direction. Nothing has happened; the card is still good.
    return NextResponse.json({ ok: false, error: 'Could not record the confirmation, so nothing was done. Try again.' }, { status: 503 })
  }

  const ctx = screenContext(body?.context)
  const note = (state: 'done' | 'failed', message: string, links?: { label: string; url: string }[]) =>
    recordCardOutcome(supabase, actor, contextKey(ctx), ctx.bookingRef, { id: proposal.id, title: proposal.title }, { state, message, links })

  try {
    const result = await executeProposal(req, proposal)
    // A 4xx from the replayed route is a refusal BEFORE anything happened
    // (quiet hours, missing email, nothing owed) — release the claim so the
    // manager can fix the cause and confirm again. Anything else stays claimed:
    // a 5xx may have happened halfway, and retrying a send is how a client gets
    // the same text twice.
    const released = !result.ok && result.status >= 400 && result.status < 500 ? await releaseProposal(supabase, proposal.id) : false
    console.log(
      `assistant: ${actor} confirmed ${proposal.kind} ${proposal.id} → ${result.ok ? 'ok' : 'refused'} (${result.status})`,
    )
    // A released card stays confirmable, so it is not written down as an outcome.
    if (!released) await note(result.ok ? 'done' : 'failed', result.message, result.links)
    return NextResponse.json({ ok: result.ok, message: result.message, links: result.links ?? [], retryable: released })
  } catch (err) {
    console.error(`assistant: confirm ${proposal.kind} ${proposal.id} threw`, err)
    await note('failed', 'Something went wrong part-way. Check the party in the Parties tab before trying again.')
    return NextResponse.json(
      { ok: false, error: 'Something went wrong part-way. Check the party in the Parties tab before trying again.' },
      { status: 500 },
    )
  }
}
