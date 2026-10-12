/**
 * What a slot says and whether it is shown. CLIENT-SAFE and shared by the sizing
 * pass (`lib/evites/layout.ts`, server) and the canvas (browser and Satori), so
 * the string that was MEASURED is the string that is DRAWN.
 */

import type { InviteFacts } from '@/lib/evites/facts'
import type { ShowWhen, TextSlot } from '@/lib/evites/templates/types'

/** `showWhen: 'ageOrdinal'` is "truthy"; `'!hasName'` is "falsy". Absent is "always". */
export function showWhenOk(cond: ShowWhen | undefined, facts: InviteFacts): boolean {
  if (cond === undefined) return true
  const negate = cond.startsWith('!')
  const key = (negate ? cond.slice(1) : cond) as keyof InviteFacts
  const truthy = Boolean(facts[key])
  return negate ? !truthy : truthy
}

/** "SLEEP UNDER" -> "Sleep Under", "K-POP" -> "K-Pop": the first letter of each word (after a space or hyphen) upper, the rest lower. */
export function toTitleCase(s: string): string {
  return s
    .toLocaleLowerCase('en-US')
    .replace(/(^|[\s-])(\S)/g, (_m, sep: string, c: string) => sep + c.toLocaleUpperCase('en-US'))
}

/** The text a text slot draws: its static text, else its bound fact; upper- or title-cased when the slot says so. */
export function slotText(slot: TextSlot, facts: InviteFacts): string {
  let raw = ''
  if (slot.staticText !== undefined) raw = slot.staticText
  else if (slot.bind !== undefined) {
    const v = facts[slot.bind]
    raw = typeof v === 'string' ? v : ''
  }
  if (slot.uppercase) return raw.toLocaleUpperCase('en-US')
  return slot.titleCase ? toTitleCase(raw) : raw
}
