import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { advance, IllegalTransitionError, TransitionNotAuthorizedError } from '@/lib/marketing/graph'

export const dynamic = 'force-dynamic'

const ADMIN_ACTOR = { id: 'admin', isAdmin: true }

/**
 * Advance a marketing_task through its lifecycle graph.
 * Body: { id, to, reason? }
 *   to ∈ pending_review | approved | rejected | executing | done | escalated
 */
export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const body = (await req.json()) as { id?: string; to?: string; reason?: string }
  const { id, to, reason } = body

  if (!id || !to) {
    return NextResponse.json({ error: 'id and to are required' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {
    reviewed_by: 'admin',
    reviewed_at: new Date().toISOString(),
  }
  if (to === 'rejected' && reason) patch.rejection_reason = reason

  try {
    const result = await advance({
      entity: 'marketing_task',
      id,
      to,
      actor: ADMIN_ACTOR,
      patch,
      meta: reason ? { reason } : undefined,
      supabase,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (err instanceof TransitionNotAuthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 403 })
    }
    const msg = err instanceof Error ? err.message : 'advance failed'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
