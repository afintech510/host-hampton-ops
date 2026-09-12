import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { verifyEmailLoginCode, setEmailCookieHeader, getEmailCodeMaxAttempts } from '@/lib/portalAuth'
import { isLocalRequest } from '@/lib/publicOrigin'

/**
 * Verify a 6-digit email login code.
 * On success: increments attempts, marks the code consumed, and sets the
 * hh_portal_email cookie (30-day TTL).
 *
 * Failures: increments attempts. After 5 failed attempts on a code it's
 * locked and the customer must request a new one.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const rawEmail = (body.email as string | undefined)?.trim().toLowerCase()
    const submittedCode = (body.code as string | undefined)?.trim()

    if (!rawEmail || !rawEmail.includes('@')) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 })
    }
    if (!submittedCode || !/^\d{6}$/.test(submittedCode)) {
      return NextResponse.json({ error: 'Enter the 6-digit code' }, { status: 400 })
    }

    const supabase = getSupabase()
    const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'

    // Find the newest unconsumed unexpired code for this email
    const { data: row } = await supabase
      .from('email_auth_codes')
      .select('id, code_hash, expires_at, attempts')
      .eq('email', rawEmail)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!row) {
      return NextResponse.json({ error: 'Code expired or not found. Request a new one.' }, { status: 400 })
    }

    const maxAttempts = getEmailCodeMaxAttempts()
    if (row.attempts >= maxAttempts) {
      // Lock it out — mark consumed so it can't be reused
      await supabase.from('email_auth_codes').update({ consumed_at: new Date().toISOString() }).eq('id', row.id)
      return NextResponse.json({ error: 'Too many attempts on this code. Request a new one.' }, { status: 400 })
    }

    const ok = verifyEmailLoginCode(submittedCode, rawEmail, row.code_hash, secret)
    if (!ok) {
      await supabase.from('email_auth_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id)
      const remaining = maxAttempts - row.attempts - 1
      return NextResponse.json({
        error: remaining > 0
          ? `Wrong code. ${remaining} attempt${remaining === 1 ? '' : 's'} left.`
          : 'Wrong code. This code is now locked — request a new one.',
      }, { status: 400 })
    }

    // Mark consumed, set cookie
    await supabase.from('email_auth_codes').update({
      consumed_at: new Date().toISOString(),
      attempts: row.attempts + 1,
    }).eq('id', row.id)

    const isLocal = isLocalRequest(req)
    const cookie = setEmailCookieHeader(rawEmail, secret, isLocal)

    const response = NextResponse.json({ ok: true, email: rawEmail })
    response.headers.set('Set-Cookie', cookie)
    return response
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'verify failed'
    console.error('email-auth/verify error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
