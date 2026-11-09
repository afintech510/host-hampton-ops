import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { isUuid } from '@/lib/crew/auth'

export const dynamic = 'force-dynamic'

/**
 * Fix a punch (a forgotten punch-out, a wrong time). PATCH { id, punchedInAt?, punchedOutAt?, adminNote? }.
 * Times are ISO instants. The row records who edited and when; the original GPS/network facts stay.
 * A conditional UPDATE on the row's `edited_at` as read, so two admins cannot overwrite each other.
 */
export async function PATCH(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const body = await req.json().catch(() => ({}))
  if (!isUuid(body?.id)) return NextResponse.json({ error: 'Pick a punch.' }, { status: 400 })
  const sb = getSupabase()
  const { data: cur, error: rErr } = await sb.from('crew_time_punches').select('punched_in_at, punched_out_at, edited_at').eq('id', body.id).maybeSingle()
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 503 })
  if (!cur) return NextResponse.json({ error: 'No such punch.' }, { status: 404 })

  const iso = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null)
  const inAt = body.punchedInAt !== undefined ? iso(body.punchedInAt) : cur.punched_in_at
  const outAt = body.punchedOutAt === null ? null : body.punchedOutAt !== undefined ? iso(body.punchedOutAt) : cur.punched_out_at
  if (!inAt || (body.punchedOutAt !== undefined && body.punchedOutAt !== null && !outAt)) return NextResponse.json({ error: 'That time is not valid.' }, { status: 400 })
  if (outAt && new Date(outAt) < new Date(inAt)) return NextResponse.json({ error: 'Punch out is before punch in.' }, { status: 400 })
  if (new Date(inAt).getTime() > Date.now() + 5 * 60000 || (outAt && new Date(outAt).getTime() > Date.now() + 5 * 60000)) {
    return NextResponse.json({ error: 'A punch cannot be in the future.' }, { status: 400 })
  }
  const note = typeof body.adminNote === 'string' ? body.adminNote.trim().slice(0, 500) || null : undefined

  const update: Record<string, unknown> = { punched_in_at: inAt, punched_out_at: outAt, edited_by: adminActorId(req), edited_at: new Date().toISOString() }
  if (note !== undefined) update.admin_note = note
  let q = sb.from('crew_time_punches').update(update).eq('id', body.id)
  q = cur.edited_at ? q.eq('edited_at', cur.edited_at) : q.is('edited_at', null)
  const { data, error } = await q.select('id').maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 503 })
  if (!data) return NextResponse.json({ error: 'Someone else just changed this punch. Reload and try again.' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
