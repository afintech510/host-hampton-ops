/**
 * Reviewer identity. One function, its own module, on purpose.
 *
 * The Quo webhook needs to know whether an inbound text came from a reviewer,
 * but the webhook must never be able to reach the customer-send path. Keeping
 * this out of reviewLoop.ts means /api/webhooks/quo does not import
 * sendApproved.ts (and therefore Resend) even transitively — the guardrail is
 * enforced by the module graph, not only by discipline.
 */

import { normalizePhone } from '@/lib/sms'
import { reviewerPhones } from '@/lib/ownerNotify'

/**
 * Is this number a reviewer? THE identity check for the whole review loop
 * (plan §4.2): by phone number only, never by message content.
 *
 * Compared in E.164 so '6314008080', '(631) 400-8080' and '+16314008080' all
 * resolve the same. An empty or unparseable number returns false — an
 * unidentifiable sender is treated as a customer, which is the safe direction.
 */
export function isReviewerPhone(from: string | null | undefined): boolean {
  if (!from) return false
  let normalized: string
  try {
    normalized = normalizePhone(String(from).trim())
  } catch {
    return false
  }
  if (!/^\+\d{10,15}$/.test(normalized)) return false
  return reviewerPhones().includes(normalized)
}
