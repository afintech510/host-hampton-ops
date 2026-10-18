import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cronAuth'
import { getSupabase } from '@/lib/supabase'
import { sendRsvpDigest } from '@/lib/evites/rsvpDigest'

export const dynamic = 'force-dynamic'

/**
 * The owner's daily RSVP digest — every upcoming party with a live invitation,
 * who is coming, and a sign-in link to each host's RSVP page. Owner-only: the
 * one recipient is `ownerEmail()`. See `lib/evites/rsvpDigest.ts`.
 *
 * A failed read is a 503 (and `ok:false`) so the cron watchdog sees it: "could
 * not read the RSVPs" must never look like a quiet day. A day with no live
 * invitations is `ok:true` and sends nothing.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const outcome = await sendRsvpDigest(getSupabase(), new Date())
  const ok = outcome.kind === 'sent' || outcome.kind === 'nothing'
  const body = { ok, ...outcome }
  console.log('cron:rsvp-digest', body)
  return NextResponse.json(body, { status: ok ? 200 : 503 })
}
