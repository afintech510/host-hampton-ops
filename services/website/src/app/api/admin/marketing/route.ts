import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { currentMonth } from '@/lib/marketing/budget'
import { HEARD_ABOUT_OPTIONS } from '@/lib/attribution'

export const dynamic = 'force-dynamic'

/**
 * Snapshot for the admin Marketing tab: the content pipeline, active marketing
 * tasks, this month's budget, pending consent releases, and recent ledger.
 */
export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()

  // 90 days of first touches. Read as rows and counted here rather than by a
  // GROUP BY, because PostgREST has no aggregate and this window is ~200 rows.
  // The window is deliberate: "where are the inquiries coming from" is a
  // question about now, and the 1217-row all-time answer is dominated by two
  // CSV imports that were never a marketing channel at all.
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()

  const [content, tasks, budget, releases, ledger, touches] = await Promise.all([
    supabase
      .from('website_content')
      // meta_description and created_by are here so the Marketing tab can show
      // the SEO budget and who wrote the row (COPY vs a human) without a second
      // round-trip — a reviewer's first two questions about a draft.
      .select('id, slug, title, meta_description, status, locale, page_type, created_by, references_child_media, consent_release_ids, reviewed_by, reviewed_at, updated_at')
      .neq('status', 'archived')
      .order('updated_at', { ascending: false })
      .limit(100),
    supabase
      .from('marketing_tasks')
      .select('id, task_type, title, approval_tier, status, entity_type, entity_id, rejection_reason, created_at, updated_at')
      .not('status', 'in', '(done,rejected)')
      .order('updated_at', { ascending: false })
      .limit(100),
    supabase.from('marketing_budget').select('*').eq('month', currentMonth()).maybeSingle(),
    supabase
      .from('consent_releases')
      .select('id, booking_id, contact_id, child_name, status, signed_at, created_at')
      .neq('status', 'signed')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('marketing_ledger')
      .select('id, entity_type, entity_id, action, actor, from_status, to_status, cost_usd, tokens, meta, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('contacts')
      .select('source, source_detail, attribution, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1000),
  ])

  return NextResponse.json({
    content: content.data || [],
    tasks: tasks.data || [],
    budget: budget.data || null,
    releases: releases.data || [],
    ledger: ledger.data || [],
    attribution: summarizeAttribution(touches.data, touches.error?.message ?? null),
  })
}

interface AttributionRow {
  source?: string | null
  source_detail?: string | null
  attribution?: Record<string, unknown> | null
  created_at?: string | null
}

/**
 * Count 90 days of first touches by channel, and separately by the verbatim
 * `utm_source`.
 *
 * BOTH, not one. The channel enum has no label for `chatgpt.com` — all three
 * UTMs this business has ever captured say exactly that — so a report built
 * only on `source` shows `other: 3` and answers nothing. The enum is for
 * grouping; the raw tag is the finding.
 *
 * `unreadable` is not zero (rule 12). A failed read here would otherwise render
 * as "no inquiries from anywhere", which is a sentence about the business and
 * not about the query.
 */
function summarizeAttribution(rows: AttributionRow[] | null, error: string | null) {
  if (error || !rows) return { unreadable: error || 'contacts could not be read', byChannel: [], byUtmSource: [], total: 0 }

  const byChannel = new Map<string, number>()
  const byUtmSource = new Map<string, number>()
  const selfReportedNotes: { note: string; at: string | null }[] = []

  for (const row of rows) {
    const channel = row.source || 'unrecorded'
    byChannel.set(channel, (byChannel.get(channel) || 0) + 1)

    const utmSource = row.attribution && typeof row.attribution === 'object'
      ? (row.attribution as { utm_source?: unknown }).utm_source
      : undefined
    const referrer = row.attribution && typeof row.attribution === 'object'
      ? (row.attribution as { referrer?: unknown }).referrer
      : undefined
    const selfReported = row.attribution && typeof row.attribution === 'object'
      ? (row.attribution as { self_reported?: unknown }).self_reported
      : undefined

    // Same precedence as `deriveLeadSource`, and each label SAYS which kind of
    // evidence it is. A measured tag and somebody's recollection are not the
    // same claim, and a chart that silently mixes them invites a spending
    // decision on the weaker one.
    const label = typeof utmSource === 'string' ? utmSource
      : typeof selfReported === 'string' ? `${heardAboutLabel(selfReported)} (said so)`
      : typeof referrer === 'string' ? `${referrer} (referrer)`
      : null
    if (label) byUtmSource.set(label, (byUtmSource.get(label) || 0) + 1)

    if (typeof selfReported === 'string') {
      const note = (row.attribution as { self_reported_note?: unknown }).self_reported_note
      if (selfReported === 'something_else' && typeof note === 'string' && note.trim()) {
        // Their own words, verbatim. This is the field that tells us what the
        // twelfth option should be, and it only works if a human reads it.
        selfReportedNotes.push({ note: note.trim(), at: row.created_at || null })
      }
    }
  }

  const sorted = (m: Map<string, number>) =>
    Array.from(m.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)

  return {
    unreadable: null,
    byChannel: sorted(byChannel),
    byUtmSource: sorted(byUtmSource),
    selfReportedNotes: selfReportedNotes.slice(0, 20),
    total: rows.length,
  }
}

/** The customer-facing label for a `heardAbout` value, or the raw value. */
function heardAboutLabel(value: string): string {
  return HEARD_ABOUT_OPTIONS.find(o => o.value === value)?.label ?? value
}
