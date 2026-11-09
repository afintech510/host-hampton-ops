import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { refreshQuoTexts, type TextRefresh } from '@/lib/leadsRefresh'
// The one Gmail poll, run now instead of waiting for its schedule. Imported rather than copied: its
// checkpoint and poison-message rules are the part that must not exist twice.
import { GET as pollGmail } from '@/app/api/cron/gmail-sync/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export interface EmailRefresh {
  /** `ok`, or `unavailable` with the reason in `reason`. */
  status: 'ok' | 'unavailable'
  reason?: string
  scanned?: number
  recorded?: number
}

let running = false

/** Run the Gmail poll in-process, as the scheduler would, and keep only what the screen shows. */
async function checkEmail(): Promise<EmailRefresh> {
  try {
    const res = await pollGmail(new NextRequest('http://localhost/api/cron/gmail-sync', { headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' } }))
    const body = (await res.json().catch(() => null)) as { configured?: boolean; scanned?: number; recorded?: number; ignored?: number; error?: string | null; message?: string } | null
    if (!res.ok || !body) return { status: 'unavailable', reason: res.status === 401 ? 'The email check is not set up to run from here.' : 'The email check failed.' }
    if (body.configured === false) return { status: 'unavailable', reason: 'Gmail is not connected.' }
    if (body.error) return { status: 'unavailable', reason: 'Some email could not be read; it will be retried.' }
    return { status: 'ok', scanned: body.scanned ?? 0, recorded: (body.recorded ?? 0) + (body.ignored ?? 0) }
  } catch (err) {
    console.error('leads-refresh: email check threw:', err instanceof Error ? err.message : err)
    return { status: 'unavailable', reason: 'The email check failed.' }
  }
}

/**
 * POST /api/admin/leads/refresh - the Refresh button on the Leads screen: look for new email and
 * new texts from the leads and bookings right now, instead of waiting for the schedule and the
 * webhook. Mail goes through the normal Gmail poll; texts are caught up from Quo's own record
 * (lib/leadsRefresh). It reads and records; it never sends anything and never changes opt-in
 * state. Admin only. One at a time: a second tap while one runs is told to wait.
 */
export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  if (running) return NextResponse.json({ error: 'A refresh is already running.' }, { status: 429 })
  running = true
  try {
    const [email, texts] = await Promise.all([
      checkEmail(),
      refreshQuoTexts(getSupabase()).catch((err): TextRefresh => {
        console.error('leads-refresh: text check threw:', err instanceof Error ? err.message : err)
        return { checked: 0, newInbound: 0, newOutbound: 0, stops: 0, unavailable: 'The text check failed.' }
      }),
    ])
    return NextResponse.json({ email, texts })
  } finally {
    running = false
  }
}
