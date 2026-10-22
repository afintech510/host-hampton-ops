/**
 * The two emails the troop board (/troop2514, migration 074) sends.
 *
 *   troopLeaderAlertEmail      → to the leader emails saved in the Setup panel,
 *                                one per absence note, idea or message. Every
 *                                family value is escaped at entry; the one link
 *                                (the board) goes through `mailHref`.
 *   troopAbsenceConfirmEmail   → to a parent who left an email on the "Can't make
 *                                it" form. Signed by the troop's leaders, not by
 *                                Host Hampton: this is the troop's page.
 *
 * The plain-text halves are built from the RAW values and never escaped.
 */

import { escapeFields, mailHref } from '../emailSafety'

/** Subject lines are a header, not markup: flatten whitespace, never escape. */
function subjectSafe(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 120)
}

const ROW = 'padding:6px 12px 6px 0;color:#5b6d61;font-size:13px;vertical-align:top;white-space:nowrap;'
const VAL = 'padding:6px 0;color:#18261d;font-size:14px;vertical-align:top;white-space:pre-wrap;'

export interface TroopLeaderAlert {
  troopName: string
  /** "Absence", "Idea", "Message". */
  kindLabel: string
  headline: string
  rows: { label: string; value: string }[]
  boardUrl: string
}

export function troopLeaderAlertEmail(raw: TroopLeaderAlert): { subject: string; html: string; text: string } {
  const d = escapeFields(raw)
  const link = mailHref(raw.boardUrl)

  const rows = d.rows
    .map(r => `<tr><td style="${ROW}">${r.label}</td><td style="${VAL}">${r.value}</td></tr>`)
    .join('')

  const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18261d;">
    <p style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#00773c;margin:0 0 4px;">${d.troopName} · ${d.kindLabel}</p>
    <h2 style="font-size:20px;margin:0 0 14px;">${d.headline}</h2>
    <table style="border-collapse:collapse;">${rows}</table>
    ${link ? `<p style="margin-top:20px;"><a href="${mailHref(raw.boardUrl)}" style="display:inline-block;background:#00AE58;color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:999px;">Open the Leaders tab</a></p>` : ''}
    <p style="font-size:12px;color:#888;margin-top:20px;">Sent from the troop's family page. Only leaders receive these.</p>
  </div>`

  const text = [
    `${raw.troopName} - ${raw.kindLabel}`,
    raw.headline,
    '',
    ...raw.rows.map(r => `${r.label}: ${r.value}`),
    '',
    `Leaders tab: ${raw.boardUrl}`,
  ].join('\n')

  return { subject: subjectSafe(`${raw.troopName}: ${raw.headline}`), html, text }
}

export interface TroopAbsenceConfirm {
  troopName: string
  parentFirstName: string
  scoutName: string
  /** "Thursday, Oct 23". */
  dateLabel: string
}

export function troopAbsenceConfirmEmail(raw: TroopAbsenceConfirm): { subject: string; html: string; text: string } {
  const d = escapeFields(raw)

  const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18261d;">
    <h2 style="font-size:20px;margin-bottom:12px;">Thanks, ${d.parentFirstName}!</h2>
    <p style="font-size:14px;line-height:1.7;color:#444;">The leaders know ${d.scoutName} will miss ${d.dateLabel}. We'll see you at the next one.</p>
    <p style="font-size:14px;line-height:1.7;color:#444;margin-top:24px;">${d.troopName} leaders</p>
  </div>`

  const text = [
    `Thanks, ${raw.parentFirstName}!`,
    '',
    `The leaders know ${raw.scoutName} will miss ${raw.dateLabel}. We'll see you at the next one.`,
    '',
    `${raw.troopName} leaders`,
  ].join('\n')

  return { subject: subjectSafe(`${raw.troopName}: got your note about ${raw.dateLabel}`), html, text }
}
