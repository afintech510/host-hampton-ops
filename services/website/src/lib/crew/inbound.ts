/**
 * A text from a crew member's phone, to the Quo line (spec §6, prompt 05 §2).
 *
 * `/api/webhooks/quo` asks this FIRST — after the signature check and the rate
 * limit, BEFORE carrier-keyword routing and the contact lookup — and returns as
 * soon as it answers `handled`. So:
 *
 *   - **A crew phone never becomes a `contacts` row** and never reaches the
 *     booking agent's `recordInboundEvent`. Crew are not customers.
 *   - **Y / YES confirms** the sender's earliest assigned, unconfirmed spot
 *     whose confirmation request has gone out, and replies `confirmed`; with
 *     nothing due it replies "Nothing to confirm right now." YES is also a
 *     carrier START keyword — the reason this branch must run before keyword
 *     routing, which would otherwise record it as a customer START.
 *   - **STOP** (the whole carrier family) sets crew `sms_opt_in = false` AND
 *     calls `recordSmsOptOut`, because a STOP is a statement about the NUMBER:
 *     if that number is also on a customer row, it is opted out there too.
 *   - **HELP** replies `smsHelp`, whatever the opt-in (the carrier expects HELP
 *     answered).
 *   - Anything else is left alone: the text is already in the Quo inbox, which
 *     is where Allie reads crew messages. Nothing here stores its words.
 *
 * Replies go through `notifyMember`, so they obey CREW_ENABLED, CREW_SMS_ENABLED,
 * quiet hours and the dedupe like every other crew message; the dedupe key
 * carries Quo's message id, so a redelivered webhook replies once.
 *
 * Three outcomes. `unavailable` makes the route answer 503 so Quo redelivers —
 * a STOP that could not be written must not be answered 200 (rule 10).
 */

import type { getSupabase } from '@/lib/supabase'
import { recordSmsOptOut, smsKeywordIntent } from '@/lib/smsOptOut'
import { crewMembersByPhone } from '@/lib/crew/db'
import { loadCrewSettings } from '@/lib/crew/settings'
import { templates } from '@/lib/crew/templates'
import { confirmNextDue } from '@/lib/crew/confirm'
import { notifyMember, type CrewSenders } from '@/lib/crew/notify'

type Supa = ReturnType<typeof getSupabase>

export type CrewInboundResult =
  | { kind: 'not_crew' }
  | { kind: 'handled'; action: 'opt_out' | 'confirmed' | 'nothing_to_confirm' | 'help' | 'ignored' }
  | { kind: 'unavailable'; error: string }

/** Y / YES, exactly — the same exactness `smsKeywordIntent` keeps. "Yes but late" is not a confirmation. */
export function isConfirmReply(body: string): boolean {
  const key = String(body ?? '').trim().toUpperCase().replace(/[.!]+$/, '')
  return key === 'Y' || key === 'YES'
}

export async function handleCrewInboundSms(
  input: { sb: Supa; now: Date; from: string; text: string; messageId: string; senders?: CrewSenders },
): Promise<CrewInboundResult> {
  const { sb, now, from, text } = input
  const found = await crewMembersByPhone(sb, from)
  if (found.kind !== 'ok') return { kind: 'unavailable', error: found.error }
  if (found.data.length === 0) return { kind: 'not_crew' }
  const members = found.data
  const member = members[0]
  const ctx = { sb, now, senders: input.senders }
  const replyKey = input.messageId || `t${now.getTime()}`

  const intent = smsKeywordIntent(text)

  if (intent === 'stop') {
    const { data, error } = await sb.from('crew_members').update({ sms_opt_in: false })
      .in('id', members.map(m => m.id)).select('id')
    if (error) return { kind: 'unavailable', error: error.message }
    if ((data ?? []).length === 0) return { kind: 'unavailable', error: 'crew opt-out matched no rows' }
    const res = await recordSmsOptOut(sb, from, 'quo', { message_id: input.messageId, crew: true })
    if (res.kind === 'unavailable') return { kind: 'unavailable', error: res.error }
    console.log(`quo:webhook crew STOP recorded for ${members.length} crew row(s), contacts: ${res.kind}`)
    return { kind: 'handled', action: 'opt_out' }
  }

  if (isConfirmReply(text)) {
    const settings = await loadCrewSettings(sb)
    if (settings.kind !== 'ok') return { kind: 'unavailable', error: settings.error }
    const out = await confirmNextDue(ctx, settings.settings, member)
    if (out.kind === 'unavailable') return { kind: 'unavailable', error: 'could not read or write the spot' }
    if (out.kind === 'confirmed') return { kind: 'handled', action: 'confirmed' }
    await notifyMember(ctx, member, 'nothingToConfirm', templates.nothingToConfirm(), `nothing_to_confirm:${replyKey}`)
    return { kind: 'handled', action: 'nothing_to_confirm' }
  }

  if (intent === 'help') {
    await notifyMember(ctx, member, 'smsHelp', templates.smsHelp(), `sms_help:${replyKey}`, { helpReply: true })
    return { kind: 'handled', action: 'help' }
  }

  return { kind: 'handled', action: 'ignored' }
}
