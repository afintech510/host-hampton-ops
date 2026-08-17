import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { writeLedger } from '@/lib/marketing/graph'

export const dynamic = 'force-dynamic'

/**
 * Theme-page audit seeder (ALWAYS_ASK checklist).
 *
 * Scans active party_themes and creates one `marketing_tasks` checklist row per
 * theme that doesn't already have one — a human works each through the Marketing
 * tab (audit the theme's page copy, SEO, images) and marks it done via advance().
 *
 * Idempotent: re-running never duplicates. Dedup is a query on
 * (task_type='theme_page_audit', entity_id) rather than a DB constraint — no
 * new migration required, and this is a low-volume admin action.
 *
 * These rows are DATA, not a status transition, so they are inserted directly
 * (advance() only governs status CHANGES, not creation). They land as
 * `pending_review` so they surface in the admin queue immediately.
 */

const AUDIT_CHECKLIST = [
  'Title tag includes the theme name + a local keyword and is ≤ 60 chars',
  'Unique meta description (~150 chars), warm and specific',
  'At least 400 words of genuine, theme-specific copy',
  'Every image has descriptive alt text',
  'FAQ section + FAQPage/Service JSON-LD present',
  'Internal link to /book (and to related themes where natural)',
  'Price is current and matches party_themes.price_cents',
]

interface Theme {
  id: string
  name: string
  slug: string
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()

  const { data: themes, error: themesErr } = await supabase
    .from('party_themes')
    .select('id, name, slug')
    .eq('is_active', true)
    .order('sort_order')

  if (themesErr) {
    console.error('theme-audit fetch themes error:', themesErr.message)
    return NextResponse.json({ error: 'Failed to fetch themes' }, { status: 500 })
  }

  // Existing audit tasks (any status) → skip those themes.
  const { data: existing } = await supabase
    .from('marketing_tasks')
    .select('entity_id')
    .eq('task_type', 'theme_page_audit')

  const seen = new Set((existing || []).map((r: { entity_id: string | null }) => r.entity_id))

  let created = 0
  let skipped = 0

  for (const theme of (themes || []) as Theme[]) {
    if (seen.has(theme.id)) {
      skipped++
      continue
    }

    const { error: insErr } = await supabase.from('marketing_tasks').insert({
      task_type: 'theme_page_audit',
      title: `Audit theme page: ${theme.name}`,
      approval_tier: 'ALWAYS_ASK',
      status: 'pending_review',
      entity_type: 'party_theme',
      entity_id: theme.id,
      created_by: 'system',
      context: {
        theme_id: theme.id,
        slug: theme.slug,
        name: theme.name,
        checklist: AUDIT_CHECKLIST,
      },
    })

    if (insErr) {
      // Tolerate a concurrent-insert race without aborting the whole batch.
      console.error(`theme-audit insert error for ${theme.slug}:`, insErr.message)
      skipped++
      continue
    }
    created++
  }

  await writeLedger(supabase, {
    entityType: 'marketing_task',
    action: 'note',
    actor: 'admin',
    meta: { job: 'theme_page_audit_seed', scanned: themes?.length || 0, created, skipped },
  })

  return NextResponse.json({ scanned: themes?.length || 0, created, skipped })
}
