/**
 * The upcoming-weekend prep list (lib/crew/weekendSummary.ts) for /admin/crew.
 * Admin only; read-only; names the customer's child and parent (the admin sees them
 * everywhere else on the crew pages too).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { loadWeekendSummary } from '@/lib/crew/weekendSummary'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const r = await loadWeekendSummary(getSupabase(), new Date())
  if (r.kind !== 'ok') return NextResponse.json({ error: `Could not read the weekend: ${r.error}` }, { status: 503 })
  return NextResponse.json(r.data)
}
