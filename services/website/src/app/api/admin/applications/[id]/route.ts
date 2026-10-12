/**
 * Update one job application — `status` and Adam's private `admin_notes`.
 *
 * Nothing else is writable: the applicant's own answers are what they said, and
 * an admin editing them would make the row stop being evidence of that.
 * `reviewed_at` is stamped by migration 071's trigger the first time `status`
 * leaves 'new', so this route never has to remember to.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { APPLICATION_STATUSES } from '@/lib/careers'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'Unknown application' }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}

  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !(APPLICATION_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: `Status must be one of: ${APPLICATION_STATUSES.join(', ')}` }, { status: 400 })
    }
    update.status = body.status
  }

  if (body.admin_notes !== undefined) {
    if (typeof body.admin_notes !== 'string') {
      return NextResponse.json({ error: 'admin_notes must be text' }, { status: 400 })
    }
    update.admin_notes = body.admin_notes.slice(0, 4000)
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await getSupabase()
    .from('job_applications')
    .update(update)
    .eq('id', params.id)
    .select('id, application_ref, status, admin_notes, reviewed_at')
    .maybeSingle()

  if (error) {
    console.error('admin application update failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  // An UPDATE that matched nothing is not a success.
  if (!data) return NextResponse.json({ error: 'Unknown application' }, { status: 404 })

  return NextResponse.json({ application: data })
}
