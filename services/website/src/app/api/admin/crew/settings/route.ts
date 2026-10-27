/**
 * The crew rules (prompt 04 §5): one `crew_settings` section per save.
 *
 *   GET  every row as stored, plus what `settingsFromRows` reads from them.
 *   PUT  { key, value } — the whole section. `screenCrewSetting` refuses rather
 *        than clamps (no negatives, max_steps ≤ 8, min ≤ max, the confirmation
 *        hours in order, …) and proves the value round-trips through
 *        `settingsFromRows` unchanged. Records `adminActorId` in `updated_by`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { screenCrewSetting } from '@/lib/crew/adminForms'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const r = await loadCrewSettings(getSupabase())
  if (r.kind !== 'ok') return NextResponse.json({ error: `Could not read the crew rules: ${r.error}` }, { status: 503 })
  return NextResponse.json({ rows: r.rows, settings: r.settings })
}

export async function PUT(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const screen = screenCrewSetting(body?.key, body?.value)
  if (!screen.ok) return NextResponse.json({ error: screen.error }, { status: 400 })
  const { data, error } = await getSupabase().from('crew_settings')
    .update({ value: screen.value, updated_by: adminActorId(req) })
    .eq('key', body.key as string)
    .select('key, value')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // The seed writes every key; an update that matched nothing is a missing row, not a save.
  if ((data ?? []).length === 0) return NextResponse.json({ error: 'That setting is missing from the database.' }, { status: 404 })
  return NextResponse.json({ ok: true, key: body.key, value: screen.value })
}
