import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { advance, IllegalTransitionError, TransitionNotAuthorizedError } from '@/lib/marketing/graph'
import { releasesAllSigned } from '@/lib/marketing/consent'

export const dynamic = 'force-dynamic'

const ADMIN_ACTOR = { id: 'admin', isAdmin: true }

/**
 * Advance a website_content row through the publishing graph. The ONLY status
 * writer for content — everything goes through advance(), which validates the
 * transition, enforces the admin gate, and writes a ledger row.
 *
 * Body: { id, to, reason? }
 *   to ∈ pending_review | approved | published | draft | archived
 */
export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const body = (await req.json()) as { id?: string; to?: string; reason?: string }
  const { id, to, reason } = body

  if (!id || !to) {
    return NextResponse.json({ error: 'id and to are required' }, { status: 400 })
  }

  // Friendly consent pre-check (layer 2) before the DB trigger (layer 1) fires,
  // so the admin gets a clear message rather than a raw SQL error.
  if (to === 'approved' || to === 'published') {
    const { data: row } = await supabase
      .from('website_content')
      .select('references_child_media, consent_release_ids')
      .eq('id', id)
      .maybeSingle()
    if (row?.references_child_media) {
      const ok = await releasesAllSigned(supabase, row.consent_release_ids as string[] | null)
      if (!ok) {
        return NextResponse.json(
          { error: 'Consent gate: this content references child media and needs a signed release attached before it can be approved or published.' },
          { status: 409 }
        )
      }
    }
  }

  const patch: Record<string, unknown> = {
    reviewed_by: 'admin',
    reviewed_at: new Date().toISOString(),
  }
  if (to === 'published') patch.published_at = new Date().toISOString()

  try {
    const result = await advance({
      entity: 'website_content',
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
