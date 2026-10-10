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

export async function sendEviteEmail(input: EviteMailInput): Promise<EviteMailOutcome> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { kind: 'unconfigured' }
  const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM

  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({
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
    if (error) return { kind: 'failed', error: `resend rejected: ${errorText(error)}` }
    if (!data?.id) return { kind: 'failed', error: 'resend returned no message id' }
    return { kind: 'sent', providerId: data.id }
  } catch (e) {
    return { kind: 'failed', error: `resend threw: ${errorText(e)}` }
  }
}
