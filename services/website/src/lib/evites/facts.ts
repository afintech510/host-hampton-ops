/**
 * `inviteFacts()` - every string an invitation shows, built in ONE place
 * (spec §0.1, §3).
 *
 *   inviteFacts(booking, evite, lineItems, partyThemes, state) -> InviteFacts
 *
 * Pure. The name, date, time, theme and address come from `bookings`; the evite
 * row contributes only invitation-specific choices (theme override, host contact,
 * notes, RSVP deadline). `state` is passed in so a preview reads "Pick your date"
 * and a booked-but-timeless party reads the date alone.
 *
 * Every string that is bound into an IMAGE passes `screenForImage()` for the font
 * of the slot it lands in (spec §3). The slot fonts are those of the Glow layout
 * (spec §6; the `plain` template shares them): name `bungee`, theme word
 * `monoton`, theme sub `bungee`, age `bungee`, date `poppins600`, place and host
 * line `poppins400`, OG title `bungee`. The same strings feed the web page, so the
 * page and the picture can never disagree about a character.
 *
 * Decisions this module makes that the spec leaves open (all pinned by tests):
 *   - `honoreeDisplay` is UPPER-CASE ('MIA'); `ageOrdinal` is not ('7th') - the
 *     layout example is "7th" and the template owns any case change.
 *   - `placeLine` for the studio is "Host Hampton · 295 Montauk Hwy, Speonk" (the
 *     design mock's exact line; no state or ZIP). The calendar location carries
 *     the full address from lib/studioLocation.ts.
 *   - `rsvpDeadline` is the ISO date (`YYYY-MM-DD`) so it is hash-stable and
 *     comparable; the UI formats it.
 *   - With an evite theme override (`theme_word`/`theme_sub` set by admin
 *     `set_theme`) the evite's `template_slug` is honoured; without one the
 *     resolved theme decides. (`template_slug` defaults to 'glow' on every row,
 *     so it cannot be trusted on its own.)
 *
 * The host contact is `Allie` and the public studio line (STUDIO_PHONE_DISPLAY).
 * NEVER lib/paymentContacts.ts: that is the Venmo/Zelle number.
 *
 * Dates and times are formatted with `Intl.DateTimeFormat(..., { timeZone:
 * 'America/New_York' })` from instants made by `etToUtc`; the box is UTC.
 */

import { etToUtc, PARTY_TZ } from '@/lib/partyTime'
import { STUDIO_ADDRESS_LINE, STUDIO_LOCALITY, STUDIO_PHONE_DISPLAY, STUDIO_STREET } from '@/lib/studioLocation'
import { screenForImage } from '@/lib/evites/glyphs'
import { eviteLocationType, mobileAddressOf, mobileTown, type EviteLocationType } from '@/lib/evites/location'
import { partyWindow, validPartyDate, type PartyWindow } from '@/lib/evites/partyWindow'
import { resolveTheme, themeLabelOf, type EviteTemplateSlug } from '@/lib/evites/themes'
import type { InviteState } from '@/lib/evites/state'
import type { EviteBookingRow, EviteLineItemRow, EviteRow, PartyThemeRow } from '@/lib/evites/types'

export interface InviteFacts {
  hasName: boolean
  /** 'MIA' | 'BIRTHDAY STAR' (the star itself is an icon IMAGE slot, never a glyph). */
  honoreeDisplay: string
  /** '7th', or null when the age is missing or implausible. */
  ageOrdinal: string | null
  themeWord: string
  themeSub: string
  templateSlug: EviteTemplateSlug
  /** 'Pick your date' | 'Saturday, November 14' | 'Saturday, November 14 · 2–4 PM' */
  dateLine: string
  /** 'Pick your date' | 'Sat, Nov 14' | 'Sat, Nov 14 · 2–4 PM' */
  shortDateLine: string
  window: PartyWindow | null
  locationType: EviteLocationType
  placeLine: string
  cardPlaceLine: string
  calendarLocation: string | null
  hostContactLine: string | null
  hostNote: string | null
  giftNote: string | null
  rsvpDeadline: string | null
  guestCap: number | null
  title: string
  description: string
  shareText: string
  reshareText: string
}

export type InviteFactsBooking = Pick<
  EviteBookingRow,
  | 'party_type'
  | 'party_date'
  | 'party_time'
  | 'package_type'
  | 'guest_count_approx'
  | 'child_name'
  | 'child_age'
  | 'party_tags'
  | 'quote_snapshot'
>

export type InviteFactsEvite = Pick<
  EviteRow,
  | 'template_slug'
  | 'theme_word'
  | 'theme_sub'
  | 'host_contact_name'
  | 'host_contact_phone'
  | 'show_host_contact'
  | 'host_note'
  | 'gift_note'
  | 'rsvp_deadline'
>

export const NO_NAME_HONOREE = 'BIRTHDAY STAR'
export const PICK_A_DATE = 'Pick your date'
export const LOCATION_TBC = 'Location to be confirmed'
export const DEFAULT_HOST_NAME = 'Allie'
export const NAME_MAX_CHARS = 20

