import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { writeLedger } from '@/lib/marketing/graph'

export const dynamic = 'force-dynamic'

/**
 * Directory-listing task seeder (ALWAYS_ASK checklist), Phase 3.
 *
 * Directory listings and NAP (Name/Address/Phone) consistency are manual,
 * owner-facing actions — no listing API is called here. This seeds one
 * `marketing_tasks` checklist row per directory (idempotent by
 * (task_type='directory_listing', entity_id)) so the work is tracked in the
 * Marketing tab instead of living only in someone's head.
 *
 * Same pattern as theme-audit: rows are DATA, inserted directly (advance()
 * only governs status CHANGES, not creation), landing as pending_review so
 * they surface in the queue immediately.
 */

interface Directory {
  slug: string
  name: string
  checklist: string[]
}

// PartySlate first per the build plan (highest-intent party-vendor directory
// for this business); NAP consistency is the cross-cutting audit that keeps
// every other listing honest.
const DIRECTORIES: Directory[] = [
  {
    slug: 'partyslate',
    name: 'PartySlate listing',
    checklist: [
      'Create/claim the Host Hampton vendor profile on PartySlate',
      'NAP matches the site exactly (name, 295 Montauk Hwy Speonk NY address, phone)',
      'Category set to Kids Party Entertainment / Mobile Party Service',
      'Service area listed matches the site',
      'Upload current, non-watermarked photos (consent-cleared only)',
      'Link back to hosthampton.com',
    ],
  },
  {
    slug: 'nap-consistency',
    name: 'NAP consistency audit',
    checklist: [
      'List every existing citation (Google Business Profile, Yelp, Facebook, Bing Places, directories)',
      'Confirm business name matches exactly across all listings',
      'Confirm address matches exactly across all listings',
      'Confirm phone number matches exactly across all listings',
      'Fix any mismatch found; note the source and the fix in the task context',
    ],
  },
]

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()

  // Existing directory-listing tasks (any status) → skip those directories.
  const { data: existing } = await supabase
    .from('marketing_tasks')
    .select('entity_id')
    .eq('task_type', 'directory_listing')

  const seen = new Set((existing || []).map((r: { entity_id: string | null }) => r.entity_id))

  let created = 0
  let skipped = 0

  for (const dir of DIRECTORIES) {
    if (seen.has(dir.slug)) {
      skipped++
      continue
    }

    const { error: insErr } = await supabase.from('marketing_tasks').insert({
      task_type: 'directory_listing',
      title: dir.name,
      approval_tier: 'ALWAYS_ASK',
      status: 'pending_review',
      entity_type: 'directory',
      entity_id: dir.slug,
      created_by: 'system',
      context: {
        directory: dir.slug,
        checklist: dir.checklist,
      },
    })

    if (insErr) {
      console.error(`directory-listings insert error for ${dir.slug}:`, insErr.message)
      skipped++
      continue
    }
    created++
  }

  await writeLedger(supabase, {
    entityType: 'marketing_task',
    action: 'note',
    actor: 'admin',
    meta: { job: 'directory_listing_seed', scanned: DIRECTORIES.length, created, skipped },
  })

  return NextResponse.json({ scanned: DIRECTORIES.length, created, skipped })
}
