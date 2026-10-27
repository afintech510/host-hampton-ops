/**
 * "Sync now": the booking → crew-party reconcile (lib/crew/sync.ts, spec §9),
 * run by Allie and written as her (`adminActorId`). The same function the cron
 * will run from Phase 4. Idempotent: a second press creates nothing.
 *
 * New parties are DRAFTS. A cancelled booking's party is cancelled and its
 * crew's notices are QUEUED, never sent here.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { reconcileCrewParties } from '@/lib/crew/sync'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return NextResponse.json({ error: `Could not read the crew rules: ${settings.error}` }, { status: 503 })
  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'
  const r = await reconcileCrewParties({ now: new Date(), supabase: sb, settings: settings.settings, dryRun, actor: adminActorId(req) })
  if (r.kind !== 'ok') return NextResponse.json({ error: `Could not read the bookings: ${r.error}` }, { status: 503 })
  const s = r.summary
  console.log(`crew sync${dryRun ? ' (dry run)' : ''}: created ${s.created}, updated ${s.updated}, cancelled ${s.cancelled}, spots ${s.spotsAdded}, raced ${s.raced}, errors ${s.errors.length}`)
  return NextResponse.json({ ok: s.errors.length === 0, dryRun, summary: s }, { status: s.errors.length ? 207 : 200 })
}