const EN_DASH = String.fromCharCode(0x2013)
const MIDDLE_DOT = String.fromCharCode(0xb7)
const SEP = ` ${MIDDLE_DOT} `

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

// ---------------------------------------------------------------- name

/** `child_name`, else `quote_snapshot.childName`: the first whitespace token, at most 20 characters. */
export function childNameOf(booking: Pick<EviteBookingRow, 'child_name' | 'quote_snapshot'>): string | null {
  const candidates = [booking.child_name, obj(booking.quote_snapshot).childName]
  for (const c of candidates) {
    if (typeof c !== 'string') continue
    const first = c.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().split(/\s+/)[0] ?? ''
    if (first !== '') return Array.from(first).slice(0, NAME_MAX_CHARS).join('')
  }
  return null
}

/** "mia" and "MIA" become "Mia"; a name typed with its own capitals ("DeShawn") is left alone. */
function casedName(s: string): string {
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) return s
  const chars = Array.from(s.toLowerCase())
  return chars.length === 0 ? '' : chars[0].toLocaleUpperCase('en-US') + chars.slice(1).join('')
}

function ordinalOf(age: unknown): string | null {
  const n = typeof age === 'number' ? age : NaN
  if (!Number.isInteger(n) || n < 1 || n > 99) return null
  const mod100 = n % 100
  const mod10 = n % 10
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th'
  return `${n}${suffix}`
}

// ---------------------------------------------------------------- dates and times (Eastern only)

function etFormat(instant: Date, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat('en-US', { timeZone: PARTY_TZ, ...opts }).formatToParts(instant)
}

function part(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((p) => p.type === type)?.value ?? ''
}

/** 'Saturday, November 14' and 'Sat, Nov 14' for a `YYYY-MM-DD` Eastern calendar date. */
function dateTexts(date: string): { long: string; short: string } {
  const noon = etToUtc(date, 12, 0)
  const l = etFormat(noon, { weekday: 'long', month: 'long', day: 'numeric' })
  const s = etFormat(noon, { weekday: 'short', month: 'short', day: 'numeric' })
  return {
    long: `${part(l, 'weekday')}, ${part(l, 'month')} ${part(l, 'day')}`,
    short: `${part(s, 'weekday')}, ${part(s, 'month')} ${part(s, 'day')}`,
  }
}

