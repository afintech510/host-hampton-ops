/**
 * Keep the automated review texts out of Adam's Quo inbox.
 *
 * WHY. The review-ask drip (`review_ask_sms`) and the post-party review text
 * (`review_request_sms`) are sent from the business line, so every one opened a
 * thread in the Quo inbox Adam works from — 176 of them by 2026-10-12, swiped to
 * Done by hand (and then by a one-off script) every few days. Adam asked for it
 * to happen by itself.
 *
 * WHAT IT ARCHIVES. Only a thread whose LAST activity is still our review text.
 * A customer who has replied ("Got it", "Stop", a question) has moved the
 * thread's `lastActivityId` past ours, so it stays where a human will see it.
 * After we archive, Quo's own rule takes over: a conversation goes Open on "all
 * new incoming messages and calls" (support.quo.com, conversation status), so a
 * later reply brings the thread back.
 *
 * WHEN. Rows sent between SETTLE and WINDOW minutes ago. SETTLE gives Quo time to
 * file the message under a conversation; WINDOW is wide enough that several
 * consecutive runs see each row, so one failed Quo call is retried rather than
 * lost. Marking a thread Done twice is harmless.
 *
 * It sends nothing to anyone and writes nothing to our database.
 */
import {
  getQuoMessageRef,
  listQuoConversationsSince,
  markQuoConversationDone,
  type QuoConversation,
} from '@/lib/quo'

export const ARCHIVED_REVIEW_TEXT_TYPES = ['review_ask_sms', 'review_request_sms'] as const

export const ARCHIVE_SETTLE_MINUTES = 3
export const ARCHIVE_WINDOW_MINUTES = 90

export interface ArchiveSummary {
  ok: boolean
  /** Review texts sent inside the window. */
  examined: number
  archived: number
  /** The customer (or we) said something after the review text — left in the inbox. */
  leftOpen: number
  /** Quo could not be read or refused the change; the next run retries. */
  failed: number
  reason?: string
}

/** The Quo message id from a `last_outcome` of `quo:AC…`, or null. */
export function quoMessageIdFrom(lastOutcome: unknown): string | null {
  if (typeof lastOutcome !== 'string') return null
  const m = /^quo:(AC[A-Za-z0-9]+)$/.exec(lastOutcome.trim())
  return m ? m[1] : null
}

export async function archiveReviewTextThreads(
  supabase: any,
  now: Date = new Date(),
  pauseMs = 120,
): Promise<ArchiveSummary> {
  const summary: ArchiveSummary = { ok: true, examined: 0, archived: 0, leftOpen: 0, failed: 0 }
  const pause = () => (pauseMs > 0 ? new Promise<void>(r => setTimeout(r, pauseMs)) : Promise.resolve())

  const from = new Date(now.getTime() - ARCHIVE_WINDOW_MINUTES * 60_000)
  const to = new Date(now.getTime() - ARCHIVE_SETTLE_MINUTES * 60_000)

  const { data: rows, error } = await supabase
    .from('scheduled_reminders')
    .select('id, last_outcome, sent_at')
    .in('reminder_type', [...ARCHIVED_REVIEW_TEXT_TYPES])
    .eq('status', 'sent')
    .gte('sent_at', from.toISOString())
    .lte('sent_at', to.toISOString())

  if (error) return { ...summary, ok: false, reason: `scheduled_reminders read failed: ${error.message}` }

  const texts = (rows ?? [])
    .map((r: any) => ({ messageId: quoMessageIdFrom(r.last_outcome), sentAt: String(r.sent_at) }))
    .filter((r: { messageId: string | null }) => r.messageId) as { messageId: string; sentAt: string }[]
  summary.examined = texts.length
  if (texts.length === 0) return summary

  // Which conversation each text landed in.
  const located: { messageId: string; conversationId: string; phoneNumberId: string }[] = []
  for (const t of texts) {
    const ref = await getQuoMessageRef(t.messageId)
    await pause()
    if (!ref) { summary.failed++; continue }
    located.push({ messageId: t.messageId, ...ref })
  }

  // Each number's conversations, read once, from a minute before the oldest text.
  const oldest = texts.reduce((min, t) => (t.sentAt < min ? t.sentAt : min), texts[0].sentAt)
  const since = new Date(new Date(oldest).getTime() - 60_000).toISOString()
  const byNumber = new Map<string, Map<string, QuoConversation> | null>()
  for (const pn of Array.from(new Set(located.map(l => l.phoneNumberId)))) {
    byNumber.set(pn, await listQuoConversationsSince(pn, since))
    await pause()
  }

  const done = new Set<string>()
  for (const l of located) {
    if (done.has(l.conversationId)) continue
    const convs = byNumber.get(l.phoneNumberId)
    const conv = convs?.get(l.conversationId)
    if (!conv) { summary.failed++; continue }
    if (conv.lastActivityId !== l.messageId) { summary.leftOpen++; continue }
    if (await markQuoConversationDone(l.conversationId)) {
      done.add(l.conversationId)
      summary.archived++
    } else {
      summary.failed++
    }
    await pause()
  }

  // Every text failed → Quo itself is unreachable or the key is wrong. Say so,
  // so the watchdog texts somebody; a partial failure is retried next run.
  if (summary.failed > 0 && summary.failed === summary.examined) {
    summary.ok = false
    summary.reason = 'every Quo lookup failed'
  }
  return summary
}
