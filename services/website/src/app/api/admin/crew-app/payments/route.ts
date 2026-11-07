import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { loadPayments } from '@/lib/crewAppPayments'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/crew-app/payments - every payment (card, Venmo, Zelle, cash, other, and
 * event tickets), newest first, with who paid, what for and what the booking still owes.
 * Admin only, read only.
 */
export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const r = await loadPayments(getSupabase())
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 503 })
  return NextResponse.json({ payments: r.rows, truncated: r.truncated })
}
