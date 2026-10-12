import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cronAuth'
import { getSupabase } from '@/lib/supabase'
import { archiveReviewTextThreads } from '@/lib/reviewTextArchive'

export const dynamic = 'force-dynamic'

/**
 * Moves the automated review texts' Quo threads to Done, so they stay out of
 * Adam's inbox unless the customer replies. Every 15 minutes from the box
 * (`scripts/cron/jobs.tsv`). See `lib/reviewTextArchive.ts`.
 *
 * Counts only in the response: no names, numbers or message text.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.QUO_API_KEY) {
    return NextResponse.json({ ok: true, configured: false })
  }

  const summary = await archiveReviewTextThreads(getSupabase())
  return NextResponse.json(summary, { status: summary.ok ? 200 : 502 })
}
