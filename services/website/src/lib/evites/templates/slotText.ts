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

/** The text a text slot draws: its static text, else its bound fact; upper-cased when the slot says so. */
export function slotText(slot: TextSlot, facts: InviteFacts): string {
  let raw = ''
  if (slot.staticText !== undefined) raw = slot.staticText
  else if (slot.bind !== undefined) {
    const v = facts[slot.bind]
    raw = typeof v === 'string' ? v : ''
  }
  return slot.uppercase ? raw.toLocaleUpperCase('en-US') : raw
}
