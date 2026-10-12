import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { isUuidLike } from '@/lib/evites/adminView'
import { loadEviteSummaries, SUMMARY_MAX_IDS } from '@/lib/evites/adminSummary'

/**
 * GET /api/admin/evites/summary?bookingIds=<id>,<id>,...
 *
 * The Booked page's per-party invitation button, for a whole page of parties in ONE request
 * (`lib/evites/adminSummary.ts`). Returns `{ summaries: { [bookingId]: EviteSummary | null } }`; an id with
 * no booking is null. Read-only; the actions (create, send) are the existing
 * `/api/admin/parties/[id]/invitation` ones.
 *
 * A failed read is a 503 `{ error }`, never an empty map: the page shows "invitation status unavailable",
 * which is not the same as "no invitation".
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const raw = req.nextUrl.searchParams.get('bookingIds') ?? ''
  const ids = raw.split(',').map((s) => s.trim()).filter((s) => s !== '')
  if (ids.length === 0) return json({ error: 'bookingIds is required' }, 400)
  if (ids.length > SUMMARY_MAX_IDS) return json({ error: `At most ${SUMMARY_MAX_IDS} booking ids per request` }, 400)
  if (!ids.every(isUuidLike)) return json({ error: 'bookingIds must be booking ids' }, 400)

  const read = await loadEviteSummaries(getSupabase(), ids, new Date())
  if (read.kind === 'unavailable') {
    console.error(`evites/admin summary: ${read.reason}`)
    return json({ error: 'Invitation status unavailable' }, 503)
  }
  return json({ summaries: read.summaries })
}
