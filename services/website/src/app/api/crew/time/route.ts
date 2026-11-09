import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { requireCrewMember } from '@/lib/crew/auth'
import {
  acceptNotice, listPunches, loadClockMember, loadTimeConfig, punchIn, punchOut, requestIp, screenFix, type PunchRow,
} from '@/lib/crew/timeClock'

export const dynamic = 'force-dynamic'

/**
 * The crew time clock (migration 094). Only a member with a row in `crew_time_clock_members` has
 * one; for everybody else both verbs answer 404, exactly as if the route did not exist.
 *
 *   GET   my state: open shift, the notice flag, my punches (times only: the location and network
 *         checks are for the admin).
 *   POST  { action: 'accept_notice' | 'in' | 'out', lat?, lng?, accuracy?, locationStatus? }
 *
 * The time is the server's. A denied or missing location never refuses a punch.
 */

/** What a crew member sees of a punch: times only. */
function mine(p: PunchRow) {
  return { id: p.id, in: p.punched_in_at, out: p.punched_out_at, edited: !!p.edited_at }
}

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })
const unavailable = () => NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 })

export async function GET(req: NextRequest) {
  const gate = await requireCrewMember(req)
  if (!gate.ok) return gate.response
  const sb = getSupabase()
  const cm = await loadClockMember(sb, gate.member.id)
  if (cm.kind !== 'ok') return unavailable()
  if (!cm.data) return notFound()
  const list = await listPunches(sb, gate.member.id)
  if (list.kind !== 'ok') return unavailable()
  return NextResponse.json({
    noticeAccepted: cm.data.noticeAccepted,
    open: list.data.find(p => !p.punched_out_at)?.punched_in_at ?? null,
    punches: list.data.map(mine),
  })
}

export async function POST(req: NextRequest) {
  const limited = guardRate(req, plannerRule('crew-time'))
  if (limited) return limited
  const gate = await requireCrewMember(req)
  if (!gate.ok) return gate.response
  const sb = getSupabase()
  const cm = await loadClockMember(sb, gate.member.id)
  if (cm.kind !== 'ok') return unavailable()
  if (!cm.data) return notFound()

  const body = await req.json().catch(() => ({}))
  const action = body?.action

  if (action === 'accept_notice') {
    const r = await acceptNotice(sb, gate.member.id)
    if (r.kind !== 'ok') return unavailable()
    return NextResponse.json({ ok: true })
  }
  if (action !== 'in' && action !== 'out') return NextResponse.json({ error: 'Pick punch in or punch out.' }, { status: 400 })
  if (!cm.data.noticeAccepted) return NextResponse.json({ error: 'Please read and accept the time clock notice first.', needsNotice: true }, { status: 409 })

  const cfg = await loadTimeConfig(sb)
  if (cfg.kind !== 'ok') return unavailable()
  const fix = screenFix(body && typeof body === 'object' ? body : {})
  const ip = requestIp(req)
  const r = action === 'in'
    ? await punchIn(sb, gate.member.id, fix, ip, cfg.data)
    : await punchOut(sb, gate.member.id, fix, ip, cfg.data)
  if (r.kind === 'error') {
    console.error('crew/time: punch failed:', r.error)
    return unavailable()
  }
  if (r.kind === 'already') return NextResponse.json({ error: r.message }, { status: 409 })
  return NextResponse.json({ ok: true, punch: mine(r.punch) })
}
