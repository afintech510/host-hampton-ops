/**
 * The crew roster (prompt 04 §4).
 *
 *   GET   every member (removed included, sorted last) with steps → rate, parties
 *         worked, no-shows, uncovered late cancels and upcoming spots, plus the
 *         hired job applications not yet on the crew (for "Add to crew").
 *   POST  add a member. The starting step goes through crew_admin_set_steps so
 *         the ledger records it.
 *
 * Adam enters the real roster here. No roster file is ever committed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { createMember, loadRoster } from '@/lib/crew/adminMembers'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return NextResponse.json({ error: `Could not read the crew rules: ${settings.error}` }, { status: 503 })
  const r = await loadRoster(sb, settings.settings, new Date())
  if (r.kind !== 'ok') return NextResponse.json({ error: `Could not read the roster: ${r.error}` }, { status: 503 })
  return NextResponse.json({ ...r.data, maxSteps: settings.settings.pay.maxSteps })
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return NextResponse.json({ error: `Could not read the crew rules: ${settings.error}` }, { status: 503 })
  const r = await createMember(sb, body, adminActorId(req), settings.settings)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r)
}
