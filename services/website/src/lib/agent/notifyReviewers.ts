/**
 * The reviewer delivery seam (plan §25.5).
 *
 * `notifyOwnerSms` used to be both the transport and the decision. This module
 * takes the decision: it owns `REVIEWER_CHANNEL`, and it is the only place that
 * knows a draft can be announced anywhere other than by text.
 *
 *     REVIEWER_CHANNEL = sms | slack | both      (default: sms)
 *
 * The default is `sms` and stays `sms` until the four SLACK_* values are on the
 * box. An unconfigured Slack is not an error state here — it is just the old
 * behaviour, which is the correct behaviour when there is nowhere to post.
 *
 * ── THE DELIVERY ORDER IS THE REQUIREMENT ────────────────────────────────
 *
 *   1. post to Slack
 *   2. chat.getPermalink
 *   3. createShortLink(kind:'slack')
 *   4. one-segment SMS ping carrying that short link
 *
 * **If 1, 2 or 3 fails, step 4 still happens**, carrying the `/review/` link
 * instead of a Slack one. Not "usually", not "unless the error was bad" —
 * always. Every failure below falls through to the same send.
 *
 * This is not defensive coding for its own sake. §18: a real lead (Eleonore)
 * sat unanswered because a draft was parked and nothing texted anybody, and
 * Adam found out by noticing the ABSENCE of a text — the worst possible
 * detector, because silence is exactly what "no lead came in" looks like. A
 * lead going quiet because Slack had a bad afternoon is that same failure with
 * a new cause. Losing the formatting is cheap. Losing the lead is not.
 *
 * So: the Slack post is best-effort and every call into it is fail-soft by
 * contract (lib/slack/client.ts). The ping is not best-effort.
 *
 * ── Why the ping survives the cutover at all ─────────────────────────────
 *
 * Adam kept it deliberately (§25.5): **Slack can be muted, a text is read**,
 * and speed-to-lead is the entire point of the agent. That was §12's strongest
 * objection to Slack, and the answer is that the ping now costs one segment
 * instead of twelve.
 *
 * ── What this module must NOT do ─────────────────────────────────────────
 *
 * It does not import `sendApproved.ts` and it does not need to. It announces
 * drafts; it never sends one. The Slack routes reach Slack through
 * `lib/slack/*`, and the send path is reached only from the dispatcher — see
 * the module-graph test.
 */

import { getSupabase } from '@/lib/supabase'
import { notifyOwnerSms } from '@/lib/ownerNotify'
import { smsSegmentInfo, gsm7Sanitize } from '@/lib/smsSegments'
import { createShortLink } from '@/lib/shortLink'
import { buildReviewUrl } from './reviewLink'
import { siteUrl } from './config'
import { postMessage, getPermalink, slackConfigured } from '@/lib/slack/client'
import { draftMessageBlocks, draftMessageText, type DraftMessageOpts } from '@/lib/slack/blocks'

type Supa = ReturnType<typeof getSupabase>

export type ReviewerChannel = 'sms' | 'slack' | 'both'

/**
 * Which channel announces a draft.
 *
 * An unrecognised value reads as `sms`, and that direction is chosen: a typo in
 * an env var must not be able to turn off the channel that is known to work.
 */
export function reviewerChannel(): ReviewerChannel {
  const v = (process.env.REVIEWER_CHANNEL || '').trim().toLowerCase()
  if (v === 'slack' || v === 'both') return v
  return 'sms'
}

/**
 * One GSM-7 segment. The ping has to fit inside this or the saving that
 * justified the whole exercise is gone.
 */
const ONE_SEGMENT_UNITS = 160

/**
 * The one-segment ping (§25.5).
 *
 *     [HH-4821 - mobile party] draft ready: Sarah, Oct 12, 24 guests
 *     https://hosthampton.com/s/8Kq2mXp7Ld3Rw9vTnY4bZc
 *
 * The summary is trimmed to fit rather than the message being allowed to spill
 * into a second segment. Trimming is measured in GSM-7 UNITS, not characters:
 * `{`, `}`, `[`, `]`, `~`, `^`, `\` and `|` each cost TWO units in GSM-7, so a
 * length check would under-count a summary containing a bracket and quietly
 * produce the two-segment message this function exists to prevent.
 *
 * The LINK is never trimmed. A ping with a truncated URL is worse than no ping
 * — it looks like it worked.
 */
export function reviewerPingBody(opts: {
  reviewCode: string
  partyType: string
  summary: string
  url: string
  revision?: boolean
  parked?: boolean
}): string {
  const tag = opts.partyType.replace(/_/g, ' ')
  const head = opts.parked ? 'DRAFT HELD - needs you' : opts.revision ? 'revised draft' : 'draft ready'
  const prefix = gsm7Sanitize(`[${opts.reviewCode} - ${tag}] ${head}: `)
  const tail = `\n${opts.url}`

  const fixed = smsSegmentInfo(prefix + tail).units
  const budget = ONE_SEGMENT_UNITS - fixed
  if (budget <= 0) {
    // No room for a summary at all (an unusually long party type or code). The
    // code and the link are what the reviewer needs; the summary is the part
    // that can go.
    return prefix.trimEnd() + tail
  }

  let summary = gsm7Sanitize(opts.summary || '').replace(/\s+/g, ' ').trim()
  while (summary && smsSegmentInfo(summary).units > budget) {
    summary = summary.slice(0, -1)
  }
  return prefix + summary + tail
}

