import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, costlyRule } from '@/lib/rateLimit'
import { requireCrewMember } from '@/lib/crew/auth'
import { startAgreement } from '@/lib/crew/agreement'
import { getMember } from '@/lib/crew/db'

export const dynamic = 'force-dynamic'

/**
 * Open (or reopen) the subcontractor agreement for signing. Creates a SignWell
 * document only when this member has none for the current version — a reopen
 * reuses it, because the account has a monthly document allowance.
 * `costlyRule`: every call that creates one spends it.
 */
export async function POST(req: NextRequest) {
  const limited = guardRate(req, costlyRule('crew/me/agreement', 6, 60))
  if (limited) return limited
  const gate = await requireCrewMember(req, 'onboarding')
  if (!gate.ok) return gate.response

  const sb = getSupabase()
  const fresh = await getMember(sb, gate.member.id)
  if (fresh.kind !== 'ok' || !fresh.data) return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })

  const r = await startAgreement(sb, fresh.data)
  switch (r.kind) {
    case 'ready': return NextResponse.json({ signingUrl: r.signingUrl })
    case 'already_signed': return NextResponse.json({ alreadySigned: true })
    case 'disabled': return NextResponse.json({ error: 'Not found' }, { status: 404 })
    case 'not_ready': return NextResponse.json({ error: 'Finish your details first.' }, { status: 409 })
    default:
      console.error('crew/me/agreement:', r.error)
      return NextResponse.json({ error: 'We could not open the agreement just now. Try again.' }, { status: 503 })
  }
}
