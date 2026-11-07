/**
 * A link that opens a NEW Gmail message to one address, from the studio mailbox.
 *
 * Gmail's own compose URL: nothing is sent or drafted until a person presses Send in
 * Gmail. `authuser` picks the studio account when several are signed in. The address is
 * checked to be a single plain address first, so a stray comma or space can never add a
 * second recipient or smuggle in another parameter.
 */

import { TENANT } from '@/tenant'

const PLAIN_EMAIL = /^[^\s@,;<>()"'\\]+@[^\s@,;<>()"'\\]+\.[^\s@,;<>()"'\\]+$/

export function studioMailbox(): string {
  return (process.env.GMAIL_USER || TENANT.contact.email).trim()
}

export function gmailComposeUrl(to: string, mailbox: string = studioMailbox()): string | null {
  const addr = (to ?? '').trim()
  if (!PLAIN_EMAIL.test(addr)) return null
  const qs = new URLSearchParams({ authuser: mailbox, view: 'cm', fs: '1', to: addr })
  return `https://mail.google.com/mail/?${qs.toString()}`
}
