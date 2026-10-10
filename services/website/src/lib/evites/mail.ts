/**
 * The ONE Resend call for evites (spec §2 `mail.ts`, §9.1).
 *
 *   sendEviteEmail({ to, subject, html, text, attachments?, headers?, replyTo? })
 *     -> { kind: 'sent', providerId } | { kind: 'failed', error } | { kind: 'unconfigured' }
 *
 * `resend.emails.send` RESOLVES with `{ data, error }`: it does not throw on an API
 * error, and the old reminder sender ignored the return value, so a rejected send
 * was recorded as delivered (AGENTS.md rule 10). This reads both halves, and a
 * response with neither an error NOR a message id is a `failed`, not a `sent`: the
 * ledger must never say "sent" over an email Resend did not accept.
 *
 * It never throws. The caller (`sendOne.ts`) turns every outcome into a
 * `finishSend`, and a thrown error would leave the claim stuck in `sending` for
 * fifteen minutes.
 *
 * `unconfigured` is "no RESEND_API_KEY": nothing was attempted. It is retriable (the
 * key may be added), which is why it is its own outcome and not a `failed`
 * with a made-up message.
 *
 * Nothing here logs an address or a body. Evite mail is addressed to parents and
 * to other people's children's parents.
 */

import { Resend } from 'resend'

/** The same fallback the reminder sender uses (`send-reminders/route.ts`). */
export const DEFAULT_FROM = 'noReply@mail.hosthampton.com'

/**
 * Resend gets this long to answer. A hung call used to hold the claim until the 15-minute stuck-sending sweep
 * reclaimed it and sent the message AGAIN, while the first call might still complete: so the call is abandoned
 * at 30 seconds and reported as `failed` (retriable, with a fresh attempt number the stale worker cannot finish).
 */
export const RESEND_TIMEOUT_MS = 30_000

export interface EviteMailAttachment {
  filename: string
  content: string | Buffer
  /** e.g. `text/calendar; method=PUBLISH; charset=UTF-8` */
  contentType: string
}

export interface EviteMailInput {
  to: string
  subject: string
  html: string
  /** The plain-text half. NEVER HTML-escaped. */
  text: string
  attachments?: EviteMailAttachment[]
  /** e.g. `List-Unsubscribe` / `List-Unsubscribe-Post`. */
  headers?: Record<string, string>
  replyTo?: string
}

export type EviteMailOutcome =
  | { kind: 'sent'; providerId: string }
  | { kind: 'failed'; error: string }
  | { kind: 'unconfigured' }

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') return (e as { message: string }).message
  return String(e)
}

class MailTimeout extends Error {}

/** Reject after `ms`. The late result of the abandoned call is swallowed so it cannot become an unhandled rejection. */
function withTimeout<T>(pending: Promise<T> | T, ms: number): Promise<T> {
  const p = Promise.resolve(pending)
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new MailTimeout(`no answer within ${Math.round(ms / 1000)} seconds`)), ms)
  })
  p.catch(() => undefined)
  return Promise.race([p, limit]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

export async function sendEviteEmail(input: EviteMailInput): Promise<EviteMailOutcome> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { kind: 'unconfigured' }
  const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM

  try {
    const resend = new Resend(apiKey)
    const call = resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      ...(input.headers ? { headers: input.headers } : {}),
      ...(input.attachments && input.attachments.length > 0
        ? { attachments: input.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })) }
        : {}),
    })
    const { data, error } = await withTimeout(call, RESEND_TIMEOUT_MS)
    if (error) return { kind: 'failed', error: `resend rejected: ${errorText(error)}` }
    if (!data?.id) return { kind: 'failed', error: 'resend returned no message id' }
    return { kind: 'sent', providerId: data.id }
  } catch (e) {
    if (e instanceof MailTimeout) return { kind: 'failed', error: `resend timed out: ${errorText(e)}` }
    return { kind: 'failed', error: `resend threw: ${errorText(e)}` }
  }
}
