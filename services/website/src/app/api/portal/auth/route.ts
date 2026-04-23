import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { validatePortalToken, setPortalCookieHeader } from '@/lib/portalAuth'

export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get('ref')
  const token = req.nextUrl.searchParams.get('token')

  if (!ref || !token) {
    return NextResponse.redirect(new URL('/my-booking/login?error=invalid', req.url))
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
    return NextResponse.redirect(new URL('/my-booking/login?error=not_found', req.url))
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
    return NextResponse.redirect(new URL('/my-booking/login?error=expired', req.url))
  }

  // Set cookie and redirect to portal
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  const response = NextResponse.redirect(new URL('/my-booking', `https://${host}`))
  response.headers.set('Set-Cookie', setPortalCookieHeader(ref, secret))

  return response
}
