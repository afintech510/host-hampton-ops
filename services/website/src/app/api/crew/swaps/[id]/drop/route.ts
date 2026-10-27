import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { isUuid, requireCrewMember } from '@/lib/crew/auth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { dropAnyway } from '@/lib/crew/cover'

export const dynamic = 'force-dynamic'

/**
 * "Drop anyway": leave a late cancel nobody took. `crew_drop_uncovered` unassigns
 * and applies the reset to the start rate as a compare-and-swap (recorded, not
 * applied, during the launch grace). The page asks first, in dollars.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = guardRate(req, plannerRule('crew'))
  if (limited) return limited
  const gate = await requireCrewMember(req)
  if (!gate.ok) return gate.response
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Pick a request.' }, { status: 400 })

  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
  const out = await dropAnyway({ sb, now: new Date() }, settings.settings, gate.member, params.id)
  if (out.kind === 'ok') return NextResponse.json({ ok: true })
  if (out.kind === 'refused') return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
}
