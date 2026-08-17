import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { createTownServiceDraft } from '@/lib/marketing/townDraft'

export const dynamic = 'force-dynamic'

/**
 * LLM node: Claude drafts a town × service `website_content` row.
 *
 * "Graph as data": this is the on-demand admin trigger for the draft-
 * generation node of the marketing graph — the actual check-act-record
 * pipeline (budget, Claude call, insert, advance to pending_review) lives in
 * lib/marketing/townDraft.ts, shared with the weekly-town-drafts cron.
 *
 * Auth: admin only (LLM calls cost money + spend the monthly cap).
 */
export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const body = (await req.json()) as { town?: string; service?: string; slug?: string; locale?: string }
  const town = body.town?.trim()
  const service = body.service?.trim()
  const locale = body.locale === 'es' ? 'es' : 'en'

  if (!town || !service) {
    return NextResponse.json({ error: 'town and service are required' }, { status: 400 })
  }

  const supabase = getSupabase()
  const result = await createTownServiceDraft(supabase, { town, service, slug: body.slug, locale })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({
    ok: true,
    id: result.id,
    slug: result.slug,
    locale: result.locale,
    status: result.contentStatus,
    costUsd: result.costUsd,
    tokens: result.tokens,
  })
}
