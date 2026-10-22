/**
 * POST /api/troop/[troop]/submit — the three private family forms on the troop
 * board: "Can't make it", "Suggestions & ideas" and "Contact the leaders".
 *
 * One `troop_inbox` row, read only from the Leaders tab, then an email to every
 * leader address saved in Setup. A troop parent is not a lead: this route touches
 * no contact, list, sequence or agent.
 *
 * A 200 means the row landed. The email is a courtesy on top — the leaders' inbox
 * tab is the record — so a failed send is logged and the family is still thanked.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { getSupabase } from '@/lib/supabase'
import { guardRate, intakeRule } from '@/lib/rateLimit'
import { settledOk } from '@/lib/publicIntake'
import { SITE_URL } from '@/lib/seo'
import { troopConfig, screenInboxEntry, fmtLongDate, type InboxEntry } from '@/lib/troop'
import { troopLeaderAlertEmail, troopAbsenceConfirmEmail } from '@/lib/email-templates/troop'

export const dynamic = 'force-dynamic'

function alertContent(e: InboxEntry): { kindLabel: string; headline: string; rows: { label: string; value: string }[] } {
  if (e.kind === 'absence') {
    return {
      kindLabel: 'Absence',
      headline: `${e.scout_name} will miss ${fmtLongDate(e.missed_date)}`,
      rows: [
        { label: 'From', value: e.parent_name },
        ...(e.email ? [{ label: 'Email', value: e.email }] : []),
        ...(e.body ? [{ label: 'Note', value: e.body }] : []),
      ],
    }
  }
  if (e.kind === 'idea') {
    return {
      kindLabel: 'Idea',
      headline: e.idea_kind,
      rows: [
        { label: 'Idea', value: e.body },
        { label: 'From', value: e.anonymous ? 'Anonymous' : e.parent_name || 'No name given' },
      ],
    }
  }
  return {
    kindLabel: 'Message',
    headline: `Message from ${e.parent_name}`,
    rows: [
      { label: 'Message', value: e.body },
      { label: 'Reply to', value: e.reply_to },
    ],
  }
}

export async function POST(req: NextRequest, { params }: { params: { troop: string } }) {
  const limited = guardRate(req, intakeRule('troop-submit'))
  if (limited) return limited

  const cfg = troopConfig(params.troop)
  if (!cfg) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  if (typeof body.website === 'string' && body.website.trim() !== '') return NextResponse.json({ success: true })

  const screened = screenInboxEntry(body)
  if (!screened.ok) return NextResponse.json({ error: screened.error }, { status: 400 })
  const entry = screened.value

  const supabase = getSupabase()
  const { error: insertErr } = await supabase.from('troop_inbox').insert({ ...entry, troop: cfg.number })
  if (insertErr) {
    console.error('troop submit: insert failed —', insertErr.code, insertErr.message)
    return NextResponse.json({ error: "Couldn't send. Please try again in a minute." }, { status: 503 })
  }

  if (process.env.RESEND_API_KEY) {
    const { data: settings, error: settingsErr } = await supabase
      .from('troop_settings')
      .select('leader_emails')
      .eq('troop', cfg.number)
      .maybeSingle()
    if (settingsErr) console.error('troop submit: settings read failed —', settingsErr.code, settingsErr.message)
    const leaderEmails: string[] = settings?.leader_emails ?? []

    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
    const sends: Promise<unknown>[] = []

    if (leaderEmails.length) {
      const alert = troopLeaderAlertEmail({
        troopName: cfg.name,
        ...alertContent(entry),
        boardUrl: `${SITE_URL}/troop${cfg.number}#leaders`,
      })
      const replyTo = entry.kind === 'absence' ? entry.email : null
      sends.push(
        resend.emails.send({
          from,
          to: leaderEmails,
          ...(replyTo ? { replyTo } : {}),
          subject: alert.subject,
          html: alert.html,
          text: alert.text,
        }),
      )
    }
    if (entry.kind === 'absence' && entry.email) {
      const confirm = troopAbsenceConfirmEmail({
        troopName: cfg.name,
        parentFirstName: entry.parent_name.split(/\s+/)[0],
        scoutName: entry.scout_name,
        dateLabel: fmtLongDate(entry.missed_date),
      })
      sends.push(
        resend.emails.send({
          from,
          to: entry.email,
          ...(leaderEmails.length ? { replyTo: leaderEmails[0] } : {}),
          subject: confirm.subject,
          html: confirm.html,
          text: confirm.text,
        }),
      )
    }

    const results = await Promise.allSettled(sends)
    results.forEach((r, i) => {
      if (!settledOk(r)) console.warn(`troop submit: email ${i} did not send —`, JSON.stringify(r).slice(0, 300))
    })
  }

  return NextResponse.json({ success: true })
}
