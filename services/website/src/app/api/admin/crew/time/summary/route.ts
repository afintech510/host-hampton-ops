import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { type PunchRow, minutesWorked, weeklyBreakdown, TIME_ZONE } from '@/lib/crew/timeClock'

export const dynamic = 'force-dynamic'

/**
 * Admin: every staff member who has USED the time clock (at least one punch), with their hours week
 * by week (Monday to Sunday, Eastern) and a weekly total. Read only; the per-punch detail, flags and
 * edits stay on the Staff page.
 */
export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const sb = getSupabase()
  const { data: punches, error } = await sb.from('crew_time_punches').select('*').order('punched_in_at', { ascending: false }).limit(5000)
  if (error) return NextResponse.json({ error: error.message }, { status: 503 })
  const rows = (punches ?? []) as PunchRow[]
  const ids = Array.from(new Set(rows.map(p => p.member_id)))
  if (ids.length === 0) return NextResponse.json({ timeZone: TIME_ZONE, people: [] })
  const { data: members, error: mErr } = await sb.from('crew_members').select('id, first_name, last_name, is_test').in('id', ids)
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 503 })

  const now = new Date()
  const people = (members ?? []).map(m => {
    const mine = rows.filter(p => p.member_id === m.id)
    return {
      id: m.id as string,
      name: [m.first_name, m.last_name].filter(Boolean).join(' '),
      isTest: !!m.is_test,
      clockedInSince: mine.find(p => !p.punched_out_at)?.punched_in_at ?? null,
      totalMinutes: mine.reduce((s, p) => s + minutesWorked(p, now), 0),
      weeks: weeklyBreakdown(mine, now),
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json({ timeZone: TIME_ZONE, people })
}
