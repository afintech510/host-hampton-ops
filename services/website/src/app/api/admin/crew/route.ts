/**
 * /admin/crew's data: alerts and the next six weeks of crew parties
 * (prompt 04 §2). Works whether or not CREW_ENABLED is on, so Allie can set up
 * before launch.
 *
 * Read-only. The "needs a time" list comes from a DRY RUN of the reconcile,
 * which writes nothing; "Sync now" is POST /api/admin/crew/sync.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { loadCrewSettings, crewEnabled, crewSmsEnabled, crewTestLoginEnabled } from '@/lib/crew/settings'
import { loadAdminOverview } from '@/lib/crew/admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return NextResponse.json({ error: `Could not read the crew rules: ${settings.error}` }, { status: 503 })
  const overview = await loadAdminOverview(sb, new Date(), settings.settings)
  if (overview.kind !== 'ok') return NextResponse.json({ error: `Could not read the schedule: ${overview.error}` }, { status: 503 })
  return NextResponse.json({
    ...overview.data,
    switches: { crewEnabled: crewEnabled(), smsEnabled: crewSmsEnabled(), testLogin: crewTestLoginEnabled() },
  })
}
