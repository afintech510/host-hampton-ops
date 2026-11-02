import { NextRequest, NextResponse } from 'next/server'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { featureEnabled } from '@/tenant'
import { markUsed, releaseUsed, verifyProposal } from '@/lib/assistant/proposals'
import { executeProposal } from '@/lib/assistant/execute'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/assistant/confirm — the manager pressed Confirm on a card.
 *
 * Body: `{ token }`. The token is the proposal, signed by this server for THIS
 * admin; it is verified, claimed (single use), and then carried out by
 * replaying the dashboard's own admin API call (lib/assistant/execute.ts).
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

  const body = (await req.json().catch(() => null)) as { token?: unknown } | null
  const verified = verifyProposal(body?.token, adminActorId(req))
  if (!verified.ok) {
    return NextResponse.json({ ok: false, error: REASONS[verified.reason] }, { status: verified.reason === 'already_used' ? 409 : 400 })
  }
  const proposal = verified.proposal
  if (!markUsed(proposal)) {
    return NextResponse.json({ ok: false, error: REASONS.already_used }, { status: 409 })
  }

  try {
    const result = await executeProposal(req, proposal)
    // A 4xx from the replayed route is a refusal BEFORE anything happened
    // (quiet hours, missing email, nothing owed) — release the claim so the
    // manager can fix the cause and confirm again. Anything else stays claimed:
    // a 5xx may have happened halfway, and retrying a send is how a client gets
    // the same text twice.
    if (!result.ok && result.status >= 400 && result.status < 500) releaseUsed(proposal.id)
    console.log(
      `assistant: ${adminActorId(req)} confirmed ${proposal.kind} ${proposal.id} → ${result.ok ? 'ok' : 'refused'} (${result.status})`,
    )
    return NextResponse.json({ ok: result.ok, message: result.message, links: result.links ?? [] })
  } catch (err) {
    console.error(`assistant: confirm ${proposal.kind} ${proposal.id} threw`, err)
    return NextResponse.json(
      { ok: false, error: 'Something went wrong part-way. Check the party in the Parties tab before trying again.' },
      { status: 500 },
    )
  }
}
