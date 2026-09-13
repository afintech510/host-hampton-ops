/**
 * How late is too late to send something that was scheduled?
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * Every scheduled job in this codebase asked exactly one question about time:
 * `now >= due`. Neither the sequence processor nor the reminder sender had any
 * notion of a message being TOO late — a step that came due in July was as due
 * as one that came due five minutes ago, and a `booking_sms_1day` for a party
 * that happened three weeks ago was as due as one for tomorrow.
 *
 * That is fine while a job runs every fifteen minutes. It is not fine here.
 * Measured on 2026-09-13, before any of this was written:
 *
 *   /api/cron/process-sequences   stopped 2026-08-16. 45 enrollments active,
 *                                 the oldest enrolled 2026-03-10. On the first
 *                                 tick after it is switched back on, ~34 emails
 *                                 go out at once — including "Get ready for
 *                                 party day at Host Hampton!" to people whose
 *                                 party was three weeks ago, and "Still
 *                                 thinking about your event?" to THIRTEEN
 *                                 people who have since booked and paid.
 *   /api/cron/send-reminders      never scheduled. The queue is empty today, so
 *                                 there is no backlog — but every reminder type
 *                                 in it is date-anchored ("tomorrow", "day of",
 *                                 "in 7 days"), and the sweep that fills it
 *                                 (`event-reminders`) can be scheduled without
 *                                 the sender being scheduled. Two days of that
 *                                 and every row in the queue is a false
 *                                 statement rather than a late one.
 *
 * A late marketing email is a nuisance. A late "your party is tomorrow" text is
 * a lie about a date, sent to somebody who paid us. So the bound is not one
 * number: it is two, because the two surfaces mean different things by "late".
 *
 * ── Two bounds, each with its reason ────────────────────────────────────────
 *
 * `REMINDER_MAX_LATENESS_HOURS` (48h) — reminders are DATE-ANCHORED. Their body
 * says "tomorrow" or "today". Two days is longer than any credible blip in a
 * fifteen-minute job and short enough that a sender which has been off for a
 * week cancels its backlog instead of delivering it.
 *
 * `SEQUENCE_MAX_LATENESS_DAYS` (14d) — sequence steps are RELATIONSHIP-anchored
 * ("still thinking about your event?"), so they survive being a few days late in
 * a way a date-anchored reminder does not. Two weeks is the point at which the
 * message stops being follow-up and starts being an apparition.
 *
 * Both are overridable by environment variable so Adam can widen or narrow them
 * without a deploy, and both refuse a value that is not a positive finite
 * number rather than silently falling back to "no bound" — a cap that was
 * silently ignored is a cap the operator thinks is protecting them (rule 10).
 *
 * ── What being stale DOES ───────────────────────────────────────────────────
 *
 * Nothing here decides that. It reports a fact and a sentence; the caller
 * chooses the outcome. `send-reminders` cancels the row (`last_outcome` carries
 * the sentence). `process-sequences` pauses the enrollment and names it in the
 * run summary. Neither deletes anything and both are one SQL statement to undo,
 * which is the whole point: this turns an invisible standing hazard into a
 * visible decision for a human.
 */

/** 48 hours. A date-anchored message later than this is wrong, not late. */
export const REMINDER_MAX_LATENESS_HOURS_DEFAULT = 48

/** 14 days. A relationship-anchored message later than this is an apparition. */
export const SEQUENCE_MAX_LATENESS_DAYS_DEFAULT = 14

/**
 * Read at CALL time, not at import time, so an operator changing the env var and
 * restarting gets the new bound and a test can pin one without module surgery.
 */
export function reminderMaxLatenessMs(): number {
  return (
    readPositive(
      process.env.REMINDER_MAX_LATENESS_HOURS,
      REMINDER_MAX_LATENESS_HOURS_DEFAULT,
      'REMINDER_MAX_LATENESS_HOURS'
    ) *
    60 *
    60 *
    1000
  )
}

export function sequenceMaxLatenessMs(): number {
  return (
    readPositive(
      process.env.SEQUENCE_MAX_LATENESS_DAYS,
      SEQUENCE_MAX_LATENESS_DAYS_DEFAULT,
      'SEQUENCE_MAX_LATENESS_DAYS'
    ) *
    24 *
    60 *
    60 *
    1000
  )
}

function readPositive(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    // Rule 10 again: an unreadable override must not read as "no bound".
    console.error(`scheduleFreshness: ${name}="${raw}" is not a positive number — using the default of ${fallback}`)
    return fallback
  }
  return n
}

export type Freshness =
  /** Send it. */
  | { kind: 'fresh'; lateMs: number }
  /** Do not send it. `reason` is a sentence a human will read. */
  | { kind: 'stale'; lateMs: number; reason: string }
  /** The scheduled time cannot be read at all. Not the same as late. */
  | { kind: 'unreadable'; raw: string }

/**
 * Three outcomes, not two (rule 12). An unparseable `scheduled_for` is not
 * "fresh" and it is not "stale" — it is a content problem, and collapsing it
 * into either one hides it.
 */
export function checkFreshness(
  scheduledFor: string | Date | null | undefined,
  now: Date,
  maxLatenessMs: number,
  what: string
): Freshness {
  if (scheduledFor === null || scheduledFor === undefined) {
    return { kind: 'unreadable', raw: String(scheduledFor) }
  }
  const due = scheduledFor instanceof Date ? scheduledFor : new Date(scheduledFor)
  if (!Number.isFinite(due.getTime())) {
    return { kind: 'unreadable', raw: String(scheduledFor) }
  }

  const lateMs = now.getTime() - due.getTime()
  if (lateMs <= maxLatenessMs) return { kind: 'fresh', lateMs }

  return {
    kind: 'stale',
    lateMs,
    reason:
      `stale: ${what} was due ${due.toISOString()} (${describeLateness(lateMs)} ago), ` +
      `past the ${describeLateness(maxLatenessMs)} freshness bound — not sent`,
  }
}

/** "3 days" / "5 hours" / "12 minutes". Whole units; the sentence is for a human. */
export function describeLateness(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}
