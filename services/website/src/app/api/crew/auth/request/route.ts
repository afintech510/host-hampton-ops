import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { generateEmailLoginCode, hashEmailLoginCode, portalSigningSecret } from '@/lib/portalAuth'
import { findCrewMembersByEmail, isPlausibleEmailAddress } from '@/lib/contactLookup'
import { guardRate, guardRecipient, intakeRule, HOUR_MS } from '@/lib/rateLimit'
import { crewAppOpen, crewMemberMayEnter } from '@/lib/crew/settings'
import { templates } from '@/lib/crew/templates'
import { sendCrewEmail } from '@/lib/crew/mail'

export const dynamic = 'force-dynamic'

/**
 * Crew login, step 1: mail a 6-digit code (spec §5). The portal's
 * `/api/portal/email-auth/request`, keyed by MEMBER rather than by address.
 *
 * Always `{ ok: true }` for an address that is not a crew member who may enter,
 * so the form never says who is on the crew. In test-only mode
 * (CREW_TEST_LOGIN without CREW_ENABLED) only `is_test` members get a code —
 * `crewMemberMayEnter` is the one answer to that.
 *
 * Bounded three ways: the caller/route limiter, a recipient bucket per member,
 * and the durable count of codes issued to that member in the last hour.
 */
export async function POST(req: NextRequest) {
  if (!crewAppOpen()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const limited = guardRate(req, intakeRule('crew/auth/request'))
  if (limited) return limited

  try {
    const body = await req.json().catch(() => ({}))
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!isPlausibleEmailAddress(email)) {
      return NextResponse.json({ error: 'Enter your email address.' }, { status: 400 })
    }

    const supabase = getSupabase()
    const lookup = await findCrewMembersByEmail(supabase, email, 'id, email, status, is_owner, is_test')
    if (lookup.kind === 'unavailable') {
      console.error('crew/auth/request: member read failed:', lookup.error)
      return NextResponse.json({ error: 'We could not send a code just now. Try again.' }, { status: 503 })
    }
    const member = lookup.kind === 'found' ? (lookup.primary as unknown as { id: string; email: string; status: string; is_owner: boolean; is_test: boolean }) : null
    if (!member || !crewMemberMayEnter(member)) {
      // Same answer, about the same time, as the send path's fast exits.
      await new Promise(r => setTimeout(r, 250))
      return NextResponse.json({ ok: true })
    }

    if (guardRecipient(`email:crew:${member.id}`, { label: 'crew-login-code', max: 3, windowMs: HOUR_MS })) {
      return NextResponse.json({ ok: true })
    }

    const since = new Date(Date.now() - HOUR_MS).toISOString()
    const { count, error: countErr } = await supabase
      .from('crew_login_codes')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', member.id)
      .gte('created_at', since)
    if (countErr) {
      console.error('crew/auth/request: code count failed:', countErr.message)
      return NextResponse.json({ error: 'We could not send a code just now. Try again.' }, { status: 503 })
    }
    if ((count ?? 0) >= 3) return NextResponse.json({ ok: true })

    const secret = portalSigningSecret()
    const { code } = generateEmailLoginCode()
    // The template promises ten minutes, so that is the code's life.
    const expiresAt = new Date(Date.now() + 10 * 60_000)
    const { error: insErr } = await supabase.from('crew_login_codes').insert({
      member_id: member.id,
      code_hash: hashEmailLoginCode(code, `crew-member:${member.id}`, secret),
      expires_at: expiresAt.toISOString(),
    }).select('id').maybeSingle()
    if (insErr) {
      console.error('crew/auth/request: could not store the code:', insErr.message)
      return NextResponse.json({ error: 'We could not send a code just now. Try again.' }, { status: 503 })
    }

    const sent = await sendCrewEmail(member.email, templates.loginCode(code))
    if (sent.kind !== 'sent') {
      console.error('crew/auth/request: code NOT sent:', sent.kind === 'failed' ? sent.error : 'RESEND_API_KEY is not set')
      const { error: retireErr } = await supabase
        .from('crew_login_codes')
        .update({ consumed_at: new Date().toISOString() })
        .eq('member_id', member.id)
        .is('consumed_at', null)
      if (retireErr) console.error('crew/auth/request: could not retire the unsent code:', retireErr.message)
      return NextResponse.json({ error: 'We could not send a code just now. Try again.' }, { status: 503 })
    }
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    console.error('crew/auth/request error:', err instanceof Error ? err.message : 'failed')
    return NextResponse.json({ error: 'Sign-in is unavailable right now. Try again.' }, { status: 500 })
  }
}
