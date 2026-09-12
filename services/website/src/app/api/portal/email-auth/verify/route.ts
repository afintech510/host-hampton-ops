import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { verifyEmailLoginCode, setEmailCookieHeader, getEmailCodeMaxAttempts } from '@/lib/portalAuth'
import { isLocalRequest } from '@/lib/publicOrigin'
import { isPlausibleEmailAddress } from '@/lib/contactLookup'

/**
 * Verify a 6-digit email login code.
 *
 * On success: consumes the code and sets the `hh_portal_email` cookie.
 * On failure: burns one of five attempts on that code.
 *
 * ── Why the attempt is CLAIMED and not merely counted ────────────────────
 *
 * This route used to read `attempts`, compare the code, and then write
 * `attempts + 1` — check-then-act, straddling the thing it was limiting.
 * Measured against production on 2026-09-12: **twelve concurrent wrong codes
 * recorded three attempts.** The five-guess lock therefore bound only a
 * customer who waited their turn; an attacker firing in parallel had the whole
 * fifteen-minute window against a six-digit space, and the separate
 * three-codes-an-hour limit is keyed on the email STRING, so a new bucket costs
 * nothing.
 *
 * The claim below is the same shape `scheduled_reminders` and
 * `email_sequence_sends` already use: one conditional UPDATE, taken BEFORE the
 * comparison, that both increments and enforces. Zero rows back means the code
 * was already at its limit — somebody else's guess got there first, which is
 * exactly what should stop this one.
 *
 * The cost of claiming first is that a CORRECT code also burns an attempt. That
 * is harmless: a correct code is consumed on the same request.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const submittedCode = typeof body.code === 'string' ? body.code.trim() : ''

    // The address is about to go into a session cookie that other routes use as
    // a lookup key, so it has to be an address and not a pattern. `%@gmail.com`
    // passed the old `includes('@')` test.
    if (!isPlausibleEmailAddress(rawEmail)) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 })
    }
    if (!/^\d{6}$/.test(submittedCode)) {
      return NextResponse.json({ error: 'Enter the 6-digit code' }, { status: 400 })
    }

    const supabase = getSupabase()
    const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
    const maxAttempts = getEmailCodeMaxAttempts()

    // Find the newest unconsumed unexpired code for this email
    const { data: row, error: readErr } = await supabase
      .from('email_auth_codes')
      .select('id, code_hash, expires_at, attempts')
      .eq('email', rawEmail)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Rule 12. "We cannot read the codes table" is not "your code is wrong" —
    // and telling a customer to request a new one would only fail again.
    if (readErr) {
      console.error('email-auth/verify: code read failed:', readErr.message)
      return NextResponse.json({ error: 'We could not check that code just now — try again.' }, { status: 503 })
    }
    if (!row) {
      return NextResponse.json({ error: 'Code expired or not found. Request a new one.' }, { status: 400 })
    }

    // ── The claim ─────────────────────────────────────────────────────────
    const { data: claimed, error: claimErr } = await supabase
      .from('email_auth_codes')
      .update({ attempts: row.attempts + 1 })
      .eq('id', row.id)
      .eq('attempts', row.attempts)      // nobody else has guessed since we read
      .lt('attempts', maxAttempts)       // and we are still inside the budget
      .select('id, attempts')
      .maybeSingle()

    if (claimErr) {
      console.error('email-auth/verify: attempt claim failed:', claimErr.message)
      return NextResponse.json({ error: 'We could not check that code just now — try again.' }, { status: 503 })
    }
    if (!claimed) {
      // Either the budget is spent or a concurrent guess moved the counter.
      // Both mean this request does not get to compare a code. Re-read to say
      // which, and lock the row if it is genuinely spent.
      const { data: now, error: nowErr } = await supabase
        .from('email_auth_codes')
        .select('attempts')
        .eq('id', row.id)
        .maybeSingle()
      // An unreadable counter counts as spent: under-admitting is the safe
      // direction on a login, and the customer can request a fresh code.
      if (nowErr) console.error('email-auth/verify: attempt re-read failed:', nowErr.message)
      if ((now?.attempts ?? maxAttempts) >= maxAttempts) {
        const { error: lockErr } = await supabase
          .from('email_auth_codes')
          .update({ consumed_at: new Date().toISOString() })
          .eq('id', row.id)
        if (lockErr) console.error('email-auth/verify: could not lock a spent code:', lockErr.message)
        return NextResponse.json({ error: 'Too many attempts on this code. Request a new one.' }, { status: 400 })
      }
      return NextResponse.json({ error: 'Wrong code. Try again in a moment.' }, { status: 429 })
    }

    const ok = verifyEmailLoginCode(submittedCode, rawEmail, row.code_hash, secret)
    if (!ok) {
      const remaining = maxAttempts - claimed.attempts
      return NextResponse.json({
        error: remaining > 0
          ? `Wrong code. ${remaining} attempt${remaining === 1 ? '' : 's'} left.`
          : 'Wrong code. This code is now locked — request a new one.',
      }, { status: 400 })
    }

    // Consume it. The attempt was already charged by the claim above.
    const { error: consumeErr } = await supabase
      .from('email_auth_codes')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('consumed_at', null)
    if (consumeErr) {
      // A code we cannot mark used must not hand out a session, or it is a
      // reusable one. Rule 19: read the write.
      console.error('email-auth/verify: could not consume code:', consumeErr.message)
      return NextResponse.json({ error: 'We could not complete sign-in — request a new code.' }, { status: 503 })
    }

    const isLocal = isLocalRequest(req)
    const cookie = setEmailCookieHeader(rawEmail, secret, isLocal)

    const response = NextResponse.json({ ok: true, email: rawEmail })
    response.headers.set('Set-Cookie', cookie)
    return response
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'verify failed'
    console.error('email-auth/verify error:', msg)
    // Never echo an internal message to a public login endpoint.
    return NextResponse.json({ error: 'Sign-in is unavailable right now — try again.' }, { status: 500 })
  }
}
