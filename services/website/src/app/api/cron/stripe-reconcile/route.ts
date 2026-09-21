import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { Resend } from 'resend'
import { isCronAuthorized } from '@/lib/cronAuth'
import { getSupabase } from '@/lib/supabase'
import { ownerEmail, notifyOwnerSms } from '@/lib/ownerNotify'
import { escapeHtml } from '@/lib/escapeHtml'
import { money } from '@/lib/planInvoice'
import { EXPECTED_WEBHOOK_EVENTS } from '@/lib/stripeAftermath'
import { compareSubscription, compareTotals, byUtcDay, utcDaysAgo } from '@/lib/stripeReconcile'

export const dynamic = 'force-dynamic'

/**
 * The watchman the Stripe money path never had.
 *
 * ── What it is for ──────────────────────────────────────────────────────────
 *
 * From 2026-03-05 to 2026-09-12 the webhook endpoint was subscribed to ONE of
 * the four events the handler had branches for, and **$3,596.50** of real card
 * payments reached the Financials tab never. It was found by a human reading the
 * code six months later. Nothing was watching — and hard-won rule 17 is that
 * *"never ran" and "could not have run" look identical from outside* unless
 * something counts and says.
 *
 * Two questions, every run. See `lib/stripeReconcile.ts` for why the money check
 * is a one-directional TOTAL rather than a per-payment match.
 *
 * ── Read-only, on purpose ───────────────────────────────────────────────────
 *
 * This route writes nothing — not to Stripe, not to the ledger. A monitor that
 * repairs what it finds cannot be trusted to report honestly about it, and an
 * automatic write on the money path is how a reconciliation becomes a
 * double-count. It measures, and it tells a human.
 *
 * ── Windows ─────────────────────────────────────────────────────────────────
 *
 * `?days=` (default 7, max 90) sets the Stripe window. The LEDGER window is
 * widened by one day at each edge, because a payment that succeeds at 23:59 UTC
 * can carry the next day's date if the webhook is redelivered — so a strict
 * window would report a shortfall every time one landed near midnight. Widening
 * the books side can only ever make a shortfall LOOK smaller, never invent one,
 * which is the safe direction for a check whose alert means "money is missing".
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const daysRaw = Number(req.nextUrl.searchParams.get('days'))
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(Math.floor(daysRaw), 90) : 7
  const now = new Date()
  const sinceEpoch = Math.floor((now.getTime() - days * 86_400_000) / 1000)

  if (!process.env.STRIPE_SECRET_KEY) {
    // Fail loudly rather than reporting a clean reconciliation of nothing. A
    // monitor that answers "all good" when it could not look is worse than no
    // monitor (rule 10).
    console.error('stripe-reconcile: STRIPE_SECRET_KEY is not set — cannot reconcile.')
    return NextResponse.json({ error: 'STRIPE_SECRET_KEY not set' }, { status: 503 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
  const supabase = getSupabase()

  // ── 1. Is the endpoint still subscribed to what we handle? ────────────────
  let drift: ReturnType<typeof compareSubscription> | null = null
  let endpointSummary: Array<{ id: string; url: string; status: string }> = []
  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 })
    const enabled = endpoints.data.filter(e => e.status === 'enabled')
    endpointSummary = enabled.map(e => ({ id: e.id, url: e.url, status: e.status }))
    // The union across enabled endpoints: two endpoints splitting the events
    // between them is a valid configuration, and what matters is that every
    // event we branch on reaches us somewhere.
    const union = Array.from(new Set(enabled.flatMap(e => e.enabled_events)))
    drift = compareSubscription(EXPECTED_WEBHOOK_EVENTS, union)
  } catch (err) {
    console.error('stripe-reconcile: could not read webhook endpoints:', err instanceof Error ? err.message : err)
  }

  // ── 2. Does Stripe's money match the books? ───────────────────────────────
  let stripeItems: Array<{ epochSeconds: number; cents: number }> = []
  try {
    // `autoPagingToArray` rather than a single `limit: 100`: a busy week can
    // exceed one page, and a truncated Stripe side makes the books look
    // healthy — the check would fail silently in the direction that matters.
    const intents = await stripe.paymentIntents
      .list({ created: { gte: sinceEpoch }, limit: 100 })
      .autoPagingToArray({ limit: 5000 })
    stripeItems = intents
      .filter(pi => pi.status === 'succeeded')
      .map(pi => ({ epochSeconds: pi.created, cents: Number(pi.amount) || 0 }))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'payment intent list failed'
    console.error('stripe-reconcile: could not list payment intents:', message)
    return NextResponse.json({ error: message }, { status: 503 })
  }

  const ledgerFrom = utcDaysAgo(days + 1, now)
  const ledgerTo = utcDaysAgo(-1, now)
  const { data: rows, error: ledgerError } = await supabase
    .from('financial_transactions')
    .select('date, amount_cents, category, reference')
    .eq('source', 'stripe')
    .gte('date', ledgerFrom)
    .lte('date', ledgerTo)

  if (ledgerError) {
    console.error('stripe-reconcile: could not read financial_transactions:', ledgerError.message)
    return NextResponse.json({ error: ledgerError.message }, { status: 503 })
  }

  // Refunds and lost chargebacks are NEGATIVE rows (see lib/stripeAftermath.ts).
  // They are excluded here because the Stripe side of this comparison is
  // succeeded PaymentIntents — money IN. Netting them would make a refunded week
  // look like a week with missing payments, which is the false alarm that
  // teaches a human to stop reading the alert.
  const incoming = (rows ?? []).filter(r => Number(r.amount_cents) > 0)
  const booksCents = incoming.reduce((sum, r) => sum + Number(r.amount_cents), 0)
  const stripeCents = stripeItems.reduce((sum, i) => sum + i.cents, 0)
  const verdict = compareTotals(stripeCents, booksCents)

  const report = {
    window: { days, since: utcDaysAgo(days, now), ledgerFrom, ledgerTo },
    subscription: drift,
    endpoints: endpointSummary,
    money: {
      ...verdict,
      stripePayments: stripeItems.length,
      ledgerRows: incoming.length,
      byDayStripe: byUtcDay(stripeItems),
    },
  }

  const subscriptionBroken = !!drift && !drift.ok
  const moneyMissing = !verdict.ok

  if (subscriptionBroken) {
    console.error(
      `STRIPE SUBSCRIPTION DRIFT: the handler has branches for [${drift!.missing.join(', ')}] ` +
        'and no enabled endpoint is subscribed to them. Payments of that kind are arriving nowhere.',
    )
  }
  if (moneyMissing) {
    console.error(
      `STRIPE BOOKS SHORT by ${money(verdict.shortfallCents)} over ${days} days: ` +
        `Stripe ${money(stripeCents)} across ${stripeItems.length} payments, ` +
        `books ${money(booksCents)} across ${incoming.length} rows.`,
    )
  }
  if (!subscriptionBroken && !moneyMissing) {
    console.log(
      `stripe-reconcile OK: ${days}d — Stripe ${money(stripeCents)} (${stripeItems.length}), ` +
        `books ${money(booksCents)} (${incoming.length})` +
        `${verdict.shortfallCents < 0 ? `, books ahead by ${money(-verdict.shortfallCents)}` : ''}` +
        `${drift?.extra.length ? `; extra subscribed events: ${drift.extra.join(', ')}` : ''}`,
    )
  }

  if (subscriptionBroken || moneyMissing) {
    await alert(report, verdict.shortfallCents, drift?.missing ?? [], days)
  }

  // 200 even when something is wrong: this is a monitor, and a non-200 would
  // make cron-job.org's own failure count the thing that is wrong rather than
  // the finding. The `ok` field is the answer.
  return NextResponse.json({ ok: !subscriptionBroken && !moneyMissing, ...report })
}

async function alert(
  report: unknown,
  shortfallCents: number,
  missingEvents: string[],
  days: number,
): Promise<void> {
  const parts: string[] = []
  if (missingEvents.length > 0) {
    parts.push(
      `<p style="font-family:sans-serif;font-size:15px"><strong>The Stripe webhook is not subscribed to events the site handles.</strong><br>` +
        `Missing: <code>${escapeHtml(missingEvents.join(', '))}</code><br><br>` +
        `Payments or refunds of those kinds are arriving and being recorded nowhere. ` +
        `Fix in the Stripe dashboard under Developers → Webhooks, by <em>updating</em> the existing endpoint — ` +
        `creating a new one rotates the signing secret and every delivery will fail until the server is updated.</p>`,
    )
  }
  if (shortfallCents > 0) {
    parts.push(
      `<p style="font-family:sans-serif;font-size:15px"><strong>The books are short by ${money(shortfallCents)}</strong> over the last ${days} days.<br><br>` +
        `Stripe says more money succeeded than the Financials tab recorded. That is the same shape as the ` +
        `$3,596.50 of planner payments that were missing for six months.</p>`,
    )
  }
  const html =
    parts.join('') +
    `<pre style="font-family:monospace;font-size:12px;background:#f6f6f6;padding:12px;overflow:auto">` +
    `${escapeHtml(JSON.stringify(report, null, 2))}</pre>`

  const subject =
    missingEvents.length > 0
      ? `⚠️ Stripe webhook is missing ${missingEvents.length} event type(s)`
      : `⚠️ Stripe books short by ${money(shortfallCents)}`

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
    try {
      await resend.emails.send({ from, to: ownerEmail(), subject, html })
    } catch (err) {
      console.error('stripe-reconcile alert email failed (non-fatal):', err instanceof Error ? err.message : err)
    }
  } else {
    console.warn('RESEND_API_KEY not set — stripe-reconcile alert not emailed:', subject)
  }

  // Money missing is worth a text. Subscription drift alone is not — it is a
  // configuration problem that is still true in an hour, and this job runs daily.
  if (shortfallCents > 0) {
    await notifyOwnerSms(
      `Host Hampton: Stripe books short ${money(shortfallCents)} over ${days}d. ` +
        'Payments succeeded at Stripe that are not in the Financials tab.',
    )
  }
}
