import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { requireCrewMember } from '@/lib/crew/auth'
import { completeOnboarding } from '@/lib/crew/profile'
import { getMember } from '@/lib/crew/db'

export const dynamic = 'force-dynamic'

/**
 * Finish the steps before the agreement: needs the About-you and Emergency
 * fields saved and a confirmed email on file. Records the shift-text choice as
 * an explicit yes or no (`smsOptIn`), which is the consent A2P registration needs.
 */
export async function POST(req: NextRequest) {
  const limited = guardRate(req, plannerRule('crew/me'))
  if (limited) return limited
  const gate = await requireCrewMember(req, 'onboarding')
  if (!gate.ok) return gate.response

  const body = await req.json().catch(() => ({}))
  if (typeof body?.smsOptIn !== 'boolean') return NextResponse.json({ error: 'Choose whether we may text you about parties.' }, { status: 400 })

  const sb = getSupabase()
  // Re-read: the email may have been confirmed since the session was read.
  const fresh = await getMember(sb, gate.member.id)
  if (fresh.kind !== 'ok' || !fresh.data) return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })

  const r = await completeOnboarding(sb, fresh.data, body.smsOptIn)
  if (r.kind === 'unavailable') {
    console.error('crew/me/onboarding/complete:', r.error)
    return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
  }
  if (r.kind === 'incomplete') {
    return NextResponse.json({ error: r.missing === 'email' ? 'Confirm your email first.' : 'Finish your details first.' }, { status: 409 })
  }
  return NextResponse.json({ ok: true })
}
