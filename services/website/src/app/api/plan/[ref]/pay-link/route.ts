/**
 * `POST /api/plan/[ref]/pay-link` — mint the link, take no money (Phase 5 item 2).
 *
 * The customer's own invoice page calls this, and so does the admin panel. It
 * creates a Stripe Payment Link, records it in `booking_pay_links`, and returns
 * the URL. It never records a payment: only the Stripe webhook does that, after
 * verifying a signature. See lib/planPayment.ts.
 *
 * ── What this route refuses ────────────────────────────────────────────────
 *
 *   * **An amount in the request body.** `purpose` comes from the client;
 *     the figure is derived from `loadPlanInvoice()` server-side. A body-supplied
 *     amount is a discount coupon for anyone who can edit a request. The single
 *     exception is an admin `custom` amount, which is capped at what the plan
 *     actually owes — see `quoteFor` in lib/planPayLinks.ts.
 *
 *     `tipCents` is the one other figure that arrives from the browser, and it
 *     is accepted for a reason that does not generalise: a tip can only ever
 *     RAISE the charge, so the attack the rule above exists to stop has no
 *     version of itself in this direction. It is still clamped
 *     (`screenTipCents`) and still dropped on any purpose but `balance`.
 *   * **Someone else's plan.** `planAccess()` requires a portal cookie naming
 *     THIS ref, or an admin session. This is the same function the summary page
 *     uses, deliberately, so the page and the money path cannot drift apart.
 *   * **A cancelled plan** — refused in `createPlanPayLink`, and recorded in the
 *     ledger when it is, because a guardrail that stops something silently is
 *     indistinguishable from one that never fired.
 *   * **A GET.** Minting has side effects (it deactivates the previous link), so
 *     it must not be reachable by navigation or by a prefetch.
 */

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'
import { planAccess } from '@/lib/planAccess'
import { adminActorId, isAdminAuthorized } from '@/lib/adminAuth'
import { loadPlanInvoice } from '@/lib/planInvoice'
import { createPlanPayLink, isPayPurpose } from '@/lib/planPayLinks'
import { publicOrigin } from '@/lib/publicOrigin'
import { guardRate, plannerRule } from '@/lib/rateLimit'

export async function POST(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  // Every accepted call mints three to five Stripe objects (a product, a price,
  // the fee product and price, the Payment Link) and updates one more per link
  // it voids. This route had no ceiling at all while its neighbour
  // `/api/plan/[ref]/email-me` has one — 13 real 429s from it in the current
  // nginx window — so the omission was an oversight, not a policy.
  // `plannerRule` rather than `costlyRule` for the reason `/api/portal/pay`
  // gives: this is interactive, and a customer whose mint failed will retry.
  const limited = guardRate(req, plannerRule('plan/pay-link'))
  if (limited) return limited

  const { ref: rawRef } = await params
  const ref = decodeURIComponent(rawRef || '')
  if (!ref) return NextResponse.json({ error: 'Missing plan reference' }, { status: 400 })

  // An admin may also arrive on the shared Bearer password (56 routes still use
  // it); a customer must have the ref-scoped portal cookie.
  const access = planAccess(req.headers.get('cookie'), ref)
  const isAdmin = access.ok ? access.isAdmin : isAdminAuthorized(req)
  if (!access.ok && !isAdmin) {
    return NextResponse.json({ error: 'Not authorized for this plan' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    purpose?: unknown
    amountDollars?: unknown
    tipCents?: unknown
  }
  const purpose = body.purpose
  if (!isPayPurpose(purpose)) {
    return NextResponse.json({ error: 'Unknown payment purpose' }, { status: 400 })
  }

  // `custom` is the only path where a figure comes from a human, so it is the
  // only one that needs an admin. A customer can pay the deposit or the balance;
  // both are computed from their own invoice.
  if (purpose === 'custom' && !isAdmin) {
    return NextResponse.json({ error: 'Not authorized to set an amount' }, { status: 403 })
  }
  let customCents: number | undefined
  if (purpose === 'custom') {
    const n = Number(body.amountDollars)
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: 'Enter an amount' }, { status: 400 })
    }
    customCents = Math.round(n * 100)
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('plan pay-link: STRIPE_SECRET_KEY is not set')
    return NextResponse.json({ error: 'Payments are not configured' }, { status: 503 })
  }

  const supabase = getSupabase()

  const loaded = await loadPlanInvoice(ref, supabase)
  if (!loaded.ok) {
    // Three outcomes. A read failure told as "no such plan" would invite a
    // customer to conclude their invoice has vanished, mid-payment.
    if (!loaded.notFound) {
      console.error('plan pay-link: invoice load failed:', loaded.error)
      return NextResponse.json({ error: 'Could not read this plan — try again.' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  }
  // Without the payment history the amount owed is unknown, and an unknown
  // amount must never become a charge. That read is now inside
  // `loadPlanInvoice`, which fails closed on it — so the 503 above covers it and
  // this route no longer holds a second copy of the same rows.
  const invoice = loaded.invoice

  const origin = publicOrigin(req)

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

  const minted = await createPlanPayLink({
    invoice,
    purpose,
    customCents,
    // Unscreened on purpose — `quoteFor` owns the clamp and the
    // which-purposes-may-tip rule, so there is one place to read and one place
    // to change rather than a screen here and a second screen there.
    tipCents: body.tipCents,
    // `adminActorId` returns `admin:<email>` from the signed cookie, or the
    // historical anonymous 'ADMIN' on the shared password. A customer minting
    // their own link is attributed to their portal session.
    actor: isAdmin ? adminActorId(req) : `portal:${ref}`,
    stripe,
    db: supabase,
    origin,
  })

  if (!minted.ok) {
    return NextResponse.json({ error: minted.reason }, { status: minted.retryable ? 503 : 409 })
  }

  return NextResponse.json({
    ok: true,
    payUrl: minted.payUrl,
    payLinkId: minted.payLinkId,
    amountCents: minted.quote.amountCents,
    tipCents: minted.quote.tipCents,
    feeCents: minted.quote.feeCents,
    chargeCents: minted.quote.chargeCents,
  })
}
