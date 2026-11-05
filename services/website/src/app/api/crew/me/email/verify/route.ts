import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { requireCrewMember } from '@/lib/crew/auth'
import { verifyEmailConfirm } from '@/lib/crew/emailConfirm'

export const dynamic = 'force-dynamic'

/** Onboarding: check the code and store the confirmed address on the member. */
export async function POST(req: NextRequest) {
  const limited = guardRate(req, plannerRule('crew/me/email/verify'))
  if (limited) return limited
  const gate = await requireCrewMember(req, 'onboarding')
  if (!gate.ok) return gate.response

  const body = await req.json().catch(() => ({}))
  const r = await verifyEmailConfirm(getSupabase(), gate.member.id, body?.code)
  switch (r.kind) {
    case 'confirmed': return NextResponse.json({ ok: true, email: r.email })
    case 'wrong': return NextResponse.json({ error: r.triesLeft > 0 ? `Wrong code. ${r.triesLeft} ${r.triesLeft === 1 ? 'try' : 'tries'} left.` : 'Enter the 6-digit code.' }, { status: 400 })
    case 'expired': return NextResponse.json({ error: 'That code has expired. Ask for a new one.' }, { status: 400 })
    case 'locked': return NextResponse.json({ error: 'Too many tries on this code. Ask for a new one.' }, { status: 400 })
    case 'busy': return NextResponse.json({ error: 'Wrong code. Try again in a moment.' }, { status: 429 })
    case 'taken': return NextResponse.json({ error: 'That email is already used by someone on the crew.' }, { status: 409 })
    default:
      console.error('crew/me/email/verify:', r.error)
      return NextResponse.json({ error: 'We could not check that code just now. Try again.' }, { status: 503 })
  }
}
