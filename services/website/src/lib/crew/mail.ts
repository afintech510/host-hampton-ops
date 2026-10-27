/**
 * Crew email (spec §6): the ONE Resend call for crew mail.
 *
 * Its own call rather than `sendEviteEmail`, because the evite surface holds
 * that function to exactly one call site (its send claim, `evitesMailSurface`
 * E6). The behaviour is the same and for the same reasons:
 *
 *   - `resend.emails.send` RESOLVES with `{ data, error }` and does not throw on
 *     an API error, so both halves are read, and a response with neither an
 *     error nor a message id is `failed`, never `sent`;
 *   - a hung call is abandoned after 30 seconds;
 *   - `unconfigured` (no RESEND_API_KEY) is its own outcome;
 *   - it never throws, and it logs no address and no body.
 *
 * Bodies come from `lib/crew/templates.ts` as plain text. The HTML half escapes
 * that text; the plain-text half is sent as written (it must never be escaped).
 */

import { Resend } from 'resend'
import { escapeHtml } from '@/lib/escapeHtml'
import type { Rendered } from '@/lib/crew/templates'

const DEFAULT_FROM = 'noReply@mail.hosthampton.com'
const TIMEOUT_MS = 30_000

export type CrewMailOutcome =
  | { kind: 'sent'; providerId: string }
  | { kind: 'failed'; error: string }
  | { kind: 'unconfigured' }

export function crewEmailHtml(text: string): string {
  const paras = text.split(/\n{2,}/).map(p => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1E1B3A;max-width:520px">${paras}</div>`
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string') return (e as { message: string }).message
  return String(e)
}

export async function sendCrewEmail(to: string, rendered: Rendered): Promise<CrewMailOutcome> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { kind: 'unconfigured' }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const call = new Resend(apiKey).emails.send({
      from: process.env.RESEND_FROM_EMAIL || DEFAULT_FROM,
      to,
      subject: rendered.email.subject,
      text: rendered.email.text,
      html: crewEmailHtml(rendered.email.text),
    })
    Promise.resolve(call).catch(() => undefined)
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer within ${TIMEOUT_MS / 1000} seconds`)), TIMEOUT_MS)
    })
    const { data, error } = await Promise.race([call, limit])
    if (error) return { kind: 'failed', error: `resend rejected: ${errorText(error)}` }
    if (!data?.id) return { kind: 'failed', error: 'resend returned no message id' }
    return { kind: 'sent', providerId: data.id }
  } catch (e) {
    return { kind: 'failed', error: `resend: ${errorText(e)}` }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
