import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { validatePortalToken, setPortalCookieHeader } from '@/lib/portalAuth'
import { publicOrigin, isLocalRequest } from '@/lib/publicOrigin'

export async function GET(req: NextRequest) {
  // Behind nginx + Docker, req.url carries the CONTAINER's host (e.g.
  // https://157ef52a9f15:3002), which does not resolve from a customer's
  // browser. Every redirect out of this route — success AND failure — has to be
  // built from the forwarded host, or a failed link dead-ends on a browser
  // "site can't be reached" page instead of the login/resend form.
  //
  // …but the forwarded host is whatever the CALLER typed (nginx never sets
  // `X-Forwarded-Host`), so it goes through the allowlist first. Until
  // 2026-09-12 this route was a plain open redirect: measured in production,
  // `-H 'X-Forwarded-Host: evil.example.com'` moved the 307 to that host.
  const origin = publicOrigin(req)
  const isLocal = isLocalRequest(req)
  const loginRedirect = (error: string) =>
    NextResponse.redirect(new URL(`/my-booking/login?error=${error}`, origin))

  // ── One outcome for every kind of "this link did not work" ──────────────
  //
  // This route used to answer `error=not_found` when the ref named no booking
  // and `error=expired` when it named one whose token did not match. Measured
  // in production before the fix:
  //
  //   ?ref=HH-2026-0001  -> error=not_found      (no such booking)
  //   ?ref=HH-PTY-Q8FKB  -> error=expired        (a real customer's booking)
  //
  // Unauthenticated, unthrottled, and booking refs are structured — so that is
  // an oracle for enumerating every real booking ref in the `HH-2026-` space.
  // `/review/[token]` was deliberately built the other way ("an expired link is
  // a 404, like a wrong one, because 'this link expired' confirms the draft
  // exists"); this route is the same decision made twice, differently.
  //
  // `expired` is the label kept, because it is the one whose copy on the login
  // page is right for all three cases — all of them end at "get a fresh one
  // below". `invalid` still means the REQUEST was malformed, which tells a
  // caller nothing about our data.
  const linkFailed = () => loginRedirect('expired')
  /** Rule 12: a failed read is not a wrong link, and must not look like one. */
  const unavailable = () => loginRedirect('unavailable')

  const ref = req.nextUrl.searchParams.get('ref')
  const token = req.nextUrl.searchParams.get('token')

  if (!ref || !token) {
    return loginRedirect('invalid')
  }

  const supabase = getSupabase()
  const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'

  // Look up the booking and its portal tokens
  const { data: booking, error: bookingErr } = await supabase
    .from('bookings')
    .select('id')
    .eq('booking_ref', ref)
    .maybeSingle()

  if (bookingErr) {
    console.error('portal auth: booking read failed for', ref, '—', bookingErr.message)
    return unavailable()
  }
  if (!booking) {
    return linkFailed()
  }

  // Find a valid token
  const { data: tokens, error: tokenErr } = await supabase
    .from('portal_tokens')
    .select('id, token_hash, expires_at')
    .eq('booking_id', booking.id)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })

  if (tokenErr) {
    console.error('portal auth: token read failed for', ref, '—', tokenErr.message)
    return unavailable()
  }

  let matched: { id: string } | null = null
  for (const t of (tokens || [])) {
    if (validatePortalToken(ref, token, secret, t.token_hash)) {
      matched = { id: t.id as string }
      break
    }
  }

  if (!matched) {
    return linkFailed()
  }

  // ── Record that the link was used ──────────────────────────────────────
  //
  // `portal_tokens.used_at` has existed since the table did and **had never
  // been written**: 230 rows, 0 with a value, measured 2026-09-12. So nothing
  // anywhere could answer "has this emailed link been opened, and when" — the
  // one column that would hold the evidence was dead (rule 17).
  //
  // Deliberately NOT single-use. A magic link lives in an email a customer
  // re-opens, and burning it on first click turns every second visit into a
  // support call. What single-use would have bought is visibility, and stamping
  // the column buys that without the cost.
  await supabase
    .from('portal_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', matched.id)
    .is('used_at', null)
    .then(({ error }) => {
      // Non-fatal: a customer with a valid token gets in either way. But the
      // failure is named rather than discarded (rule 19).
      if (error) console.error('portal auth: could not stamp used_at:', error.message)
    })

  // Set cookie and redirect to portal (or custom redirect)
  const redirectTo = req.nextUrl.searchParams.get('redirect')
  const allowedRedirects = ['/my-booking', '/party-builder', '/party-planner']
  // The Phase 5 invoice page is per-plan, so it cannot be a fixed entry in the
  // allowlist. It is matched against the ref THIS request just authenticated
  // rather than against any ref, which keeps the allowlist's guarantee intact:
  // a redirect can only ever land on the plan the token was good for, so this
  // stays closed as a redirector even though the path is dynamic.
  const summaryForThisRef = `/plan/${ref}/summary`
  const isAllowed =
    !!redirectTo && (allowedRedirects.includes(redirectTo) || redirectTo === summaryForThisRef)
  const destination = isAllowed ? (redirectTo as string) : '/party-planner'
  const response = NextResponse.redirect(new URL(destination, origin))
  response.headers.set('Set-Cookie', setPortalCookieHeader(ref, secret, isLocal))

  return response
}
