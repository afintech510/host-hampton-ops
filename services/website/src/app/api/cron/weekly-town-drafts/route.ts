import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { createTownServiceDraft } from '@/lib/marketing/townDraft'

export const dynamic = 'force-dynamic'

/**
 * Weekly jewelry-town draft cron (AUTO_EXECUTE at the LLM-node level — output
 * still lands as `pending_review`, never publishes).
 *
 * Town list + priority tiers confirmed by Adam 2026-08-17 (population +
 * fit for the permanent-jewelry / East-End audience). Self-throttling by
 * design: each run only drafts towns from TOWNS that don't already have a
 * `permanent-jewelry-<town>` row, taking the next BATCH_SIZE in priority
 * order. Once every town has a draft, runs are no-ops (0 created) — safe to
 * leave scheduled indefinitely. Add a town to TOWNS to pick it up next run.
 *
 * Auth: x-cron-secret / ?secret= (matches the other cron routes).
 */

function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return secret === process.env.CRON_SECRET
}

const SERVICE = 'permanent jewelry'
const BATCH_SIZE = Number(process.env.WEEKLY_TOWN_DRAFT_BATCH_SIZE || 2)

// Priority order — tier 1 first, then tier 2, tier 3, watch-list last.
const TOWNS = [
  'Southampton',
  'East Hampton',
  'Smithtown',
  'Patchogue',
  'Islip',
  'Westhampton Beach',
  'Montauk',
  'Sag Harbor',
  'Bridgehampton',
  'Water Mill',
  'Riverhead',
]

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabase()

  const slugFor = (town: string) =>
    `${SERVICE.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${town.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

  const candidateSlugs = TOWNS.map(town => ({ town, slug: slugFor(town) }))

  const { data: existing, error: existErr } = await supabase
    .from('website_content')
    .select('slug')
    .eq('locale', 'en')
    .in('slug', candidateSlugs.map(c => c.slug))

  if (existErr) {
    console.error('cron:weekly-town-drafts fetch error:', existErr)
    return NextResponse.json({ error: 'Failed to check existing content' }, { status: 500 })
  }

  const existingSlugs = new Set((existing ?? []).map(r => r.slug as string))
  const pending = candidateSlugs.filter(c => !existingSlugs.has(c.slug)).slice(0, BATCH_SIZE)

  if (pending.length === 0) {
    return NextResponse.json({ drafted: 0, message: 'All towns already have a draft — nothing to do.' })
  }

  const results: { town: string; slug: string; ok: boolean; error?: string }[] = []

  for (const { town, slug } of pending) {
    const result = await createTownServiceDraft(supabase, { town, service: SERVICE, slug, locale: 'en', actor: 'COPY' })
    if (result.ok) {
      results.push({ town, slug, ok: true })
    } else {
      results.push({ town, slug, ok: false, error: result.error })
      // Budget exhausted (402) — stop the batch early rather than keep failing.
      if (result.status === 402) break
    }
  }

  const drafted = results.filter(r => r.ok).length
  console.log(`cron:weekly-town-drafts drafted ${drafted}/${pending.length}`, results)

  return NextResponse.json({ drafted, attempted: pending.length, results })
}
