import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { isUuid, requireCrewMember } from '@/lib/crew/auth'
import { loadCrewSettings } from '@/lib/crew/settings'
import { claimCover } from '@/lib/crew/cover'

export const dynamic = 'force-dynamic'

/**
 * Take a late cancel (spec §3.7). Eligibility is re-checked first (§3.6:
 * overlap and availability, which the database cannot see); the race is settled
 * by `crew_claim_swap`, first claim wins. A standby only, until Allie offers it
 * to everyone. The +2 is earned when the party is WORKED, never here.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = guardRate(req, plannerRule('crew'))
  if (limited) return limited
  const gate = await requireCrewMember(req)
  if (!gate.ok) return gate.response
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Someone just took it.' }, { status: 404 })

  const sb = getSupabase()
  const settings = await loadCrewSettings(sb)
  if (settings.kind !== 'ok') return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
  const out = await claimCover({ sb, now: new Date() }, settings.settings, gate.member, params.id)
  if (out.kind === 'ok') return NextResponse.json({ ok: true })
  if (out.kind === 'refused') return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
}
