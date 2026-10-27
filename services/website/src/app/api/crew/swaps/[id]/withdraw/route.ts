import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { isUuid, requireCrewMember } from '@/lib/crew/auth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { withdrawCover } from '@/lib/crew/cover'

export const dynamic = 'force-dynamic'

/** "I can make it after all": the member's own open cover request → `cancelled`. They were never off the party. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = guardRate(req, plannerRule('crew'))
  if (limited) return limited
  const gate = await requireCrewMember(req)
  if (!gate.ok) return gate.response
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Pick a request.' }, { status: 400 })

  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
  const out = await withdrawCover({ sb, now: new Date() }, settings.settings, gate.member, params.id)
  if (out.kind === 'ok') return NextResponse.json({ ok: true })
  if (out.kind === 'refused') return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
}