/* ── The seam ───────────────────────────────────────────────────────────── */

export interface NotifyReviewersInput {
  supabase: Supa
  draftId: string
  reviewCode: string
  partyType: string
  path: 'info_gather' | 'quote'
  summary: string
  /** The full drafts, so Slack can show what the /review/ page shows. */
  emailDraft?: string | null
  smsDraft?: string | null
  missing?: string[]
  /** A guardrail hit: the draft is PARKED, and gets no Approve button. */
  warning?: string | null
  /** Preview token for the `/review/<token>` page. '' when minting failed. */
  previewToken?: string | null
  revision?: boolean
  /** The lead's existing Slack thread, so a revision replies into it. */
  threadTs?: string | null
  /** Full SMS body for the sms/fallback path — the caller already builds it. */
  smsBody: string
  /** Injectable for tests. */
  secret?: string
}

export interface NotifyReviewersResult {
  channel: ReviewerChannel
  /** Reviewers the provider actually ACCEPTED a text for. */
  reviewersTexted: number
  /** Null when Slack was not tried, not configured, or refused. */
  slack: { channel: string; ts: string } | null
  /** Which link the SMS ended up carrying — for the log, and for the tests. */
  smsLink: 'slack' | 'review' | 'none'
  /** Non-fatal things that went wrong, so a silent degrade is still visible. */
  warnings: string[]
}

/**
 * Announce a draft to the reviewers. Never throws.
 *
 * Returns what actually happened rather than what was attempted — the same
 * lesson as `notifyOwnerSms` returning delivered-not-attempted, and the same
 * lesson as the campaign sender's `total_recipients`. A counter is only as good
 * as what it is told.
 */