function etClock(instant: Date): { h: number; m: number } {
  const p = etFormat(instant, { hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
  return { h: Number(part(p, 'hour')) % 24, m: Number(part(p, 'minute')) }
}

function clock12(c: { h: number; m: number }): { text: string; period: 'AM' | 'PM' } {
  const h12 = c.h % 12 === 0 ? 12 : c.h % 12
  return { text: c.m === 0 ? `${h12}` : `${h12}:${String(c.m).padStart(2, '0')}`, period: c.h >= 12 ? 'PM' : 'AM' }
}

/** '2–4 PM', '11 AM–1 PM', '2:30–4:30 PM': minutes only when non-zero, the period once when shared. */
export function timeRangeText(win: PartyWindow): string {
  const a = clock12(etClock(win.startUtc))
  const b = clock12(etClock(win.endUtc))
  return a.period === b.period ? `${a.text}${EN_DASH}${b.text} ${b.period}` : `${a.text} ${a.period}${EN_DASH}${b.text} ${b.period}`
}

// ---------------------------------------------------------------- host contact

/** '(631) 998-9325', '+1 631 998 9325', '6319989325' -> '631-998-9325'; null if it is not a NANP number. */
export function normalizeHostPhone(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  let d = raw.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  if (!/^[2-9]\d{9}$/.test(d)) return null
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`
}

function hostContactLine(evite: InviteFactsEvite): string | null {
  if (evite.show_host_contact === false) return null
  const rawName = typeof evite.host_contact_name === 'string' ? evite.host_contact_name.replace(/[\x00-\x1f\x7f]+/g, ' ').trim() : ''
  const name = screenForImage(Array.from(rawName).slice(0, 40).join(''), 'poppins400') || DEFAULT_HOST_NAME
  // The DB CHECK is ^[2-9]xx-xxx-xxxx$; anything else (a stale or hand-edited row) means "studio default".
  const phone = normalizeHostPhone(evite.host_contact_phone) ?? (normalizeHostPhone(STUDIO_PHONE_DISPLAY) as string)
  return screenForImage(`Any questions? Ask ${name}${SEP}${phone}`, 'poppins400')
}

// ---------------------------------------------------------------- the facts

function article(word: string): 'a' | 'an' {
  return /^[aeiou]/i.test(word) ? 'an' : 'a'
}

function trimmedOrNull(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+/g, ' ').trim()
  return s === '' ? null : Array.from(s).slice(0, max).join('')
}

export function inviteFacts(
  booking: InviteFactsBooking,
  evite: InviteFactsEvite,
  lineItems: readonly EviteLineItemRow[],
  partyThemes: readonly PartyThemeRow[],
  state: InviteState,
): InviteFacts {
  // ---- name and age
  const rawName = childNameOf(booking)
  const nameForImage = rawName ? screenForImage(rawName.toLocaleUpperCase('en-US'), 'bungee') : ''
  const hasName = nameForImage !== ''
  const honoreeDisplay = hasName ? nameForImage : NO_NAME_HONOREE
  const displayName = hasName ? casedName(screenForImage(rawName as string, 'bungee')) : ''
  const ageOrdinal = ordinalOf(booking.child_age)

  // ---- theme (resolved, then the evite's own override)
  const resolved = resolveTheme(booking, lineItems, partyThemes)
  const wordOverride = typeof evite.theme_word === 'string' ? screenForImage(evite.theme_word.trim(), 'monoton') : ''
  const subOverride = typeof evite.theme_sub === 'string' ? screenForImage(evite.theme_sub.trim(), 'bungee') : ''
  const overridden = wordOverride !== '' || subOverride !== ''
  const themeWord = screenForImage(wordOverride !== '' ? wordOverride.toLocaleUpperCase('en-US') : resolved.themeWord, 'monoton') || resolved.themeWord
  const themeSub = screenForImage(subOverride !== '' ? subOverride.toLocaleUpperCase('en-US') : resolved.themeSub, 'bungee') || resolved.themeSub
  const templateSlug: EviteTemplateSlug =
    overridden && (evite.template_slug === 'glow' || evite.template_slug === 'plain') ? evite.template_slug : resolved.templateSlug
  const label = themeLabelOf(themeWord)

  // ---- when
  const partyWin = partyWindow(booking)
  const date = validPartyDate(booking.party_date)
  const texts = date ? dateTexts(date) : null
  let dateLine = PICK_A_DATE
  let shortDateLine = PICK_A_DATE
  if (texts && state !== 'preview') {
    const withTime = partyWin !== null && state !== 'needs_time'
    dateLine = withTime ? `${texts.long}${SEP}${timeRangeText(partyWin as PartyWindow)}` : texts.long
    shortDateLine = withTime ? `${texts.short}${SEP}${timeRangeText(partyWin as PartyWindow)}` : texts.short
  }
  dateLine = screenForImage(dateLine, 'poppins600')
  shortDateLine = screenForImage(shortDateLine, 'poppins600')

  // ---- where
  const locationType = eviteLocationType(booking)
  const studioTown = STUDIO_LOCALITY.split(',')[0].trim()
  let placeLine: string
  let cardPlaceLine: string
  let calendarLocation: string | null
  if (locationType === 'studio') {
    placeLine = `Host Hampton${SEP}${STUDIO_STREET}, ${studioTown}`
    cardPlaceLine = `Host Hampton, ${studioTown}`
    calendarLocation = `Host Hampton, ${STUDIO_ADDRESS_LINE}`
  } else {
    const address = mobileAddressOf(booking)
    placeLine = address ?? LOCATION_TBC
    cardPlaceLine = address ? mobileTown(address) : LOCATION_TBC
    calendarLocation = address
  }
  placeLine = screenForImage(placeLine, 'poppins400') || LOCATION_TBC
  cardPlaceLine = screenForImage(cardPlaceLine, 'poppins400') || LOCATION_TBC

  // ---- words
  const partyNoun = label ? `${label} Party` : 'Birthday Party'
  const unnamedNoun = label ? `${label} Birthday Party` : 'Birthday Party'
  const title = screenForImage(hasName ? `${displayName}'s ${partyNoun}` : unnamedNoun, 'bungee')
  const onDate = texts ? ` on ${texts.short}` : ''
  const shareText = hasName
    ? `You're invited to ${displayName}'s ${partyNoun}${onDate}! RSVP here:`
    : `You're invited to ${article(unnamedNoun)} ${unnamedNoun}${onDate}! RSVP here:`
  const reshareText = hasName
    ? `Still hoping you can make ${displayName}'s party${onDate}! RSVP here:`
    : `Still hoping you can make the party${onDate}! RSVP here:`

  let description: string
  if (state === 'preview') description = `${title}. RSVPs open once the party is booked.`
  else if (state === 'needs_time') description = `${title}. ${dateLine}. Start time coming soon.`
  else description = `${title}. ${dateLine}. ${cardPlaceLine}. RSVP online.`

  return {
    hasName,
    honoreeDisplay,
    ageOrdinal,
    themeWord,
    themeSub,
    templateSlug,
    dateLine,
    shortDateLine,
    window: partyWin,
    locationType,
    placeLine,
    cardPlaceLine,
    calendarLocation,
    hostContactLine: hostContactLine(evite),
    hostNote: trimmedOrNull(evite.host_note, 140),
    giftNote: trimmedOrNull(evite.gift_note, 140),
    rsvpDeadline: validPartyDate(evite.rsvp_deadline),
    guestCap:
      typeof booking.guest_count_approx === 'number' && Number.isInteger(booking.guest_count_approx) && booking.guest_count_approx > 0
        ? booking.guest_count_approx
        : null,
    title,
    description,
    shareText,
    reshareText,
  }
}
