import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { requireCrewMember } from '@/lib/crew/auth'
import { screenSkills } from '@/lib/crew/skills'

export const dynamic = 'force-dynamic'

/** Save my self-reported skills. Informational only; `screenSkills` is the one screen. */
export async function POST(req: NextRequest) {
  const limited = guardRate(req, plannerRule('crew'))
  if (limited) return limited
  const gate = await requireCrewMember(req)
  if (!gate.ok) return gate.response
  const member = gate.member

  const body = await req.json().catch(() => ({}))
  const screened = screenSkills({ skills: body?.skills, extras: body?.extras })
  if (!screened.ok) return NextResponse.json({ error: screened.error }, { status: 400 })

  const { data, error } = await getSupabase()
    .from('crew_members')
    .update({ skills: screened.skills })
    .eq('id', member.id)
    .select('id')
    .maybeSingle()
  if (error || !data) {
    if (error) console.error('crew/skills: update failed:', error.message)
    return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
  }
  return NextResponse.json({ ok: true, skills: screened.skills })
}