export async function notifyReviewers(input: NotifyReviewersInput): Promise<NotifyReviewersResult> {
  const channel = reviewerChannel()
  const warnings: string[] = []
  const parked = !!input.warning

  // The `/review/<token>` URL is the fallback link and the link in the Slack
  // message. Built once.
  const reviewUrl = input.previewToken ? buildReviewUrl(input.previewToken, siteUrl()) : null

  if (channel === 'sms') {
    const texted = await notifyOwnerSms(input.smsBody)
    return { channel, reviewersTexted: texted, slack: null, smsLink: reviewUrl ? 'review' : 'none', warnings }
  }

  if (!slackConfigured()) {
    // Not an error. `REVIEWER_CHANNEL=slack` with no token is a half-finished
    // cutover, and the right behaviour for a half-finished cutover is the
    // channel that works — loudly, so it is fixed rather than lived with.
    warnings.push('REVIEWER_CHANNEL wants Slack but SLACK_BOT_TOKEN/SLACK_LEADS_CHANNEL are unset')
    console.error('[notify-reviewers] ' + warnings[0] + ' — falling back to SMS')
    const texted = await notifyOwnerSms(input.smsBody)
    return { channel, reviewersTexted: texted, slack: null, smsLink: reviewUrl ? 'review' : 'none', warnings }
  }

  /* ── 1. Post to Slack. Best-effort, from here to the end. ────────────── */

  const messageOpts: DraftMessageOpts = {
    draftId: input.draftId,
    reviewCode: input.reviewCode,
    partyType: input.partyType,
    path: input.path,
    summary: input.summary,
    emailDraft: input.emailDraft ?? null,
    smsDraft: input.smsDraft ?? null,
    missing: input.missing ?? [],
    warning: input.warning ?? null,
    reviewUrl,
    revision: input.revision,
  }

  // `lib/slack/client.ts` is fail-soft by contract and a test asserts it never
  // throws. This catches anyway — not because the contract is doubted, but
  // because the thing on the other side of this promise is a lead waiting for
  // an answer, and "the SMS always sends" should be true of THIS file rather
  // than true of this file given a property of another one. `draftMessageBlocks`
  // is inside the try for the same reason: it is called on model-written text,
  // and a throw there would take the ping down just as effectively.
  const posted = await (async () => {
    try {
      return await postMessage({
        text: draftMessageText(messageOpts),
        blocks: draftMessageBlocks(messageOpts),
        // A revision replies under the draft it revises. This is what makes
        // "thread per lead" real rather than cosmetic.
        threadTs: input.threadTs ?? null,
      })
    } catch (err) {
      console.error('[notify-reviewers] Slack post threw (non-fatal):', err instanceof Error ? err.message : err)
      return null
    }
  })()

  if (!posted) {
    warnings.push('Slack post failed')
  } else if (!input.threadTs) {
    // Persist BEFORE anything else can fail. The channel/ts is how a revision
    // finds the thread and how a thread reply finds the draft; losing it
    // because the permalink call timed out afterwards would silently break
    // threading for this lead forever.
    //
    // ONLY for the ROOT message. A revision posted INTO a thread returns the
    // reply's own ts, and storing that would move `slack_ts` off the thread
    // parent — after which /api/slack/events, which finds the draft with
    // `.eq('slack_ts', thread_ts)`, would stop matching this lead's thread. The
    // stored ts is the THREAD KEY, and a thread has exactly one.
    try {
      const { error } = await input.supabase
        .from('inquiry_drafts')
        .update({ slack_channel: posted.channel, slack_ts: posted.ts })
        .eq('id', input.draftId)
      if (error) {
        // Non-fatal, but say so: the message is in the channel and the DB does
        // not know, so its buttons will not resolve.
        warnings.push(`could not persist slack_ts: ${error.message}`)
        console.error('[notify-reviewers] ' + warnings[warnings.length - 1])
      }
    } catch (err) {
      warnings.push('persisting slack_ts threw')
      console.error('[notify-reviewers] persist threw (non-fatal):', err instanceof Error ? err.message : err)
    }
  }

  /* ── 2 + 3. Permalink, then shorten it. ─────────────────────────────── */

  let pingUrl: string | null = null
  if (posted) {
    try {
      const permalink = await getPermalink(posted.channel, posted.ts)
      if (!permalink) {
        warnings.push('chat.getPermalink failed')
      } else {
        const secret = input.secret ?? process.env.REVIEW_LINK_SIGNING_SECRET?.trim() ?? ''
        const short = await createShortLink(input.supabase, {
          target: permalink,
          secret,
          kind: 'slack',
          entityType: 'inquiry_draft',
          entityId: input.draftId,
        })
        // createShortLink is non-fatal by contract and returns null on failure.
        // A raw permalink is ~78 characters, which would push the ping to two
        // segments — so an unshortened permalink is NOT used. The /review/ link
        // is both shorter and already the documented fallback.
        if (!short) warnings.push('short link for the permalink failed')
        else pingUrl = short.url
      }
    } catch (err) {
      warnings.push('permalink/short-link threw')
      console.error('[notify-reviewers] permalink step threw (non-fatal):', err instanceof Error ? err.message : err)
    }
  }

  /* ── 4. The ping. This happens whatever went wrong above. ───────────── */

  let reviewersTexted = 0
  let smsLink: NotifyReviewersResult['smsLink'] = 'none'

  if (channel === 'both') {
    // The escape hatch (§25.5): full redundancy, the complete SMS body as well
    // as the Slack post. Kept in the enum as an operational lever, not as a
    // schedule — the cutover is on completion, with no soak week.
    reviewersTexted = await notifyOwnerSms(input.smsBody)
    smsLink = reviewUrl ? 'review' : 'none'
  } else if (pingUrl) {
    reviewersTexted = await notifyOwnerSms(
      reviewerPingBody({
        reviewCode: input.reviewCode,
        partyType: input.partyType,
        summary: input.summary,
        url: pingUrl,
        revision: input.revision,
        parked,
      }),
    )
    smsLink = 'slack'
  } else {
    // Slack did not produce a usable link. THE SMS STILL SENDS, carrying the
    // full body with the /review/ link — the §18 rule. This is the branch that
    // matters and it is the one with a test on it.
    reviewersTexted = await notifyOwnerSms(input.smsBody)
    smsLink = reviewUrl ? 'review' : 'none'
  }

  if (warnings.length > 0) {
    console.warn(`[notify-reviewers] ${input.reviewCode}: ${warnings.join('; ')} (SMS link: ${smsLink})`)
  }

  return { channel, reviewersTexted, slack: posted, smsLink, warnings }
}

/**
 * The lead's existing Slack thread, if it has one.
 *
 * A revision to draft X replies under draft X's own message. Returns null for
 * every draft that predates the feature, which reads correctly as "no thread
 * yet" and starts one.
 */
export async function slackThreadFor(
  supabase: Supa,
  draftId: string,
): Promise<{ channel: string; ts: string } | null> {
  const { data, error } = await supabase
    .from('inquiry_drafts')
    .select('slack_channel, slack_ts')
    .eq('id', draftId)
    .maybeSingle()
  // Rule 12: "this lead has no thread yet" and "I could not ask" both end up
  // returning null here, because the caller's only sensible move either way is
  // to post a new message. But they are not the same event, and collapsing them
  // silently is how a lead's thread quietly splits in two — so the failure is
  // named in the log even though the return value cannot distinguish it.
  if (error) {
    console.error(`[notify-reviewers] slack thread lookup failed for ${draftId} (non-fatal):`, error.message)
    return null
  }
  if (!data) return null
  const row = data as { slack_channel: string | null; slack_ts: string | null }
  if (!row.slack_channel || !row.slack_ts) return null
  return { channel: row.slack_channel, ts: row.slack_ts }
}
