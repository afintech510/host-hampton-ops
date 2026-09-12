/**
 * The payment nothing claimed — so it is never the payment nobody saw.
 *
 * ── The incident this exists for ────────────────────────────────────────────
 *
 * On 2026-09-12 a real customer paid **$927.00** on a live Stripe Payment Link
 * and it was recorded NOWHERE: no `booking_payments` row, no
 * `financial_transactions` row, no booking. Her earlier $257.50 deposit — paid
 * through a link the APP created — recorded correctly one second later.
 *
 * The difference was metadata. Every branch of `/api/webhook`'s
 * `checkout.session.completed` handler keys on `session.metadata.type`, and that
 * link had been created BY HAND in the Stripe dashboard, so its metadata was
 * `{}`. With nothing to match, the session fell through every branch into the
 * legacy "party booking deposit" tail, which unconditionally inserts a
 * `bookings` row — and that insert was refused by
 * `bookings_contact_reachable_check` (no email, no phone in the metadata to put
 * on it), after which the handler threw a `TypeError` formatting a confirmation
 * email for a customer it did not have. Reproduced in production, exactly:
 *
 *     Supabase insert error: 23514 bookings_contact_reachable_check
 *     ⨯ TypeError: Cannot read properties of undefined (reading 'split')
 *     → HTTP 500
 *
 * So Stripe retried, gave up, and the only trace of $927 was a stack trace in a
 * container log and a failed event in a dashboard nobody opens.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 *
 * An UNATTRIBUTABLE payment is a bookkeeping problem: annoying, fixable, and
 * visible. An INVISIBLE payment is a lost payment. So a settled session that
 * nothing claims is written where Adam already looks — the Financials tab —
 * tagged so it reads as needing attention, and he is emailed. Then it is
 * ACKNOWLEDGED, because a 500 here buys nothing: retrying the same unclaimable
 * session produces the same nothing, three days running.
 *
 * This is hard-won rule 10 on a money path: a guardrail that drops something
 * must say that it dropped it. Silence is what success looks like, which is why
 * nobody noticed.
 */

import type Stripe from 'stripe'
import { Resend } from 'resend'
import { getSupabase } from '@/lib/supabase'
import { ownerEmail } from '@/lib/ownerNotify'
import { escapeHtml } from '@/lib/escapeHtml'
import { money } from '@/lib/planInvoice'
import { isUniqueViolation } from '@/lib/planPayment'

type Supa = ReturnType<typeof getSupabase>

/** The category an unclaimed payment lands in, so it is filterable in the admin Financials tab. */
export const UNCLAIMED_CATEGORY = 'Unmatched Stripe Payment'

/**
 * Is this session one the metadata-keyed branches can still handle?
 *
 * Deliberately phrased as "does the legacy booking fallthrough have what it
 * needs", not "is the metadata empty": a dashboard link could carry some
 * unrelated metadata and still be unclaimable. `contactEmail` / `contactPhone`
 * are exactly the two fields `bookings_contact_reachable_check` requires, so
 * this predicate is the constraint that made the insert impossible, restated in
 * the one place that can do something about it.
 */
export function isUnclaimableSession(metadata: Stripe.Metadata | null | undefined): boolean {
  const m = metadata ?? {}
  return !m.contactEmail && !m.contactPhone
}

export type UnclaimedResult =
  | { recorded: true; duplicate: boolean; reference: string }
  | { recorded: false; reason: string }

/**
 * Record a settled Stripe session that no handler claimed.
 *
 * Keyed on the session id, so `(source, reference)`'s unique index makes a
 * redelivery a no-op rather than a second phantom row.
 */
export async function recordUnclaimedStripeSession(
  session: Stripe.Checkout.Session,
  db?: Supa,
): Promise<UnclaimedResult> {
  const supabase = db ?? getSupabase()
  const amountCents = session.amount_total ?? 0
  const email = session.customer_details?.email ?? null
  const name = session.customer_details?.name ?? null
  const linkId = typeof session.payment_link === 'string' ? session.payment_link : session.payment_link?.id ?? null

  // Nothing settled means nothing to chase. An abandoned or zero session is not
  // a lost payment, and a $0 row in the Financials tab is noise that teaches
  // Adam to ignore the category.
  if (amountCents <= 0 || session.payment_status === 'unpaid') {
    console.warn(
      `unclaimed stripe session ${session.id}: amount_total=${String(session.amount_total)} payment_status=${String(session.payment_status)} — nothing settled, not recording`,
    )
    return { recorded: false, reason: 'nothing settled' }
  }

  console.error(
    `UNCLAIMED STRIPE PAYMENT: ${money(amountCents)} on session ${session.id}` +
      `${linkId ? ` (payment link ${linkId})` : ''}${email ? ` from ${email}` : ''}` +
      ' — no handler matched it. Recorded to financial_transactions for review.',
  )

  const reference = `stripe-unmatched-${session.id}`
  const { error } = await supabase.from('financial_transactions').insert({
    date: new Date().toISOString().split('T')[0],
    description:
      `UNMATCHED Stripe payment — needs attribution` +
      `${name ? ` (${name})` : ''}${linkId ? ` · link ${linkId}` : ''}`,
    amount_cents: amountCents,
    source: 'stripe',
    category: UNCLAIMED_CATEGORY,
    customer_name: name,
    reference,
    notes: [email, `session ${session.id}`, linkId ? `payment_link ${linkId}` : null]
      .filter(Boolean)
      .join(' · '),
  })

  if (error && !isUniqueViolation(error)) {
    // Now it really is invisible. This is the one case here that needs a human,
    // and the log line above is the alert.
    console.error(`UNCLAIMED STRIPE PAYMENT ${session.id}: could not even record it:`, error.message)
    return { recorded: false, reason: error.message }
  }
  const duplicate = !!error

  // Only tell Adam the first time. A redelivery is not a second payment.
  if (!duplicate) await notifyOwner(session, amountCents, email, name, linkId)

  return { recorded: true, duplicate, reference }
}

async function notifyOwner(
  session: Stripe.Checkout.Session,
  amountCents: number,
  email: string | null,
  name: string | null,
  linkId: string | null,
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return
  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
  try {
    await resend.emails.send({
      from,
      to: ownerEmail(),
      subject: `Unmatched Stripe payment: ${money(amountCents)}${name ? ` from ${name}` : ''} — needs attribution`,
      html:
        `<p style="font-family:sans-serif;font-size:15px">` +
        `<strong>${money(amountCents)}</strong> was paid on Stripe and we could not tell which booking it belongs to.<br><br>` +
        `It has been recorded in Financials under <strong>${escapeHtml(UNCLAIMED_CATEGORY)}</strong> so the money is not lost, ` +
        `but it is not attached to any party plan.<br><br>` +
        `Customer: ${escapeHtml(name) || '—'}${email ? ` &lt;${escapeHtml(email)}&gt;` : ''}<br>` +
        `Stripe session: <code>${escapeHtml(session.id)}</code><br>` +
        (linkId ? `Payment link: <code>${escapeHtml(linkId)}</code><br>` : '') +
        `<br>This usually means the payment link was made by hand in the Stripe dashboard rather than from a party plan. ` +
        `Links made from a plan's invoice page record themselves.` +
        `</p>`,
    })
  } catch (err) {
    console.error('unclaimed payment owner notify (non-fatal):', err instanceof Error ? err.message : err)
  }
}
