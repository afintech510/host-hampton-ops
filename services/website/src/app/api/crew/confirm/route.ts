import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { isUuid, requireCrewMember } from '@/lib/crew/auth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { confirmSpot } from '@/lib/crew/confirm'

export const dynamic = 'force-dynamic'

/**
 * "I'll be there" (spec §3.7). Sets `confirmed_at` on the member's own assigned
 * spot on an upcoming party, once — one conditional UPDATE, read back
 * (`lib/crew/confirm.ts`) — and sends `confirmed`. No step changes.
 */
export async function POST(req: NextRequest) {
  const limited = guardRate(req, plannerRule('crew'))
  if (limited) return limited
  const gate = await requireCrewMember(req)
  if (!gate.ok) return gate.response

  const body = await req.json().catch(() => ({}))
  const slotId = body?.slotId
  if (!isUuid(slotId)) return NextResponse.json({ error: 'Pick a party.' }, { status: 400 })

  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
  const out = await confirmSpot({ sb, now: new Date() }, settings.settings, gate.member, slotId)
  if (out.kind === 'confirmed' || out.kind === 'already') return NextResponse.json({ ok: true })
  if (out.kind === 'refused') return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
}
