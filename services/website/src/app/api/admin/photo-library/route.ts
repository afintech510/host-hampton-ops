/**
 * The photo library (migration 083), from the admin side. (`/api/admin/media`
 * is the older bucket file manager; this is the tagged, approvable library.)
 *
 *   GET   ?status=candidates|approved|all  &source= &party_type= &theme= &activity= &kind= &flagged=1
 *         &sort=newest|confidence|quality  &offset= &limit=        the tagging grid's rows (+ total)
 *   GET   ?facets=1&status=…                                        distinct tags with counts
 *   PATCH { id, approved?, no_identifiable_faces?, alt?, party_type?, theme_slug?, activities?, sort? }
 *   PATCH { ids: [...], approved: true|false }                      bulk, ≤100 at once
 *
 * Approval needs the face check (also a CHECK constraint in migration 083);
 * clearing the face check withdraws approval in the same write. A bulk approval
 * only changes rows whose face check is set IN THE DATABASE and says which rows
 * it left alone.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { bulkSetApproval, facetsForAdmin, listForAdmin, patchPhoto, screenPatch, type AdminSort, type AdminStatus } from '@/lib/media'

export const dynamic = 'force-dynamic'

const num = (v: string | null) => (v !== null && /^\d{1,6}$/.test(v) ? Number.parseInt(v, 10) : undefined)

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const sp = req.nextUrl.searchParams
  const s = sp.get('status')
  const status: AdminStatus = s === 'approved' || s === 'all' ? s : 'candidates'
  if (sp.get('facets')) {
    const f = await facetsForAdmin(getSupabase(), status)
    if (f.kind !== 'ok') return NextResponse.json({ error: `Could not read the library: ${f.error}` }, { status: 503 })
    return NextResponse.json({ facets: f.data })
  }
  const so = sp.get('sort')
  const sort: AdminSort = so === 'confidence' || so === 'quality' ? so : 'newest'
  const r = await listForAdmin(getSupabase(), {
    status, sort, offset: num(sp.get('offset')), limit: num(sp.get('limit')),
    source: sp.get('source') || undefined, partyType: sp.get('party_type') || undefined, theme: sp.get('theme') || undefined,
    activity: sp.get('activity') || undefined, kind: sp.get('kind') || undefined, flagged: sp.get('flagged') === '1',
  })
  if (r.kind !== 'ok') return NextResponse.json({ error: `Could not read the library: ${r.error}` }, { status: 503 })
  return NextResponse.json({ photos: r.data.photos, total: r.data.total })
}

export async function PATCH(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  if ('ids' in body) {
    const b = body as { ids?: unknown; approved?: unknown }
    if (typeof b.approved !== 'boolean') return NextResponse.json({ error: 'approved: true or false.' }, { status: 400 })
    const r = await bulkSetApproval(getSupabase(), b.ids, b.approved, adminActorId(req))
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ ok: true, changed: r.changed, unchanged: r.unchanged })
  }

  if (typeof (body as { id?: unknown }).id !== 'string') return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { id, ...rest } = body as Record<string, unknown>
  const screened = screenPatch(rest)
  if (!screened.ok) return NextResponse.json({ error: screened.error }, { status: 400 })
  const r = await patchPhoto(getSupabase(), id as string, screened.patch, adminActorId(req))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}
