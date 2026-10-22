/**
 * /api/troop/[troop]/leader — the Leaders tab on the troop board.
 *
 *   GET  → everything: all posts, the whole schedule, snack claims WITH the
 *          scout's name, the inbox, and the settings including leader emails.
 *   POST → one action: save/delete an announcement or schedule item, clear or
 *          fill a snack date, mark an inbox item done, save Setup.
 *
 * Gated by `isTroopLeaderAuthorized` (TROOP_LEADER_PASSWORD, or an HH admin
 * session). Rate-limited BEFORE the gate, so the shared password cannot be
 * guessed at speed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { isTroopLeaderAuthorized, troopLeaderUnauthorized } from '@/lib/troopAuth'
import {
  troopConfig,
  screenPost,
  screenScheduleItem,
  screenSettings,
  screenSnackClaim,
  POST_COLUMNS,
  SCHEDULE_COLUMNS,
  SNACK_COLUMNS,
  INBOX_COLUMNS,
} from '@/lib/troop'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const asId = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v : null)

export async function GET(req: NextRequest, { params }: { params: { troop: string } }) {
  const limited = guardRate(req, plannerRule('troop-leader'))
  if (limited) return limited
  if (!isTroopLeaderAuthorized(req)) return troopLeaderUnauthorized()

  const cfg = troopConfig(params.troop)
  if (!cfg) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const supabase = getSupabase()
  const [posts, sched, snacks, inbox, settings] = await Promise.all([
    supabase.from('troop_posts').select(POST_COLUMNS).eq('troop', cfg.number).order('post_date', { ascending: false }).limit(200),
    supabase
      .from('troop_schedule')
      .select(SCHEDULE_COLUMNS)
      .eq('troop', cfg.number)
      .order('event_date', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(300),
    supabase.from('troop_snack_claims').select(SNACK_COLUMNS).eq('troop', cfg.number),
    supabase.from('troop_inbox').select(INBOX_COLUMNS).eq('troop', cfg.number).order('created_at', { ascending: false }).limit(300),
    supabase.from('troop_settings').select('welcome, leader_names, leader_emails').eq('troop', cfg.number).maybeSingle(),
  ])

  const failed = [posts, sched, snacks, inbox, settings].find(r => r.error)
  if (failed) {
    console.error('troop leader: read failed —', failed.error?.code, failed.error?.message)
    return NextResponse.json({ error: "Couldn't load. Please try again." }, { status: 503 })
  }

  return NextResponse.json(
    {
      posts: posts.data ?? [],
      schedule: sched.data ?? [],
      snacks: snacks.data ?? [],
      inbox: inbox.data ?? [],
      settings: settings.data ?? { welcome: null, leader_names: [], leader_emails: [] },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(req: NextRequest, { params }: { params: { troop: string } }) {
  const limited = guardRate(req, plannerRule('troop-leader'))
  if (limited) return limited
  if (!isTroopLeaderAuthorized(req)) return troopLeaderUnauthorized()

  const cfg = troopConfig(params.troop)
  if (!cfg) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const supabase = getSupabase()
  const troop = cfg.number
  const bad = (error: string) => NextResponse.json({ error }, { status: 400 })
  const id = asId(body.id)
  let error: { code?: string; message: string } | null = null

  switch (body.action) {
    case 'save_post': {
      const s = screenPost(body)
      if (!s.ok) return bad(s.error)
      const now = new Date().toISOString()
      ;({ error } = id
        ? await supabase.from('troop_posts').update({ ...s.value, updated_at: now }).eq('id', id).eq('troop', troop)
        : await supabase.from('troop_posts').insert({ ...s.value, troop }))
      break
    }
    case 'delete_post':
      if (!id) return bad('Missing id')
      ;({ error } = await supabase.from('troop_posts').delete().eq('id', id).eq('troop', troop))
      break

    case 'save_schedule': {
      const s = screenScheduleItem(body)
      if (!s.ok) return bad(s.error)
      const now = new Date().toISOString()
      ;({ error } = id
        ? await supabase.from('troop_schedule').update({ ...s.value, updated_at: now }).eq('id', id).eq('troop', troop)
        : await supabase.from('troop_schedule').insert({ ...s.value, troop }))
      break
    }
    case 'delete_schedule':
      // The snack claim goes with it (ON DELETE CASCADE).
      if (!id) return bad('Missing id')
      ;({ error } = await supabase.from('troop_schedule').delete().eq('id', id).eq('troop', troop))
      break

    case 'clear_snack': {
      const scheduleId = asId(body.scheduleId)
      if (!scheduleId) return bad('Missing date')
      ;({ error } = await supabase.from('troop_snack_claims').delete().eq('schedule_id', scheduleId).eq('troop', troop))
      break
    }
    case 'fill_snack': {
      // A leader filling in or reassigning a date for a family: an upsert, unlike
      // the family route, because overwriting is what "Reassign" means.
      const s = screenSnackClaim(body)
      if (!s.ok) return bad(s.error)
      const { data: slot, error: slotErr } = await supabase
        .from('troop_schedule')
        .select('id')
        .eq('id', s.value.schedule_id)
        .eq('troop', troop)
        .maybeSingle()
      if (slotErr) {
        error = slotErr
        break
      }
      if (!slot) return bad('That date is not on the schedule.')
      ;({ error } = await supabase.from('troop_snack_claims').upsert({ ...s.value, troop }, { onConflict: 'schedule_id' }))
      break
    }

    case 'toggle_done':
      if (!id) return bad('Missing id')
      ;({ error } = await supabase.from('troop_inbox').update({ done: body.done === true }).eq('id', id).eq('troop', troop))
      break

    case 'save_settings': {
      const s = screenSettings(body)
      if (!s.ok) return bad(s.error)
      ;({ error } = await supabase
        .from('troop_settings')
        .upsert({ ...s.value, troop, updated_at: new Date().toISOString() }, { onConflict: 'troop' }))
      break
    }

    default:
      return bad('Unknown action')
  }

  if (error) {
    console.error(`troop leader: ${String(body.action)} failed —`, error.code, error.message)
    return NextResponse.json({ error: "Couldn't save. Please try again." }, { status: 503 })
  }
  return NextResponse.json({ success: true })
}
