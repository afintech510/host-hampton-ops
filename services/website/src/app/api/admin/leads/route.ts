import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { loadLeadCards } from '@/lib/leadCards'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/leads - the open leads as cards, most recent contact first (the
 * Leads screen of the crew-management app). Admin only, read only.
 */
export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const r = await loadLeadCards(getSupabase())
  if (r.kind !== 'ok') return NextResponse.json({ error: r.error }, { status: 503 })
  return NextResponse.json({ leads: r.leads, truncated: r.truncated })
}
