import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { isUuid } from '@/lib/crew/auth'
import { listPunches, loadTimeConfig, punchFlags, requestIp, TIME_ZONE } from '@/lib/crew/timeClock'

export const dynamic = 'force-dynamic'

/**
 * Admin view of the time clock (migration 094).
 *
 *   GET  ?memberId=  → { enabled, config, yourIp, punches[] (full detail + flags) }
 *   PUT  { studioIps?: string[], useThisConnection?: true, radiusM? }  → the studio's network + radius.
 *        `useThisConnection` records the address THIS request came from: press it from the studio Wi-Fi.
 */

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const memberId = req.nextUrl.searchParams.get('memberId')
  if (!isUuid(memberId)) return NextResponse.json({ error: 'Pick a staff member.' }, { status: 400 })
  const sb = getSupabase()
  const { data: cm, error } = await sb.from('crew_time_clock_members').select('enabled, notice_accepted_at').eq('member_id', memberId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 503 })
  const cfg = await loadTimeConfig(sb)
  if (cfg.kind !== 'ok') return NextResponse.json({ error: cfg.error }, { status: 503 })
  if (!cm?.enabled) return NextResponse.json({ enabled: false, config: cfg.data, yourIp: requestIp(req) })
  const list = await listPunches(sb, memberId)
  if (list.kind !== 'ok') return NextResponse.json({ error: list.error }, { status: 503 })
  return NextResponse.json({
    enabled: true,
    noticeAcceptedAt: cm.notice_accepted_at,
    timeZone: TIME_ZONE,
    config: cfg.data,
    yourIp: requestIp(req),
    punches: list.data.map(p => ({ ...p, flags: punchFlags(p, cfg.data) })),
  })
}

export async function PUT(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const body = await req.json().catch(() => ({}))
  const sb = getSupabase()
  const cfg = await loadTimeConfig(sb)
  if (cfg.kind !== 'ok') return NextResponse.json({ error: cfg.error }, { status: 503 })

  const update: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: adminActorId(req) }
  if (body?.useThisConnection === true) {
    const ip = requestIp(req)
    if (!ip) return NextResponse.json({ error: 'Could not read this connection’s address.' }, { status: 400 })
    update.studio_ips = Array.from(new Set([...cfg.data.studio_ips, ip]))
  } else if (Array.isArray(body?.studioIps)) {
    const ips = body.studioIps.filter((x: unknown): x is string => typeof x === 'string').map((s: string) => s.trim())
    if (ips.length > 10 || ips.some((s: string) => !/^[0-9a-fA-F:.]{3,45}$/.test(s))) {
      return NextResponse.json({ error: 'Each address must look like 203.0.113.7 (up to 10).' }, { status: 400 })
    }
    update.studio_ips = Array.from(new Set(ips))
  }
  if (body?.radiusM !== undefined) {
    const r = Number(body.radiusM)
    if (!Number.isInteger(r) || r < 25 || r > 2000) return NextResponse.json({ error: 'Radius is 25 to 2000 metres.' }, { status: 400 })
    update.radius_m = r
  }
  if (Object.keys(update).length === 2) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
  const { error } = await sb.from('crew_time_config').update(update).eq('id', 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 503 })
  return NextResponse.json({ ok: true })
}
