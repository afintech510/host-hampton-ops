import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { verifyTrackToken, siteBaseUrl } from '@/lib/experiments/track'
import { recordVariantEvent, recordUnattributed } from '@/lib/experiments/assign'
import { logInteraction } from '@/lib/contactInteractions'

export const dynamic = 'force-dynamic'

/**
 * `/r/<token>` — the tracked-link redirect. The first outcome signal this
 * database has ever recorded.
 *
 * ── The three things this route must never do ──────────────────────────────
 *
 * 1. **Never be an open redirect.** The destination is inside the HMAC payload,
 *    not taken from a query parameter, and it is re-screened with
 *    `safeSiteLink` after the signature verifies. An attacker-controllable
 *    redirect on `www.hosthampton.com` is a phishing kit wrapped in our own
 *    domain and our own TLS certificate. `safeSiteLink` PARSES with `new URL`
 *    rather than prefix-matching, which is content-pipeline.md §11.1 — one
 *    backslash made `/\evil.example.com/x` site-relative to a screen that
 *    reasoned about prefixes and another ORIGIN to every browser.
 *
 * 2. **Never leave the visitor nowhere.** A bad, forged, expired-secret or
 *    truncated token still 302s — to the site root. A person clicking a link in
 *    an email we sent should not meet a 404 because our bookkeeping failed. But
 *    nothing is RECORDED in that case, and the refusal is written where a human
 *    looks (rule 10: a guardrail that stops something says so; and its other
 *    half, it must not say it did something it did not).
 *
 * 3. **Never count twice.** `recordVariantEvent` is idempotent on
 *    `(assignment_id, event_type)`. Mail clients, link scanners and corporate
 *    security proxies fetch every URL in a message, often more than once; a
 *    unique index is the only thing that makes "clicked" mean one person.
 *
 * ── Why it is a 302 and not a 301 ──────────────────────────────────────────
 *
 * A 301 is cached by the browser permanently, so the second click would never
 * reach us. That is fine for a click COUNT that is already capped at one — but
 * it would also survive a change of destination, and the destination is signed
 * into a token that can be re-minted. 302 keeps the redirect a decision this
 * route makes each time.
 */

/** Where an unusable token sends somebody. Always a real page. */
function fallback(): string {
  return `${siteBaseUrl()}/`
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const verdict = verifyTrackToken(params?.token)

  if (!verdict.ok) {
    // Logged, not silent — and deliberately NOT written to
    // `unattributed_signals`, because an unverifiable token carries no
    // assignment to be unattributed FROM. A scanner probing `/r/x` should not be
    // able to fill a table a human reads.
    console.warn(`track: refused a token (${verdict.reason})`)
    return NextResponse.redirect(fallback(), { status: 302 })
  }

  const supabase = getSupabase()

  // The redirect does not wait on the bookkeeping being correct — but the
  // bookkeeping is attempted before the response, because a fire-and-forget
  // write in a serverless-style handler is a write that may never run. This is
  // one INSERT against a table with a unique index; it is not a page's worth of
  // latency.
  //
  // Three outcomes on the assignment read (rule 12). A blip must not be
  // recorded as an unattributable click, which would put a permanent row in
  // front of a human over one bad second.
  const { data: assignment, error } = await supabase
    .from('variant_assignments')
    .select('id, experiment_id, variant_id, contact_id')
    .eq('id', verdict.assignmentId)
    .maybeSingle()

  if (error) {
    console.error(`track: assignment ${verdict.assignmentId} unreadable — click NOT recorded: ${error.message}`)
    return NextResponse.redirect(verdict.destination, { status: 302 })
  }

  if (!assignment) {
    // Rule 14. The token verified, so we minted this link: the click is real
    // and we cannot say which arm it belongs to. That is exactly the shape
    // `lib/unclaimedPayment.ts` exists for — an unattributable record is a
    // bookkeeping problem, an INVISIBLE one is a loss.
    await recordUnattributed(
      supabase,
      'tracked_click',
      'a click on a link we minted, whose variant_assignments row no longer exists',
      { assignment_id: verdict.assignmentId, destination: verdict.destination }
    )
    return NextResponse.redirect(verdict.destination, { status: 302 })
  }

  const recorded = await recordVariantEvent({
    supabase,
    assignmentId: String(assignment.id),
    eventType: 'clicked',
    detail: verdict.destination,
    meta: {
      experiment_id: String(assignment.experiment_id),
      variant_id: String(assignment.variant_id),
      // No IP, no user agent, no referrer. This is an A/B denominator, not an
      // analytics product, and the least data that answers the question is the
      // amount worth holding about a customer.
    },
  })

  if (recorded.kind === 'unavailable') {
    console.error(`track: click on assignment ${assignment.id} could not be recorded: ${recorded.error}`)
  } else if (recorded.kind === 'recorded') {
    // The activity log gets its first `email_clicked` row ever. Measured
    // 2026-09-12: `contact_interactions` held 142 rows and not one of the five
    // `email_*` labels its own CHECK constraint allows.
    await logInteraction(supabase, {
      contactId: String(assignment.contact_id),
      type: 'email_clicked',
      summary: `Clicked a tracked link: ${verdict.destination}`,
      metadata: {
        source: 'variant_track',
        experiment_id: String(assignment.experiment_id),
        variant_id: String(assignment.variant_id),
        assignment_id: String(assignment.id),
        destination: verdict.destination,
      },
    })
  }

  return NextResponse.redirect(verdict.destination, { status: 302 })
}
