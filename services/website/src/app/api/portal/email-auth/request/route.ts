import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { generateEmailLoginCode, hashEmailLoginCode } from '@/lib/portalAuth'
import { emailAuthCodeHtml } from '@/lib/emailTemplates'
import { findBookingsByContactEmail, isPlausibleEmailAddress } from '@/lib/contactLookup'

/**
 * Request a 6-digit email login code.
 * Always returns { ok: true } regardless of whether the email has bookings —
 * this avoids email-enumeration. The code is only sent if at least one
 * booking exists for that email (otherwise there's nothing to log into).
 *
 * Rate limit: max 3 codes per email per hour.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    // `includes('@') && length >= 5` used to be the whole test, which accepted
    // `%@gmail.com` — and the `ilike` below took that as a LIKE PATTERN, so it
    // matched 40 of 61 bookings and minted a code row for a string that is not
    // an address. See lib/contactLookup.ts.
    if (!isPlausibleEmailAddress(rawEmail)) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
    }

    const supabase = getSupabase()
    const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'

    // Rate limit: count requests in the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count: recentCount, error: countErr } = await supabase
      .from('email_auth_codes')
      .select('id', { count: 'exact', head: true })
      .eq('email', rawEmail)
      .gte('created_at', oneHourAgo)

    // A rate limit that cannot read its own counter must decline, not wave
    // everything through — a blip is otherwise the way around it.
    if (countErr) {
      console.error('email-auth/request: rate-limit read failed:', countErr.message)
      return NextResponse.json({ error: 'We could not send a code just now — try again.' }, { status: 503 })
    }
    if ((recentCount ?? 0) >= 3) {
      console.warn(`email-auth/request: rate limit hit for ${rawEmail} (${recentCount} in last hour)`)
      return NextResponse.json({ error: 'Too many sign-in attempts. Try again in an hour.' }, { status: 429 })
    }

    // Confirm there's at least one booking for this email — if not, return ok
    // anyway (to prevent email enumeration) but skip the send. The lookup
    // re-compares in JS; `ilike` alone is a pattern match, not an answer.
    const lookup = await findBookingsByContactEmail(supabase, rawEmail, 'id, booking_ref, contact_email')
    if (lookup.kind === 'unavailable') {
      console.error('email-auth/request: booking read failed:', lookup.error)
      return NextResponse.json({ error: 'We could not send a code just now — try again.' }, { status: 503 })
    }

    if (lookup.kind === 'absent') {
      console.warn(`email-auth/request: no booking found for ${rawEmail} — skipping send`)
      // Stall briefly to make timing indistinguishable from the send path
      await new Promise(r => setTimeout(r, 250))
      return NextResponse.json({ ok: true })
    }

    // Generate + store the code
    const { code, expiresAt } = generateEmailLoginCode()
    const codeHash = hashEmailLoginCode(code, rawEmail, secret)
    const { error: insErr } = await supabase.from('email_auth_codes').insert({
      email: rawEmail,
      code_hash: codeHash,
      expires_at: expiresAt.toISOString(),
    })
    // Rule 19: this insert's error was discarded. A code that was never stored
    // can never be verified, so mailing it and answering `{ok:true}` sends the
    // customer to wait for something that could not have worked.
    if (insErr) {
      console.error('email-auth/request: could not store the code:', insErr.message)
      return NextResponse.json({ error: 'We could not send a code just now — try again.' }, { status: 503 })
    }

    // ── Send it, and do not claim a send that did not happen ───────────────
    //
    // Rule 10's expensive half. This branch used to answer `{ok:true}` — the
    // "Check your email!" screen — after an unset API key or a provider
    // rejection. On a LOGIN surface that leaves the customer waiting for
    // something that was never sent, which is the same defect as the
    // unsubscribe endpoint answering 200 over a write that never happened.
    //
    // Yes, a 503 here is reachable only for an address that HAS a booking, so
    // it is a weak enumeration signal. That trade is made deliberately: the
    // alternative is a customer who cannot sign in and is told they can, and
    // the timing of the two branches already differs by a live API call.
    let delivered = false
    let failure = 'RESEND_API_KEY is not set'
    if (process.env.RESEND_API_KEY) {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
      const sendRes = await resend.emails.send({
        from,
        to: rawEmail,
        subject: `Your Host Hampton sign-in code: ${code}`,
        html: emailAuthCodeHtml({ code, expiresMinutes: 15 }),
      }).catch(err => ({ error: err }))
      const sendErr = (sendRes as { error?: unknown }).error
      if (sendErr) {
        failure = sendErr instanceof Error ? sendErr.message : String(sendErr)
      } else {
        delivered = true
      }
    }

    if (!delivered) {
      console.error('email-auth/request: code NOT sent to', rawEmail, '—', failure)
      // Retire the code nobody can have received, so it does not sit in the way
      // of the next request's "newest unconsumed" read.
      const { error: retireErr } = await supabase
        .from('email_auth_codes')
        .update({ consumed_at: new Date().toISOString() })
        .eq('email', rawEmail)
        .is('consumed_at', null)
      if (retireErr) console.error('email-auth/request: could not retire the unsent code:', retireErr.message)
      return NextResponse.json({ error: 'We could not send a code just now — try again.' }, { status: 503 })
    }

    console.log('email-auth/request: code sent to', rawEmail)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'request failed'
    console.error('email-auth/request error:', msg)
    // Never echo an internal message to a public login endpoint.
    return NextResponse.json({ error: 'Sign-in is unavailable right now — try again.' }, { status: 500 })
  }
}
