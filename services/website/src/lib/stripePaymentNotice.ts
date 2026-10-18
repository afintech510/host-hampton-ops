/**
 * One owner email per Stripe payment, with everything about it in one place.
 *
 * Asked for by Adam on 2026-10-18, after Courtney Breitenbach paid her
 * $1,538.82 final invoice from the portal: the webhook recorded it, settled the
 * booking and emailed HER a receipt — and told nobody at Host Hampton, because
 * the party-planner branch only emails the owner on a DEPOSIT. Several branches
 * had an owner email and several did not; rather than add the missing ones one
 * at a time (and miss the next branch somebody writes), the webhook now sends
 * this after any delivery that put new Stripe money in the books. See
 * `lib/ledgerCapture.ts` for why that signal fires exactly once per payment.
 *
 * Best effort by design: the money is already recorded when this runs, so a
 * failure here is logged and swallowed — it must never turn a recorded payment
 * into a 500 that makes Stripe redeliver.
 *
 * Owner-only. No customer address is ever a recipient; it goes to `ownerEmail()`.
 */

import type Stripe from 'stripe'
import { Resend } from 'resend'
import type { getSupabase } from './supabase'
import { ownerEmail } from './ownerNotify'
import { escapeHtml } from './escapeHtml'
import { mailHrefExternal } from './emailSafety'
import { money } from './planInvoice'
import type { CapturedLedgerWrite } from './ledgerCapture'

type Supa = ReturnType<typeof getSupabase>

/** What the app's own `metadata.type` means, in words. */
const SOURCE_LABELS: Record<string, string> = {
  party_builder: 'Party planner / customer portal — card payment on our site',
  studio_rental: 'Studio rental — card deposit on our site',
  plan_pay_link: 'Invoice pay link (Stripe Checkout)',
  pay_link: 'Admin-made pay link (Stripe Checkout)',
  event_ticket: 'Event ticket purchase',
  event_ticket_multi: 'Event ticket purchase (multiple sessions)',
  cart_checkout: 'Event tickets — cart checkout',
  gift_card: 'Gift card purchase',
  market_vendor: 'Market vendor booth',
  vendor_registration: 'Vendor registration',
  appointment_booking: 'Appointment booking',
}

export type BookingSnapshot = {
  booking_ref: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  party_date: string | null
  party_time: string | null
  package_type: string | null
  party_type: string | null
  status: string | null
  total_cents: number | null
  balance_due_cents: number | null
}

export type PaymentNoticeInput = {
  eventType: string
  eventId: string
  livemode: boolean
  /** Unix seconds, from the Stripe event. */
  created: number
  writes: CapturedLedgerWrite[]
  paymentIntentId: string | null
  sessionId: string | null
  paymentLinkId: string | null
  /** What Stripe charged the customer, in cents. */
  grossCents: number | null
  customerName: string | null
  customerEmail: string | null
  customerPhone: string | null
  /** e.g. "Visa •••• 4242 (Apple Pay)" or "klarna". */
  method: string | null
  stripeFeeCents: number | null
  netCents: number | null
  receiptUrl: string | null
  metadata: Record<string, string>
  booking: BookingSnapshot | null
}

/** The booking reference this payment names, under any of the keys our code writes. */
export function bookingRefFromMetadata(m: Record<string, string>): string | null {
  const v = m.booking_ref || m.bookingRef || m.ref || ''
  return /^HH-[A-Z0-9-]{3,30}$/.test(v) ? v : null
}

export function sourceLabel(input: Pick<PaymentNoticeInput, 'metadata' | 'paymentLinkId'>): string {
  const type = input.metadata.type
  if (type && SOURCE_LABELS[type]) return SOURCE_LABELS[type]
  if (type) return `Stripe (${type})`
  if (input.paymentLinkId) return 'Stripe Payment Link (made in the Stripe dashboard)'
  return 'Stripe (no Host Hampton metadata)'
}

function etDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }) + ' ET'
}

