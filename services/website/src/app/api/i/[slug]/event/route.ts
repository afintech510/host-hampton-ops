import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { eviteViewRule, guardRate } from '@/lib/rateLimit'
import { resolveEviteBySlug } from '@/lib/evites/resolve'
import { isPublicBeaconEvent, recordEviteEvent, sendMetaViewContent } from '@/lib/evites/analytics'

/**
 * The invitation's analytics beacon (spec §7.1, §11). Public, unauthenticated.
 *
 *   POST { event: 'invite_viewed' | 'rsvp_started' }  ->  204
 *
 * - `guardRate` FIRST, before anything reads the database, on the SAME rule as
 *   the page (`eviteViewRule`): this route answers 404 for a slug that is not
 *   available and 204 for one that is, so it is the same enumeration oracle as
 *   the page and must sit inside the same ceiling.
 * - The allow-list is two events. The other five `evite_events` are written by
 *   the server on the action itself, never reported by a browser.
 * - `invite_viewed` is deduped by an `hh_iv_<first 8 of the evite id>` cookie
 *   (24 h), set here because a route handler may set cookies and a page may not.
 *   A repeat inside the window is a 204 that records and sends nothing.
 * - On a first `invite_viewed` it also tells Meta (server-side, cleaned URL, no
 *   slug or name; see lib/evites/analytics.ts). Fire-and-forget: the 204 never
 *   waits for Meta, and `sendMetaViewContent` cannot reject.
 * - An unknown, archived, cancelled, switched-off or aliased slug is 404, the same
 *   answer for all of them. A read error is 500.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const VIEW_COOKIE_MAX_AGE_S = 24 * 60 * 60

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const limited = guardRate(req, eviteViewRule)
  if (limited) return limited

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const event = (body as { event?: unknown } | null)?.event
  if (!isPublicBeaconEvent(event)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  let resolved
  try {
    resolved = await resolveEviteBySlug(getSupabase(), params.slug)
  } catch (e) {
    console.error(`api/i/event: ${e instanceof Error ? e.message : String(e)}`)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
  // 'redirect' (an old slug) is 404 here too: the page 308s, and the new page fires its own beacon.
  if (resolved.kind !== 'ok') return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const eviteId = resolved.evite.id
  const cookieName = `hh_iv_${eviteId.replace(/-/g, '').slice(0, 8)}`
  const noContent = (): NextResponse => {
    const res = new NextResponse(null, { status: 204 })
    res.headers.set('Cache-Control', 'no-store')
    return res
  }

  if (event === 'rsvp_started') {
    await recordEviteEvent(getSupabase(), eviteId, 'rsvp_started')
    return noContent()
  }

  // invite_viewed
  if (req.cookies.get(cookieName)) return noContent()

  await recordEviteEvent(getSupabase(), eviteId, 'invite_viewed')
  void sendMetaViewContent(req)

  const res = noContent()
  res.cookies.set(cookieName, '1', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: VIEW_COOKIE_MAX_AGE_S,
  })
  return res
}
