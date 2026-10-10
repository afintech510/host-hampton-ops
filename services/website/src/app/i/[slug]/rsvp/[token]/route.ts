import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { eviteRsvpRule, guardRate } from '@/lib/rateLimit'
import { publicOrigin } from '@/lib/publicOrigin'
import { resolveEviteBySlug } from '@/lib/evites/resolve'
import { verifyEditToken } from '@/lib/evites/rsvpToken'
import { setRsvpCookie } from '@/lib/evites/rsvpHttp'

/**
 * An RSVP edit link (spec §7.1, §7.5): `GET /i/<slug>/rsvp/<token>`, the link in a
 * guest's reminder email ("Plans changed? Update your RSVP") and, with `?stop=1`,
 * "Stop reminders".
 *
 *   valid token for THIS slug's invitation -> set the RSVP cookie, 303 to /i/<slug>?edit=1
 *   valid token + ?stop=1                  -> record `reminder_opt_out_at` FIRST, then 303 to /i/<slug>?stopped=1
 *   anything else                          -> 303 to /i/<slug>
 *
 * A forged, expired, revoked, other-party and unknown token all answer the same
 * redirect: a failed link and an unknown link say the same thing (AGENTS.md), so
 * the route is not an oracle for which RSVP ids exist.
 *
 * Absolute redirect URLs come from `publicOrigin(req)` (the allow-list), never the
 * raw `Host` / `X-Forwarded-Host`. The rate limiter is the first statement.
 *
 * "Reminders stopped" is only ever shown after the write was READ BACK as having
 * succeeded; a failed write is a 503 that says it did not work.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Params = { params: { slug: string; token: string } }

function see(req: NextRequest, path: string): NextResponse {
  const res = NextResponse.redirect(new URL(path, publicOrigin(req)), 303)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

const STOP_FAILED_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<meta name="robots" content="noindex, nofollow"><title>Please try again</title></head>' +
  '<body style="font-family:system-ui,sans-serif;max-width:30rem;margin:3rem auto;padding:0 1rem">' +
  '<h1 style="font-size:1.25rem">We couldn’t stop your reminders just now</h1>' +
  '<p>Please try the link again in a moment. If it keeps failing, call us on (631) 998-9325.</p></body></html>'

export async function GET(req: NextRequest, { params }: Params) {
  const limited = guardRate(req, eviteRsvpRule)
  if (limited) return limited

  const home = `/i/${params.slug}`
  const supabase = getSupabase()
  const now = new Date()

  let resolved
  try {
    resolved = await resolveEviteBySlug(supabase, params.slug, { now })
  } catch (e) {
    console.error(`i/rsvp/token: ${e instanceof Error ? e.message : String(e)}`)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
  if (resolved.kind !== 'ok') return see(req, home)
  const eviteId = resolved.evite.id

  const verified = await verifyEditToken(supabase, params.token, eviteId, now)
  if (!verified.ok) {
    if (verified.reason === 'unavailable') return NextResponse.json({ error: 'Something went wrong' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
    return see(req, home)
  }

  const stop = req.nextUrl.searchParams.get('stop') === '1'
  if (stop) {
    // Conditional on "not already stopped" so the original timestamp survives a second click; zero rows is fine
    // (the token just proved the row exists), an error is not.
    const written = await supabase
      .from('evite_rsvps')
      .update({ reminder_opt_out_at: now.toISOString() })
      .eq('id', verified.rsvpId)
      .eq('evite_id', eviteId)
      .is('reminder_opt_out_at', null)
      .select('id')
    if (written.error) {
      console.error(`i/rsvp/token: could not record the reminder opt-out: ${written.error.message}`)
      return new NextResponse(STOP_FAILED_HTML, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
    }
  }

  const res = see(req, stop ? `${home}?stopped=1` : `${home}?edit=1`)
  setRsvpCookie(res, req, eviteId, params.token, verified.exp, now)
  return res
}
