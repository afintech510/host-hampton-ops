/**
 * How long a draft has been waiting on a human — the anti-silence signal.
 *
 * A leaf module with no imports, because the Inbox is a client component (the
 * same reason `lib/pipelineStages.ts` and `lib/smsSegments.ts` exist).
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * The Inbox rendered `created_at` as an absolute timestamp. "9/8/2026,
 * 4:47:19 PM" is not a fact anybody triages on: a list of them all looks the
 * same, and the one that has been sitting for four days looks exactly like the
 * one that arrived this morning. The lead whose silence Adam noticed (plan §18)
 * was visible in that list the whole time.
 *
 * That incident's rule was "a guardrail that stops something must also say that
 * it stopped it". This is the same rule one step out: **the system must say how
 * long it has been waiting, because nobody can see an elapsed time that is only
 * implied by a date.**
 *
 * ── The clock ────────────────────────────────────────────────────────────
 *
 * `sent_for_review_at` when set — that is when the ball entered a human's
 * court, and it is reset by a re-draft or an edit, so a draft actively being
 * worked reads as fresh rather than accruing age it has not earned. A draft
 * that was HELD (`status='drafted'`) never got a `sent_for_review_at`, so it
 * falls back to `created_at` — and those are exactly the ones that used to
 * notify nobody, so they must not read as ageless.
 */

export type WaitingSeverity = 'fresh' | 'waiting' | 'overdue'

export interface WaitingInfo {
  /** Milliseconds since the ball entered a human's court. */
  ms: number
  severity: WaitingSeverity
  /** "4 days" / "6 hours" / "20 minutes" — what the badge shows. */
  label: string
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The reviewer nudge fires at 2 hours, so anything under that is still inside
 * the system's own promise and is not worth colouring. Past a day, nothing
 * automated will chase it again — the nudge fires once — so that is the point
 * at which only a human will ever pick it up.
 */
const WAITING_AFTER_MS = 2 * HOUR
const OVERDUE_AFTER_MS = DAY

export function describeElapsed(ms: number): string {
  if (ms < MINUTE) return 'just now'
  if (ms < HOUR) {
    const m = Math.floor(ms / MINUTE)
    return `${m} minute${m === 1 ? '' : 's'}`
  }
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR)
    return `${h} hour${h === 1 ? '' : 's'}`
  }
  const d = Math.floor(ms / DAY)
  return `${d} day${d === 1 ? '' : 's'}`
}

/**
 * How long this draft has been waiting.
 *
 * A missing or unparseable clock returns `null` rather than 0: "waiting just
 * now" would be a claim, and an unreadable timestamp is not evidence that
 * something is fresh. The caller shows nothing instead of showing a lie.
 */
export function waitingInfo(
  draft: { sent_for_review_at?: string | null; created_at?: string | null },
  now: Date = new Date(),
): WaitingInfo | null {
  const stamp = draft.sent_for_review_at || draft.created_at
  if (!stamp) return null
  const started = new Date(stamp).getTime()
  if (!Number.isFinite(started)) return null

  // A future timestamp is a clock skew, not negative age.
  const ms = Math.max(0, now.getTime() - started)
  const severity: WaitingSeverity =
    ms >= OVERDUE_AFTER_MS ? 'overdue' : ms >= WAITING_AFTER_MS ? 'waiting' : 'fresh'

  return { ms, severity, label: describeElapsed(ms) }
}

/**
 * Longest-waiting first — the order a queue should be worked in.
 *
 * Drafts with no readable clock sort LAST rather than first. They are the
 * unknown case, and putting an unknown at the top of a list that means "these
 * are the most neglected" would push a real one off the top.
 */
export function byLongestWaiting<T extends { sent_for_review_at?: string | null; created_at?: string | null }>(
  a: T,
  b: T,
  now: Date = new Date(),
): number {
  const wa = waitingInfo(a, now)
  const wb = waitingInfo(b, now)
  if (!wa && !wb) return 0
  if (!wa) return 1
  if (!wb) return -1
  return wb.ms - wa.ms
}
