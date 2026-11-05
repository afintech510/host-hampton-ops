/**
 * Which paths the website chat must NEVER appear on.
 *
 * Imported by a client component, so it imports only `crewChrome` and
 * `evites/chrome` (both import-free) and runs anywhere. A prefix list, not a
 * pattern: every entry is a surface where a chat bubble is wrong for a reason.
 *
 *   /admin, /crew          staff tools with their own shells
 *   /plan, /my-booking     a customer's own booking, invoice and payment — the
 *                          bubble would sit beside a figure it could contradict
 *   /checkout and friends  a payment is in progress; nothing should compete
 *   /party-builder, /party-planner, /studio-rental
 *                          the planners price live on screen; a second quote in
 *                          a chat bubble next to them is two answers to one
 *                          question
 *   /i/, /troop2514        pages about children shared by link (same list the
 *                          Crisp bubble hides on)
 *   /checkin, /review, /s, /r, /unsubscribe
 *                          token links: a path that is itself a credential
 */

import { isCrewPath } from '@/lib/crewChrome'
import { isInvitePath } from '@/lib/evites/chrome'

export const CHAT_HIDDEN_PREFIXES: readonly string[] = [
  '/admin',
  '/plan',
  '/my-booking',
  '/checkout',
  '/party-checkout',
  '/book/success',
  '/party-builder',
  '/party-planner',
  '/studio-rental',
  '/checkin',
  '/review',
  '/unsubscribe',
  '/troop2514',
  '/party-quote',
  '/kids-party-menu',
  '/s',
  '/r',
]

/** True when the chat must not render on this path. `null` (outside the router) is hidden: no path, no chat. */
export function chatHiddenOn(pathname: string | null | undefined): boolean {
  if (typeof pathname !== 'string' || pathname === '') return true
  if (isCrewPath(pathname) || isInvitePath(pathname)) return true
  return CHAT_HIDDEN_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`))
}
