/**
 * Where a job-application alert goes.
 *
 * The careers plan (docs/careers-page-plan.md) names `info@hosthampton.com` — but
 * only once a real email to it has been seen arriving. The domain's MX is
 * Cloudflare Email Routing, so `info@` delivers only if a routing rule for it
 * exists, and a missing rule can DROP mail without a bounce. An alert wired to
 * an address nobody reads is an application that exists nowhere a person looks.
 *
 * So the address is a decision recorded here, not a literal in the route:
 * `INFO_INBOX_CONFIRMED` is flipped to true only after Adam has confirmed the
 * 2026-10-11 test ("Test: careers alert routing", 22:56 UTC) landed in an inbox
 * somebody reads. Until then alerts go to `ownerEmail()` (OWNER_NOTIFY_EMAIL),
 * which every other owner alert already uses and which is known to deliver.
 */

import { ownerEmail } from './ownerNotify'

export const CAREERS_INFO_INBOX = 'info@hosthampton.com'

/**
 * See the header. Flip only on a confirmed delivery, never on "no bounce".
 * CONFIRMED 2026-10-11: Adam saw the routing test arrive.
 */
export const INFO_INBOX_CONFIRMED = true

export function careersAlertEmail(): string {
  return INFO_INBOX_CONFIRMED ? CAREERS_INFO_INBOX : ownerEmail()
}