function partyDate(d: string | null): string | null {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  // Noon UTC keeps the calendar day in Eastern time.
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

function row(label: string, valueHtml: string): string {
  return (
    `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td>` +
    `<td style="padding:4px 0;vertical-align:top">${valueHtml}</td></tr>`
  )
}

function textRow(label: string, value: string | null | undefined): string {
  return value ? row(label, escapeHtml(value)) : ''
}

function linkRow(label: string, url: string | null, text: string): string {
  if (!mailHrefExternal(url)) return ''
  return row(label, `<a href="${mailHrefExternal(url)}">${escapeHtml(text)}</a>`)
}

function moneyRow(label: string, cents: number | null | undefined): string {
  return typeof cents === 'number' && Number.isFinite(cents) ? row(label, escapeHtml(money(cents))) : ''
}

/** The amount credited against the booking — read in the same key order as the webhook's planner branch. */
function creditedCents(m: Record<string, string>): number | null {
  const deposit = parseInt(m.depositCents || '0', 10)
  const amount = parseInt(m.amountCents || '0', 10)
  const n = m.payment_type === 'deposit' ? deposit || amount : amount || deposit
  return n > 0 ? n : null
}

/** Metadata keys that are internal plumbing or already shown above. */
const METADATA_SKIP = new Set(['lineItems', 'line_items', 'quote_snapshot'])

export function buildPaymentNotice(input: PaymentNoticeInput): { subject: string; html: string } {
  const recorded = input.writes.reduce((s, w) => s + w.amountCents, 0)
  const gross = input.grossCents ?? recorded
  const reason = input.writes.map(w => w.description).join(' + ') || 'Stripe payment'
  const who = input.booking?.contact_name?.trim() || input.customerName || input.writes[0]?.customerName || null
  const unmatched = input.writes.some(w => /unmatched|unclaimed/i.test(`${w.category} ${w.description}`))

  const subject =
    `${unmatched ? 'UNMATCHED ' : ''}Stripe payment ${money(gross)} — ${reason}${who ? ` — ${who.trim()}` : ''}` +
    `${input.livemode ? '' : ' [TEST MODE]'}`

  const m = input.metadata
  const dashboard = input.paymentIntentId
    ? `https://dashboard.stripe.com/${input.livemode ? '' : 'test/'}payments/${encodeURIComponent(input.paymentIntentId)}`
    : input.sessionId
      ? `https://dashboard.stripe.com/${input.livemode ? '' : 'test/'}checkout/sessions/${encodeURIComponent(input.sessionId)}`
      : null

  const payment = [
    row('Amount charged', `<strong>${escapeHtml(money(gross))}</strong>`),
    textRow('Reason', reason),
    textRow('Source', sourceLabel(input)),
    textRow('Payment type', m.payment_type || m.purpose || null),
    moneyRow('Credited to booking', creditedCents(m)),
    moneyRow('Card fee charged', m.cardFeeCents ? Number(m.cardFeeCents) : null),
    moneyRow('Tip', m.tipCents && Number(m.tipCents) > 0 ? Number(m.tipCents) : null),
    moneyRow('Stripe fee', input.stripeFeeCents),
    moneyRow('Net to Host Hampton', input.netCents),
    textRow('Paid with', input.method),
    textRow('When', etDateTime(input.created)),
  ].join('')

  const customer = [
    textRow('Name', who),
    textRow('Email', input.booking?.contact_email || input.customerEmail),
    textRow('Phone', input.booking?.contact_phone || input.customerPhone),
  ].join('')

  const b = input.booking
  const booking = b
    ? [
        textRow('Booking', b.booking_ref),
        textRow('Party', [b.package_type, b.party_type].filter(Boolean).join(' · ') || null),
        textRow('Date', [partyDate(b.party_date), b.party_time].filter(Boolean).join(' at ') || null),
        moneyRow('Booking total', b.total_cents),
        moneyRow('Balance still due', b.balance_due_cents),
        textRow('Status now', b.status),
      ].join('')
    : ''

  const books = input.writes
    .map(w =>
      row(
        w.category,
        `${escapeHtml(money(w.amountCents))} — ${escapeHtml(w.description)}<br><code style="font-size:12px">${escapeHtml(w.reference)}</code>`,
      ),
    )
    .join('')

  const extraMeta = Object.entries(m)
    .filter(([k, v]) => !METADATA_SKIP.has(k) && v)
    .map(([k, v]) => textRow(k, v.length > 200 ? `${v.slice(0, 200)}…` : v))
    .join('')

  const stripeIds = [
    textRow('Event', `${input.eventType} (${input.eventId})`),
    textRow('Payment intent', input.paymentIntentId),
    textRow('Checkout session', input.sessionId),
    textRow('Payment link', input.paymentLinkId),
    linkRow('Dashboard', dashboard, 'Open in Stripe'),
    linkRow('Receipt', input.receiptUrl, 'Stripe receipt'),
  ].join('')

  const section = (title: string, rows: string) =>
    rows
      ? `<h3 style="margin:20px 0 6px;font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#7a3e9d">${escapeHtml(title)}</h3>` +
        `<table style="border-collapse:collapse;font-size:14px">${rows}</table>`
      : ''

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#222;max-width:640px">` +
    `<p style="font-size:16px;margin:0 0 4px"><strong>${escapeHtml(money(gross))}</strong> received through Stripe.</p>` +
    `<p style="margin:0;color:#555">${escapeHtml(reason)}</p>` +
    (unmatched
      ? `<p style="color:#b00020"><strong>No booking or order matched this payment.</strong> It is in the Financials tab as unmatched and needs attributing.</p>`
      : '') +
    section('Payment', payment) +
    section('Customer', customer) +
    section('Booking', booking) +
    section('Recorded in Financials', books) +
    section('Stripe', stripeIds) +
    section('Metadata', extraMeta) +
    `</div>`

  return { subject, html }
}

function describeMethod(charge: Stripe.Charge | null): string | null {
  const d = charge?.payment_method_details
  if (!d) return null
  if (d.type === 'card' && d.card) {
    const brand = d.card.brand ? d.card.brand.charAt(0).toUpperCase() + d.card.brand.slice(1) : 'Card'
    const wallet = d.card.wallet?.type ? ` (${d.card.wallet.type.replace(/_/g, ' ')})` : ''
    return `${brand} •••• ${d.card.last4 ?? '????'}${wallet}`
  }
  return d.type.replace(/_/g, ' ')
}

/** Gather the details from the event, Stripe and the booking, then send. Never throws. */
export async function sendStripePaymentNotice(args: {
  event: Stripe.Event
  writes: CapturedLedgerWrite[]
  stripe: Stripe
  supabase: Supa
}): Promise<boolean> {
  const writes = args.writes.filter(w => w.amountCents > 0)
  if (writes.length === 0) return false
  try {
    const obj = args.event.data.object as unknown as Record<string, unknown>
    const isPi = obj.object === 'payment_intent'
    const isSession = obj.object === 'checkout.session'
    const pi = isPi ? (obj as unknown as Stripe.PaymentIntent) : null
    const session = isSession ? (obj as unknown as Stripe.Checkout.Session) : null

    const piId =
      pi?.id ??
      (typeof session?.payment_intent === 'string' ? session.payment_intent : session?.payment_intent?.id ?? null)

    let fullPi: Stripe.PaymentIntent | null = null
    if (piId) {
      try {
        fullPi = await args.stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge.balance_transaction'] })
      } catch (err) {
        console.warn('payment notice: could not read the payment intent (continuing):', err instanceof Error ? err.message : err)
      }
    }
    const charge = fullPi && typeof fullPi.latest_charge === 'object' ? (fullPi.latest_charge as Stripe.Charge | null) : null
    const bt = charge && typeof charge.balance_transaction === 'object' ? (charge.balance_transaction as Stripe.BalanceTransaction | null) : null

    const metadata: Record<string, string> = { ...(fullPi?.metadata || {}), ...(pi?.metadata || {}), ...(session?.metadata || {}) }

    const ref = bookingRefFromMetadata(metadata)
    let booking: BookingSnapshot | null = null
    if (ref) {
      const { data, error } = await args.supabase
        .from('bookings')
        .select('booking_ref, contact_name, contact_email, contact_phone, party_date, party_time, package_type, party_type, status, total_cents, balance_due_cents')
        .eq('booking_ref', ref)
        .maybeSingle()
      if (error) console.warn('payment notice: booking read failed (continuing):', error.message)
      booking = (data as BookingSnapshot | null) ?? null
    }

    const paymentLink = session?.payment_link
    const { subject, html } = buildPaymentNotice({
      eventType: args.event.type,
      eventId: args.event.id,
      livemode: !!args.event.livemode,
      created: args.event.created,
      writes,
      paymentIntentId: piId,
      sessionId: session?.id ?? null,
      paymentLinkId: typeof paymentLink === 'string' ? paymentLink : paymentLink?.id ?? null,
      grossCents: pi?.amount_received ?? pi?.amount ?? session?.amount_total ?? charge?.amount ?? null,
      customerName: session?.customer_details?.name ?? charge?.billing_details?.name ?? null,
      customerEmail: session?.customer_details?.email ?? charge?.billing_details?.email ?? pi?.receipt_email ?? null,
      customerPhone: session?.customer_details?.phone ?? charge?.billing_details?.phone ?? null,
      method: describeMethod(charge),
      stripeFeeCents: bt ? bt.fee : null,
      netCents: bt ? bt.net : null,
      receiptUrl: charge?.receipt_url ?? null,
      metadata,
      booking,
    })

    if (!process.env.RESEND_API_KEY) {
      console.warn('RESEND_API_KEY not set — payment notice not sent:', subject)
      return false
    }
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
    const res = await resend.emails.send({ from, to: ownerEmail(), subject, html })
    const failed = (res as { error?: { message?: string } | null } | undefined)?.error
    if (failed) {
      console.error('payment notice: Resend refused (non-fatal):', failed.message ?? failed)
      return false
    }
    return true
  } catch (err) {
    console.error('payment notice failed (non-fatal):', err instanceof Error ? err.message : err)
    return false
  }
}
