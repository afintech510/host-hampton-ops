/**
 * A crew member's shift as a calendar entry. Server code only.
 *
 * The entry is the SHIFT, not the party: the time the person is committing to,
 * from when they arrive to when they are done (`rules.shiftWindow`, which
 * already knows a Party Lead arrives earlier than the crew and what Allie set
 * for the party). The party's own time is in the description.
 *
 * A calendar link goes in a text message, where there is no signed-in session,
 * so it carries its own proof: a token naming the spot, an expiry, and an HMAC
 * over the spot AND the person who holds it. Three consequences:
 *   - it works from a text with no login;
 *   - it dies when the spot changes hands (a cover, an unassign), because the
 *     holder is part of what was signed: someone who is no longer on the party
 *     can no longer open the full address;
 *   - it expires a couple of days after the shift ends.
 * It reveals one shift and one address, to the person who holds that spot.
 */

import { createHmac, timingSafeEqual } from 'crypto'
import { TENANT } from '@/tenant'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { portalSigningSecret } from '@/lib/portalAuth'
import { escapeIcsText, foldIcsLine, icsUtc } from '@/lib/evites/ics'
import { shiftWindow, type CrewSettings } from '@/lib/crew/rules'
import type { CrewPartyRow, CrewSlotRow } from '@/lib/crew/db'
import type { PartyRef } from '@/lib/crew/templates'

const DAY_S = 86_400
/** A link stays good for this long after the shift ends. */
export const CALENDAR_LINK_GRACE_DAYS = 2

const sign = (slotId: string, memberId: string, exp: number): string =>
  createHmac('sha256', portalSigningSecret()).update(`crew-cal:${slotId}:${memberId}:${exp}`).digest('hex').slice(0, 32)

/** `<slot id>.<expiry, seconds>.<signature>` */
export function signCrewCalendar(slotId: string, memberId: string, shiftEnd: Date): string {
  const exp = Math.floor(shiftEnd.getTime() / 1000) + CALENDAR_LINK_GRACE_DAYS * DAY_S
  return `${slotId}.${exp}.${sign(slotId, memberId, exp)}`
}

export function parseCrewCalendarToken(token: string): { slotId: string; exp: number; sig: string } | null {
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{9,12})\.([0-9a-f]{32})$/i.exec(token)
  return m ? { slotId: m[1].toLowerCase(), exp: Number(m[2]), sig: m[3] } : null
}

/** True when the token was signed for THIS spot and THIS holder and has not expired. */
export function verifyCrewCalendar(token: string, slot: Pick<CrewSlotRow, 'id' | 'member_id'>, now: Date): boolean {
  const t = parseCrewCalendarToken(token)
  if (!t || !slot.member_id || t.slotId !== slot.id.toLowerCase()) return false
  if (t.exp * 1000 <= now.getTime()) return false
  const want = Buffer.from(sign(slot.id, slot.member_id, t.exp))
  const got = Buffer.from(t.sig)
  return want.length === got.length && timingSafeEqual(want, got)
}

/** The public link. `format` pins the answer; with none, an Apple device gets the file and anything else gets Google. */
export function crewCalendarUrl(token: string, format?: 'ics' | 'google'): string {
  return `${CANONICAL_ORIGIN}/crew/cal/${token}${format ? `?format=${format}` : ''}`
}

export interface CrewEvent {
  uid: string
  title: string
  startsAt: Date
  endsAt: Date
  location: string
  description: string
  url: string
}

const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
const day = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' })
const range = (a: Date, b: Date) => `${clock.format(a)} to ${clock.format(b)}`

/** The entry for one assigned spot: the shift, where, and the party's own hours. */
export function crewEventFor(
  party: Pick<CrewPartyRow, 'id' | 'title' | 'theme' | 'starts_at' | 'ends_at' | 'location' | 'party_kind'> & Partial<Pick<CrewPartyRow, 'shift_starts_at' | 'shift_ends_at' | 'lead_starts_at' | 'notes_for_crew'>>,
  slot: Pick<CrewSlotRow, 'id' | 'role'>, s: CrewSettings,
): CrewEvent {
  const shift = shiftWindow(party, slot.role, s)
  const name = party.theme || party.title
  const url = `${CANONICAL_ORIGIN}/crew/parties/${party.id}`
  const lines = [
    `Your shift: ${day.format(shift.startsAt)}, ${range(shift.startsAt, shift.endsAt)}.`,
    ...(party.party_kind === 'in_studio_theme' || party.party_kind === 'mobile_party' || party.party_kind === 'manual'
      ? [`The party itself: ${range(new Date(party.starts_at), new Date(party.ends_at))}.`] : []),
    slot.role === 'lead' ? 'You are the Party Lead.' : 'You are on the crew.',
    ...(party.notes_for_crew ? [`Notes: ${party.notes_for_crew}`] : []),
    `Details and changes: ${url}`,
  ]
  return {
    uid: `crew-${slot.id}@${new URL(CANONICAL_ORIGIN).host}`,
    title: `${TENANT.business.name}: ${name}${slot.role === 'lead' ? ' (Party Lead)' : ''}`,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    location: party.location,
    description: lines.join('\n'),
    url,
  }
}

/** One VEVENT, CRLF, folded at 75 octets, times in UTC (the phone shows them in its own zone). Two alarms: the day before and two hours before. */
export function buildCrewIcs(ev: CrewEvent, now: Date = new Date()): string {
  const alarm = (trigger: string, text: string) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeIcsText(text)}`, `TRIGGER:${trigger}`, 'END:VALARM']
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${TENANT.business.name}//CREW//EN`,
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    'SEQUENCE:0',
    `DTSTAMP:${icsUtc(now)}`,
    `DTSTART:${icsUtc(ev.startsAt)}`,
    `DTEND:${icsUtc(ev.endsAt)}`,
    `SUMMARY:${escapeIcsText(ev.title)}`,
    ...(ev.location ? [`LOCATION:${escapeIcsText(ev.location)}`] : []),
    `DESCRIPTION:${escapeIcsText(ev.description)}`,
    `URL:${ev.url}`,
    ...alarm('-P1D', `Tomorrow: ${ev.title}`),
    ...alarm('-PT2H', `In two hours: ${ev.title}`),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(l => foldIcsLine(l)).join('\r\n') + '\r\n'
}

/** Google Calendar's prefilled form for the same entry. */
export function crewGoogleUrl(ev: CrewEvent): string {
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${icsUtc(ev.startsAt)}/${icsUtc(ev.endsAt)}`,
    details: ev.description,
    location: ev.location,
    ctz: 'America/New_York',
  })
  return `https://calendar.google.com/calendar/render?${q.toString()}`
}

/** A party reference with the calendar link for this spot, for the messages that carry one. */
export function withCalendar(
  ref: PartyRef,
  party: Pick<CrewPartyRow, 'id' | 'starts_at' | 'ends_at'> & Partial<Pick<CrewPartyRow, 'shift_starts_at' | 'shift_ends_at' | 'lead_starts_at'>>,
  slot: Pick<CrewSlotRow, 'id' | 'role' | 'member_id'>, s: CrewSettings,
): PartyRef {
  if (!slot.member_id) return ref
  const shift = shiftWindow(party, slot.role, s)
  return { ...ref, calUrl: crewCalendarUrl(signCrewCalendar(slot.id, slot.member_id, shift.endsAt)) }
}
