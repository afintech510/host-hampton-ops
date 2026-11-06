import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { loadCrewSettings, crewAppOpen } from '@/lib/crew/settings'
import { getSlot, partiesByIds } from '@/lib/crew/db'
import { buildCrewIcs, crewEventFor, crewGoogleUrl, parseCrewCalendarToken, verifyCrewCalendar } from '@/lib/crew/calendar'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Add a shift to a phone calendar: `GET /crew/cal/<token>`.
 *
 *   ?format=ics                       the .ics file (text/calendar)
 *   ?format=google                    a redirect to Google Calendar's prefilled form
 *   neither: an Apple device (iPhone, iPad, Mac) gets the file, anything else gets Google.
 *
 * The token is the only credential, because this is opened from a text message
 * with no signed-in session: it names one spot, expires after the shift, and is
 * signed over the person who holds the spot (`lib/crew/calendar.ts`), so it stops
 * working the moment the spot changes hands. Every refusal is the same bare 404,
 * so a guess learns nothing about which spots exist. The shift and address in the
 * entry are the holder's own.
 */
const APPLE_UA = /iPhone|iPad|Macintosh/
const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  if (!crewAppOpen()) return NOT_FOUND()
  const limited = guardRate(req, plannerRule('crew/cal'))
  if (limited) return limited

  const parsed = parseCrewCalendarToken(params.token)
  if (!parsed) return NOT_FOUND()
  const sb = getSupabase()
  const now = new Date()
  const slot = await getSlot(sb, parsed.slotId)
  if (slot.kind !== 'ok') return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  if (!slot.data || !['assigned', 'completed'].includes(slot.data.status) || !verifyCrewCalendar(params.token, slot.data, now)) return NOT_FOUND()

  const [parties, settings] = await Promise.all([partiesByIds(sb, [slot.data.party_id]), loadCrewSettings(sb)])
  if (parties.kind !== 'ok' || settings.kind !== 'ok') return NextResponse.json({ error: 'Try again in a moment.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  const party = parties.data[0]
  if (!party || party.status === 'cancelled' || party.status === 'draft') return NOT_FOUND()

  const event = crewEventFor(party, slot.data, settings.settings)
  const format = req.nextUrl.searchParams.get('format')
  const wantsIcs = format === 'ics' || (format !== 'google' && APPLE_UA.test(req.headers.get('user-agent') ?? ''))
  if (wantsIcs) {
    return new NextResponse(buildCrewIcs(event, now), {
      status: 200,
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': 'attachment; filename="shift.ics"',
        'Cache-Control': 'no-store',
      },
    })
  }
  const res = NextResponse.redirect(crewGoogleUrl(event), 302)
  res.headers.set('Cache-Control', 'no-store')
  return res
}
