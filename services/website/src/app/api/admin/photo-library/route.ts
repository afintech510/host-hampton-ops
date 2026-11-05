/**
 * The photo library (migration 083), from the admin side. (`/api/admin/media`
 * is the older bucket file manager; this is the tagged, approvable library.)
 *
 *   GET   ?status=candidates|approved|all   the tagging grid's rows
 *   PATCH { id, approved?, no_identifiable_faces?, alt?, party_type?, theme_slug?, activities?, sort? }
 *
 * Approval needs the face check (also a CHECK constraint in migration 083);
 * clearing the face check withdraws approval in the same write.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { listForAdmin, patchPhoto, screenPatch } from '@/lib/media'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const s = req.nextUrl.searchParams.get('status')
  const status = s === 'approved' || s === 'all' ? s : 'candidates'
  const r = await listForAdmin(getSupabase(), status)
  if (r.kind !== 'ok') return NextResponse.json({ error: `Could not read the library: ${r.error}` }, { status: 503 })
  return NextResponse.json({ photos: r.data })
}

export async function PATCH(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof (body as { id?: unknown }).id !== 'string') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { id, ...rest } = body as Record<string, unknown>
  const screened = screenPatch(rest)
  if (!screened.ok) return NextResponse.json({ error: screened.error }, { status: 400 })
  const r = await patchPhoto(getSupabase(), id as string, screened.patch, adminActorId(req))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}
