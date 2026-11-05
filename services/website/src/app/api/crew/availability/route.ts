import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { requireCrewMember } from '@/lib/crew/auth'
import { myLiveWindows } from '@/lib/crew/board'
import { partiesBlockedBy } from '@/lib/crew/rules'
import { etToUtc, shiftEtDate } from '@/lib/partyTime'

export const dynamic = 'force-dynamic'

/** The most periods one person can have ahead of them: a bound on a table anyone signed in can write to. */
const MAX_LIVE_PERIODS = 60
const MAX_PERIOD_DAYS = 366
const DAY_MS = 86_400_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/

/**
 * A `datetime-local` value ("2026-11-14T15:30") is a wall-clock time with no
 * zone. The crew works in Eastern, so that is the zone it means. Anything that
 * is not a real date and time is null — `new Date('2026T12:00')` would not be.
 */
function easternInstant(v: unknown): Date | null {
  if (typeof v !== 'string') return null
  const m = LOCAL.exec(v)
  if (!m) return null
  const [, date, hh, mm] = m
  const h = Number(hh), min = Number(mm)
  if (shiftEtDate(date, 0) !== date || h > 23 || min > 59) return null
  const d = etToUtc(date, h, min)
  return Number.isFinite(d.getTime()) ? d : null
}

/**
 * Availability (spec §3.8), as periods. Two shapes:
 *
 *   { start: 'YYYY-MM-DDTHH:mm', end: 'YYYY-MM-DDTHH:mm' }   add "I can't work" from start to end (Eastern)
 *   { remove: '<period id>' }                                 take one back
 *
 * Blocking never costs a step, and the server REFUSES a period that overlaps a
 * party the member is already working: that is "Can't make it", which is what
 * decides what cancelling costs. Taking a period back is always allowed.
 */
export async function POST(req: NextRequest) {
  const limited = guardRate(req, plannerRule('crew'))
  if (limited) return limited
  const gate = await requireCrewMember(req)
  if (!gate.ok) return gate.response
  const member = gate.member

  const body = await req.json().catch(() => ({}))
  const sb = getSupabase()
  const unavailable = () => NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })

  if (body?.remove !== undefined) {
    if (typeof body.remove !== 'string' || !UUID.test(body.remove)) return NextResponse.json({ error: 'That one is already gone.' }, { status: 400 })
    const { error } = await sb.from('crew_unavailable_periods').delete().eq('id', body.remove).eq('member_id', member.id).select('id')
    if (error) {
      console.error('crew/availability: remove failed:', error.message)
      return unavailable()
    }
    return NextResponse.json({ ok: true })
  }

  const startsAt = easternInstant(body?.start)
  const endsAt = easternInstant(body?.end)
  if (!startsAt || !endsAt) return NextResponse.json({ error: 'Pick a start and an end, date and time.' }, { status: 400 })
  if (endsAt.getTime() <= startsAt.getTime()) return NextResponse.json({ error: 'The end has to be after the start.' }, { status: 400 })
  const now = Date.now()
  if (endsAt.getTime() <= now) return NextResponse.json({ error: 'That time has already passed.' }, { status: 400 })
  if (startsAt.getTime() > now + MAX_PERIOD_DAYS * DAY_MS || endsAt.getTime() - startsAt.getTime() > MAX_PERIOD_DAYS * DAY_MS) {
    return NextResponse.json({ error: 'Pick dates within the coming year.' }, { status: 400 })
  }

  const [windows, existing] = await Promise.all([
    myLiveWindows(sb, member.id),
    sb.from('crew_unavailable_periods').select('starts_at, ends_at').eq('member_id', member.id).gt('ends_at', new Date(now).toISOString()),
  ])
  if (windows.kind !== 'ok' || existing.error) {
    if (existing.error) console.error('crew/availability: read failed:', existing.error.message)
    return unavailable()
  }
  const mine = windows.data.map(w => w.window).filter(w => w.endsAt.getTime() > now)
  if (partiesBlockedBy({ startsAt, endsAt }, mine).length > 0) {
    return NextResponse.json({ error: "You're working a party then. Use Can't make it on that party instead." }, { status: 409 })
  }
  const rows = (existing.data ?? []) as { starts_at: string; ends_at: string }[]
  if (rows.some(r => new Date(r.starts_at).getTime() === startsAt.getTime() && new Date(r.ends_at).getTime() === endsAt.getTime())) {
    return NextResponse.json({ ok: true })
  }
  if (rows.length >= MAX_LIVE_PERIODS) {
    return NextResponse.json({ error: 'That is a lot of time off. Remove one you no longer need first.' }, { status: 400 })
  }

  const { error } = await sb.from('crew_unavailable_periods')
    .insert({ member_id: member.id, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() }).select('id').maybeSingle()
  if (error) {
    console.error('crew/availability: add failed:', error.message)
    return unavailable()
  }
  return NextResponse.json({ ok: true })
}
