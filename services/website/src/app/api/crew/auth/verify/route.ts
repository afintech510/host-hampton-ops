import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { getEmailCodeMaxAttempts, portalSigningSecret, verifyEmailLoginCode } from '@/lib/portalAuth'
import { findCrewMembersByEmail, isPlausibleEmailAddress } from '@/lib/contactLookup'
import { isLocalRequest } from '@/lib/publicOrigin'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { crewAppOpen, crewMemberMayEnter } from '@/lib/crew/settings'
import { setCrewCookieHeader } from '@/lib/crew/auth'

export const dynamic = 'force-dynamic'

/**
 * Crew login, step 2: check the code and set `hh_crew` (spec §5).
 *
 * The attempt is CLAIMED before the comparison, exactly as
 * `/api/portal/email-auth/verify` does it: one conditional UPDATE that both
 * increments and enforces the five-guess budget, so parallel guesses cannot
 * share one attempt. See that route for the measurement that made it so.
 */
export async function POST(req: NextRequest) {
  if (!crewAppOpen()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const limited = guardRate(req, plannerRule('crew/auth/verify'))
  if (limited) return limited

  try {
    const body = await req.json().catch(() => ({}))
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    if (!isPlausibleEmailAddress(email)) return NextResponse.json({ error: 'Enter your email address.' }, { status: 400 })
    if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 })

    const supabase = getSupabase()
    const notFound = NextResponse.json({ error: 'That code has expired. Ask for a new one.' }, { status: 400 })

    const lookup = await findCrewMembersByEmail(supabase, email, 'id, email, status, is_owner, is_test')
    if (lookup.kind === 'unavailable') {
      console.error('crew/auth/verify: member read failed:', lookup.error)
      return NextResponse.json({ error: 'We could not check that code just now. Try again.' }, { status: 503 })
    }
    const member = lookup.kind === 'found' ? (lookup.primary as unknown as { id: string; status: string; is_owner: boolean; is_test: boolean }) : null
    if (!member || !crewMemberMayEnter(member)) return notFound

    const maxAttempts = getEmailCodeMaxAttempts()
    const { data: row, error: readErr } = await supabase
      .from('crew_login_codes')
      .select('id, code_hash, attempts')
      .eq('member_id', member.id)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (readErr) {
      console.error('crew/auth/verify: code read failed:', readErr.message)
      return NextResponse.json({ error: 'We could not check that code just now. Try again.' }, { status: 503 })
    }
    if (!row) return notFound

    // ── The claim ──
    const { data: claimed, error: claimErr } = await supabase
      .from('crew_login_codes')
      .update({ attempts: row.attempts + 1 })
      .eq('id', row.id)
      .eq('attempts', row.attempts)
      .lt('attempts', maxAttempts)
      .select('id, attempts')
      .maybeSingle()
    if (claimErr) {
      console.error('crew/auth/verify: attempt claim failed:', claimErr.message)
      return NextResponse.json({ error: 'We could not check that code just now. Try again.' }, { status: 503 })
    }
    if (!claimed) {
      const { data: now, error: nowErr } = await supabase.from('crew_login_codes').select('attempts').eq('id', row.id).maybeSingle()
      if (nowErr) console.error('crew/auth/verify: attempt re-read failed:', nowErr.message)
      if ((now?.attempts ?? maxAttempts) >= maxAttempts) {
        const { error: lockErr } = await supabase.from('crew_login_codes')
          .update({ consumed_at: new Date().toISOString() }).eq('id', row.id).select('id')
        if (lockErr) console.error('crew/auth/verify: could not lock a spent code:', lockErr.message)
        return NextResponse.json({ error: 'Too many tries on this code. Ask for a new one.' }, { status: 400 })
      }
      return NextResponse.json({ error: 'Wrong code. Try again in a moment.' }, { status: 429 })
    }

    const secret = portalSigningSecret()
    if (!verifyEmailLoginCode(code, `crew-member:${member.id}`, row.code_hash, secret)) {
      const left = maxAttempts - claimed.attempts
      return NextResponse.json({
        error: left > 0 ? `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Wrong code. Ask for a new one.',
      }, { status: 400 })
    }

    const { data: consumed, error: consumeErr } = await supabase
      .from('crew_login_codes')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('consumed_at', null)
      .select('id')
      .maybeSingle()
    // A code we cannot mark used must not hand out a session, or it is reusable.
    if (consumeErr || !consumed) {
      if (consumeErr) console.error('crew/auth/verify: could not consume code:', consumeErr.message)
      return NextResponse.json({ error: 'We could not finish signing you in. Ask for a new code.' }, { status: 503 })
    }

    const res = NextResponse.json({ ok: true })
    res.headers.set('Set-Cookie', setCrewCookieHeader(member.id, secret, isLocalRequest(req)))
    return res
  } catch (err: unknown) {
    console.error('crew/auth/verify error:', err instanceof Error ? err.message : 'failed')
    return NextResponse.json({ error: 'Sign-in is unavailable right now. Try again.' }, { status: 500 })
  }
}
