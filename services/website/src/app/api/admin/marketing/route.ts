import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { currentMonth } from '@/lib/marketing/budget'

export const dynamic = 'force-dynamic'

/**
 * Snapshot for the admin Marketing tab: the content pipeline, active marketing
 * tasks, this month's budget, pending consent releases, and recent ledger.
 */
export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()

  const [content, tasks, budget, releases, ledger] = await Promise.all([
    supabase
      .from('website_content')
      // meta_description and created_by are here so the Marketing tab can show
      // the SEO budget and who wrote the row (COPY vs a human) without a second
      // round-trip — a reviewer's first two questions about a draft.
      .select('id, slug, title, meta_description, status, locale, page_type, created_by, references_child_media, consent_release_ids, reviewed_by, reviewed_at, updated_at')
      .neq('status', 'archived')
      .order('updated_at', { ascending: false })
      .limit(100),
    supabase
      .from('marketing_tasks')
      .select('id, task_type, title, approval_tier, status, entity_type, entity_id, rejection_reason, created_at, updated_at')
      .not('status', 'in', '(done,rejected)')
      .order('updated_at', { ascending: false })
      .limit(100),
    supabase.from('marketing_budget').select('*').eq('month', currentMonth()).maybeSingle(),
    supabase
      .from('consent_releases')
      .select('id, booking_id, contact_id, child_name, status, signed_at, created_at')
      .neq('status', 'signed')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('marketing_ledger')
      .select('id, entity_type, entity_id, action, actor, from_status, to_status, cost_usd, tokens, meta, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  return NextResponse.json({
    content: content.data || [],
    tasks: tasks.data || [],
    budget: budget.data || null,
    releases: releases.data || [],
    ledger: ledger.data || [],
  })
}
