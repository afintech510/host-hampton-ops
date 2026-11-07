import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { fetchBooked, loadDashboard } from '@/lib/crewAppData'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/crew-app/dashboard - the crew-management Dashboard's numbers
 * (lib/dashboardMetrics.ts says where each comes from). Admin only, read only.
 * A source that could not be read leaves its section null and says so in `errors`;
 * it is never shown as zero.
 */
export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const booked = await fetchBooked(req)
  if (!booked.ok) return NextResponse.json({ error: booked.error }, { status: 503 })
  return NextResponse.json(await loadDashboard(getSupabase(), booked.parties))
}
