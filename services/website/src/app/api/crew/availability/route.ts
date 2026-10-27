import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { requireCrewMember } from '@/lib/crew/auth'
import { myLiveWindows } from '@/lib/crew/board'
import { partiesBlockedBy, type DayPart } from '@/lib/crew/rules'
import { etDateString, shiftEtDate } from '@/lib/partyTime'

export const dynamic = 'force-dynamic'

const PARTS: DayPart[] = ['all_day', 'before_noon', 'after_noon']
const isPart = (v: unknown): v is DayPart => typeof v === 'string' && (PARTS as string[]).includes(v)

/**
 * Availability (spec §3.8). Two shapes:
 *
 *   { day: 'YYYY-MM-DD', part: DayPart | null }   one date; null clears it
 *   { dow: 0..6,         part: DayPart | null }   a weekly block; null clears it
 *
 * Blocking never costs a step, and the server REFUSES a block that would land
 * on a party the member is already working: that is "Can't make it", which is
 * what decides what cancelling costs. Clearing is always allowed.
 */
export async function POST(req: NextRequest) {
  const limited = guardRate(req, plannerRule('crew'))
  if (limited) return limited
  const gate = await requireCrewMember(req)
  if (!gate.ok) return gate.response
  const member = gate.member

  const body = await req.json().catch(() => ({}))
  const part = body?.part
  if (part !== null && !isPart(part)) return NextResponse.json({ error: 'Pick a time of day.' }, { status: 400 })

  const sb = getSupabase()
  const unavailable = () => NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })
  const working = "You're working a party then. Use Can't make it on that party instead."

  let windows: Awaited<ReturnType<typeof myLiveWindows>> | null = null
  if (part) {
    windows = await myLiveWindows(sb, member.id)
    if (windows.kind !== 'ok') return unavailable()
  }
  const mine = windows && windows.kind === 'ok' ? windows.data.map(w => w.window).filter(w => w.endsAt.getTime() > Date.now()) : []

  if (typeof body?.day === 'string') {
    const day: string = body.day
    // A real calendar date, not before today and within a year.
    const today = etDateString(new Date())
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || shiftEtDate(day, 0) !== day) {
      return NextResponse.json({ error: 'Pick a date.' }, { status: 400 })
    }
    if (day < today || day > shiftEtDate(today, 366)) return NextResponse.json({ error: 'Pick a date in the coming year.' }, { status: 400 })
    if (part && partiesBlockedBy({ day, part }, mine).length > 0) return NextResponse.json({ error: working }, { status: 409 })

    const { error: delErr } = await sb.from('crew_unavailability').delete().eq('member_id', member.id).eq('day', day).select('id')
    if (delErr) {
      console.error('crew/availability: clear failed:', delErr.message)
      return unavailable()
    }
    if (part) {
      const { error } = await sb.from('crew_unavailability').insert({ member_id: member.id, day, part }).select('id').maybeSingle()
      if (error) {
        console.error('crew/availability: block failed:', error.message)
        return unavailable()
      }
    }
    return NextResponse.json({ ok: true })
  }

  const dow = body?.dow
  if (Number.isInteger(dow) && dow >= 0 && dow <= 6) {
    if (part && partiesBlockedBy({ dow, part }, mine).length > 0) return NextResponse.json({ error: working }, { status: 409 })
    const { error: offErr } = await sb.from('crew_recurring_blocks').update({ active: false })
      .eq('member_id', member.id).eq('dow', dow).select('id')
    if (offErr) {
      console.error('crew/availability: weekly clear failed:', offErr.message)
      return unavailable()
    }
    if (part) {
      const { error } = await sb.from('crew_recurring_blocks')
        .upsert({ member_id: member.id, dow, part, active: true }, { onConflict: 'member_id,dow,part' })
        .select('id')
      if (error) {
        console.error('crew/availability: weekly block failed:', error.message)
        return unavailable()
      }
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Pick a date or a day of the week.' }, { status: 400 })
}
