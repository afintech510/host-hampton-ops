/**
 * Change detection for the two things an invitation can go stale on
 * (spec §2 `hash.ts`, §5, §8).
 *
 *   renderInputsHash(facts)  what is PRINTED on the image. When it differs from
 *                            `evites.render_inputs_hash` the image is re-rendered.
 *   calInputsHash(facts)     what a calendar entry says. When it differs from
 *                            `evites.cal_inputs_hash` the ICS SEQUENCE bumps and
 *                            guests are told "details changed" - so it must NOT
 *                            move for anything a guest's calendar does not show.
 *
 * Both hash a CANONICAL JSON (object keys sorted, recursively), so a change in
 * key order is never a change in content.
 *
 * `RENDER_LAYOUT_TAG` is part of the render hash on purpose: changing a template
 * (fonts, positions, art) leaves every fact the same, and without a tag nothing
 * would notice that every stored image is out of date. Bump it with the template.
 *
 * The calendar TITLE is deliberately theme-free ("Mia's Birthday Party"): a
 * theme change (Glow -> Swiftie, an admin `set_theme`) re-renders the image but
 * must not tell guests that the details of their calendar entry changed. The
 * spec lists `title` among the calendar inputs and the P03 acceptance test says
 * a theme change leaves the hash alone; `facts.title` carries the theme, so the
 * hash uses this theme-free form of it.
 */

import { createHash } from 'crypto'
import type { InviteFacts } from '@/lib/evites/facts'

export const RENDER_LAYOUT_TAG = 'glow-v3'

/** JSON with sorted keys; Dates as ISO strings; `undefined` omitted. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(v: unknown): unknown {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : null
  if (Array.isArray(v)) return v.map(canonicalize)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k]
      if (x !== undefined) out[k] = canonicalize(x)
    }
    return out
  }
  return v
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/** Everything that is printed on the portrait or the OG card. */
export function renderInputsHash(facts: InviteFacts): string {
  return sha256(
    canonicalJson({
      layout: RENDER_LAYOUT_TAG,
      templateSlug: facts.templateSlug,
      hasName: facts.hasName,
      honoreeDisplay: facts.honoreeDisplay,
      honoreePossessive: facts.honoreePossessive,
      honoreeName: facts.honoreeName,
      ageOrdinal: facts.ageOrdinal,
      ageNumber: facts.ageNumber,
      ageWords: facts.ageWords,
      yearsOld: facts.yearsOld,
      weekdayText: facts.weekdayText,
      monthText: facts.monthText,
      dayText: facts.dayText,
      timeText: facts.timeText,
      themeWord: facts.themeWord,
      themeSub: facts.themeSub,
      dateLine: facts.dateLine,
      shortDateLine: facts.shortDateLine,
      placeLine: facts.placeLine,
      cardPlaceLine: facts.cardPlaceLine,
      hostContactLine: facts.hostContactLine,
      title: facts.title,
    }),
  )
}

/** The calendar entry's title: the child and the occasion, never the theme. */
export function calTitleOf(facts: Pick<InviteFacts, 'hasName' | 'honoreeDisplay'>): string {
  return facts.hasName ? `${facts.honoreeDisplay}'s Birthday Party` : 'Birthday Party'
}

/** Start, end, location and title: the four things a calendar entry shows. */
export function calInputsHash(facts: InviteFacts): string {
  return sha256(
    canonicalJson({
      start: facts.window ? facts.window.startUtc : null,
      end: facts.window ? facts.window.endUtc : null,
      location: facts.calendarLocation,
      title: calTitleOf(facts),
    }),
  )
}
