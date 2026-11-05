import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, intakeRule } from '@/lib/rateLimit'
import { requireCrewMember } from '@/lib/crew/auth'
import { requestEmailConfirm } from '@/lib/crew/emailConfirm'

export const dynamic = 'force-dynamic'

/** Onboarding: mail a 6-digit code to the address the member typed. */
export async function POST(req: NextRequest) {
  const limited = guardRate(req, intakeRule('crew/me/email/request'))
  if (limited) return limited
  const gate = await requireCrewMember(req, 'onboarding')
  if (!gate.ok) return gate.response

  const body = await req.json().catch(() => ({}))
  const r = await requestEmailConfirm(getSupabase(), gate.member.id, body?.email)
  switch (r.kind) {
    case 'sent': return NextResponse.json({ ok: true })
    case 'invalid': return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
    case 'taken': return NextResponse.json({ error: 'That email is already used by someone on the crew.' }, { status: 409 })
    case 'rate_limited': return NextResponse.json({ error: 'Too many codes. Try again in an hour.' }, { status: 429 })
    default:
      console.error('crew/me/email/request:', r.error)
      return NextResponse.json({ error: 'We could not send a code just now. Try again.' }, { status: 503 })
  }
}
