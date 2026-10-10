/**
 * The side effects of an RSVP that are NOT part of saving it (spec §7.5, §9.1).
 *
 *   onRsvpCreated   after a POST:           `new_rsvp` -> parent, `rsvp_confirmed` -> guest (P09)
 *   onRsvpChanged   after a material PATCH: `rsvp_changed` -> parent (P09)
 *
 * P06 shipped NO-OP defaults; P09 installs the real ones (`inlineSends.ts`: claim in
 * `evite_sends`, then send), which do nothing while `EVITES_SENDS` is off. They are
 * properties of one mutable object so a test can `jest.spyOn(rsvpHooks, 'onRsvpCreated')`
 * and swap the implementation without touching the route.
 *
 * The route calls them through `fireRsvpHook`, which:
 *   - is NOT awaited by the request (a slow provider must not slow a guest);
 *   - never throws and never rejects (an email failure must never turn a saved
 *     RSVP into an error page: the guest already has their answer in).
 */

import { sendOnRsvpChanged, sendOnRsvpCreated } from '@/lib/evites/inlineSends'

export interface RsvpHookContext {
  eviteId: string
  rsvpId: string
  slug: string
  /** The row's revision AFTER the write. */
  revision: number
  status: 'yes' | 'no'
}

export type RsvpHook = (ctx: RsvpHookContext) => void | Promise<void>

export const rsvpHooks: { onRsvpCreated: RsvpHook; onRsvpChanged: RsvpHook } = {
  onRsvpCreated: sendOnRsvpCreated,
  onRsvpChanged: sendOnRsvpChanged,
}

export function fireRsvpHook(name: keyof typeof rsvpHooks, ctx: RsvpHookContext): void {
  try {
    const out = rsvpHooks[name](ctx)
    if (out && typeof (out as Promise<void>).catch === 'function') {
      ;(out as Promise<void>).catch((e) => console.error(`evites/rsvpHooks: ${name} failed: ${e instanceof Error ? e.message : String(e)}`))
    }
  } catch (e) {
    console.error(`evites/rsvpHooks: ${name} failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}
