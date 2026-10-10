import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { eviteViewRule, guardRate } from '@/lib/rateLimit'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { resolveEviteBySlug } from '@/lib/evites/resolve'
import { recordEviteEvent } from '@/lib/evites/analytics'
import { buildIcs, googleCalendarUrl } from '@/lib/evites/ics'

/**
 * "Add to calendar" (spec §7.1, §8): `GET /i/<slug>/cal`.
 *
 *   Apple user agent (iPhone | iPad | Macintosh), or ?format=ics  -> the .ics, text/calendar
 *   anyone else                                                   -> 302 to Google Calendar's prefilled form
 *   not `live` with a start time (preview, needs_time, closed) or any unavailable invitation -> 404
 *
 * Rate-limited FIRST on the page's own rule (`eviteViewRule`): it answers 404 vs
 * 200/302 and is therefore the same enumeration oracle as the page.
 *
 * `calendar_added` is recorded without making the guest wait for it: the write
 * never throws, and the response is held for at most `EVENT_WAIT_MS` for it.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const APPLE_UA = /iPhone|iPad|Macintosh/
const EVENT_WAIT_MS = 300

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })

/** Resolve when the work is done or after `ms`, whichever is first. Never rejects. */
async function boundedWait(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  })
  try {
    await Promise.race([work.then(() => undefined, () => undefined), stop])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const limited = guardRate(req, eviteViewRule)
  if (limited) return limited

  const supabase = getSupabase()
  let resolved
  try {
    resolved = await resolveEviteBySlug(supabase, params.slug)
  } catch (e) {
    console.error(`i/cal: ${e instanceof Error ? e.message : String(e)}`)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
  if (resolved.kind !== 'ok' || resolved.state !== 'live' || !resolved.facts.window) return NOT_FOUND()

  // The ICS SEQUENCE is the evite's cal_version, which the public page's column list deliberately does not carry.
  const cv = await supabase.from('evites').select('cal_version').eq('id', resolved.evite.id).maybeSingle()
  if (cv.error || !cv.data) {
    console.error(`i/cal: cal_version read failed: ${cv.error?.message ?? 'no row'}`)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
  const calVersion = Number((cv.data as { cal_version?: unknown }).cal_version)
  const evite = { id: resolved.evite.id, cal_version: Number.isInteger(calVersion) && calVersion >= 0 ? calVersion : 0 }
  const inviteUrl = `${CANONICAL_ORIGIN}/i/${params.slug}`

  const recording = recordEviteEvent(supabase, evite.id, 'calendar_added')

  const wantsIcs = req.nextUrl.searchParams.get('format') === 'ics' || APPLE_UA.test(req.headers.get('user-agent') ?? '')
  if (wantsIcs) {
    const body = buildIcs(resolved.facts, evite, inviteUrl, { method: 'PUBLISH' })
    await boundedWait(recording, EVENT_WAIT_MS)
    return new NextResponse(body, {
      status: 200,
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'attachment; filename="party.ics"',
        'Cache-Control': 'no-store',
      },
    })
  }

  const target = googleCalendarUrl(resolved.facts, inviteUrl)
  await boundedWait(recording, EVENT_WAIT_MS)
  const res = NextResponse.redirect(target, 302)
  res.headers.set('Cache-Control', 'no-store')
  return res
}
