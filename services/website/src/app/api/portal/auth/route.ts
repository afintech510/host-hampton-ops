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

  const ref = req.nextUrl.searchParams.get('ref')
  const token = req.nextUrl.searchParams.get('token')

  if (!ref || !token) {
    return loginRedirect('invalid')
  }

  const supabase = getSupabase()
  const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'

  // Look up the booking and its portal tokens
  const { data: booking } = await supabase
    .from('bookings')
    .select('id')
    .eq('booking_ref', ref)
    .single()

  if (!booking) {
    return loginRedirect('not_found')
  }

  // Find a valid token
  const { data: tokens } = await supabase
    .from('portal_tokens')
    .select('token_hash, expires_at')
    .eq('booking_id', booking.id)
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: false })

  let valid = false
  for (const t of (tokens || [])) {
    if (validatePortalToken(ref, token, secret, t.token_hash)) {
      valid = true
      break
    }
  }

  if (!valid) {
    return loginRedirect('expired')
  }

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
