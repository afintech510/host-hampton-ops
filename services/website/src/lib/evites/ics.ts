/**
 * The invitation as a calendar entry (spec §8).
 *
 *   buildIcs(facts, evite, url, { method, now?, editUrl? }) -> string   (CRLF, folded at 75 octets)
 *   googleCalendarUrl(facts, url)                              -> string
 *
 * One VEVENT. `UID` is `evite-<evite id>@hosthampton.com` so the same party is the
 * same event on every import; `SEQUENCE` is the evite's `cal_version` (a CANCEL is
 * `cal_version + 1` with `STATUS:CANCELLED`, so a calendar app takes it as newer
 * than the PUBLISH it replaces). Times are UTC (`...Z`): the entry lands at the
 * right wall-clock time in the guest's own zone, and `ctz` on the Google link pins
 * Eastern for the form it opens.
 *
 * `SUMMARY` is `facts.title + ' 🎉'`: the facts' own natural-case title ("Mia's Glow
 * Party", or "Glow Birthday Party" with no name), NOT the upper-case image string.
 * Unlike an image, an .ics carries UTF-8 and the emoji is fine here.
 *
 * Two VALARMs (`ACTION:DISPLAY`, each WITH a `DESCRIPTION` - RFC 5545 requires one
 * for DISPLAY and several clients drop an alarm without it): a day before and two
 * hours before. Google Calendar ignores imported alarms, and a phone's saved copy
 * never updates itself; both are documented limits (spec §8).
 *
 * Text values are escaped per RFC 5545 §3.3.11 (`\`, `;`, `,`, newline), and every
 * content line is folded at 75 OCTETS without ever splitting a UTF-8 sequence.
 *
 * Pure and deterministic given `now`. THROWS when the party has no window: callers
 * only build a calendar entry for a `live` invitation, which has one.
 */

import type { InviteFacts } from '@/lib/evites/facts'

export type IcsMethod = 'PUBLISH' | 'CANCEL'

export interface IcsOptions {
  method: IcsMethod
  /** `DTSTAMP`; injectable so a golden file is stable. */
  now?: Date
  /** The guest's own signed edit link for "Plans changed?"; defaults to the invitation URL. */
  editUrl?: string
}

export interface IcsEvite {
  id: string
  cal_version: number
}

export const ICS_PRODID = '-//Host Hampton//EVITE//EN'
export const PARTY_POPPER = '\u{1F389}'
export const ICS_FOLD_OCTETS = 75

/** RFC 5545 §3.3.11 TEXT escaping. Backslash first, or the escapes below would be doubled. */
export function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/** A content line stripped of anything that could end the line early (CR, LF, other controls). */
function plain(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[\r\n]+/g, ' ')
}

/**
 * Fold one content line at `limit` octets. Continuation lines start with one space,
 * which counts toward their own limit. A code point is never split: its whole UTF-8
 * sequence moves to the next line.
 */
export function foldIcsLine(line: string, limit: number = ICS_FOLD_OCTETS): string {
  const out: string[] = []
  let cur = ''
  let curBytes = 0
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8')
    const max = out.length === 0 ? limit : limit - 1 // a continuation carries a leading space
    if (curBytes + b > max) {
      out.push(cur)
      cur = ''
      curBytes = 0
    }
    cur += ch
    curBytes += b
  }
  out.push(cur)
  return out.map((l, i) => (i === 0 ? l : ` ${l}`)).join('\r\n')
}

/** `20261114T190000Z` */
export function icsUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

export type IcsFacts = Pick<InviteFacts, 'window' | 'title' | 'calendarLocation' | 'hostContactLine'>

function summaryOf(facts: IcsFacts): string {
  return `${facts.title} ${PARTY_POPPER}`
}

function descriptionLines(facts: IcsFacts, url: string, editUrl: string): string[] {
  const lines: string[] = []
  if (facts.hostContactLine) lines.push(facts.hostContactLine)
  lines.push(url)
  lines.push(`Plans changed? Update your RSVP: ${editUrl}`)
  return lines
}

export function buildIcs(facts: IcsFacts, evite: IcsEvite, url: string, opts: IcsOptions): string {
  const win = facts.window
  if (!win) throw new Error('evites/ics: the party has no start time, so there is nothing to put in a calendar')
  const now = opts.now ?? new Date()
  const cancel = opts.method === 'CANCEL'
  const sequence = evite.cal_version + (cancel ? 1 : 0)

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${ICS_PRODID}`,
    `METHOD:${opts.method}`,
    'BEGIN:VEVENT',
    `UID:evite-${plain(evite.id)}@hosthampton.com`,
    `SEQUENCE:${sequence}`,
    ...(cancel ? ['STATUS:CANCELLED'] : []),
    `DTSTAMP:${icsUtc(now)}`,
    `DTSTART:${icsUtc(win.startUtc)}`,
    `DTEND:${icsUtc(win.endUtc)}`,
    `SUMMARY:${escapeIcsText(summaryOf(facts))}`,
    ...(facts.calendarLocation ? [`LOCATION:${escapeIcsText(facts.calendarLocation)}`] : []),
    `URL:${plain(url)}`,
    `DESCRIPTION:${escapeIcsText(descriptionLines(facts, url, opts.editUrl ?? url).join('\n'))}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    'TRIGGER:-P1D',
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    'TRIGGER:-PT2H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map((l) => foldIcsLine(l)).join('\r\n') + '\r\n'
}

/**
 * Google Calendar's "add event" form, prefilled. `dates` is `<start>/<end>` in UTC;
 * `ctz=America/New_York` pins the zone the form displays. Query values are
 * percent-encoded; the `/` in `dates` and `ctz` is left literal, which is what
 * Google's own links do.
 */
export function googleCalendarUrl(facts: IcsFacts, url: string, editUrl?: string): string {
  const win = facts.window
  if (!win) throw new Error('evites/ics: the party has no start time, so there is nothing to put in a calendar')
  const enc = encodeURIComponent
  const parts = [
    'action=TEMPLATE',
    `text=${enc(summaryOf(facts))}`,
    `dates=${icsUtc(win.startUtc)}/${icsUtc(win.endUtc)}`,
    `details=${enc(descriptionLines(facts, url, editUrl ?? url).join('\n'))}`,
    ...(facts.calendarLocation ? [`location=${enc(facts.calendarLocation)}`] : []),
    'ctz=America/New_York',
  ]
  return `https://calendar.google.com/calendar/render?${parts.join('&')}`
}
