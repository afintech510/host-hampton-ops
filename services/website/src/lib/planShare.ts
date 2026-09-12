/**
 * Sending a customer their own plan (Phase 5 item 4).
 *
 * Two callers, deliberately kept as two routes rather than one with a flag:
 *
 *   * `POST /api/plan/[ref]/email-me` — the CUSTOMER asks for it, from their own
 *     invoice page. Authorized by the portal cookie for that ref.
 *   * `POST /api/admin/plan/[ref]/send` — an ADMIN sends it to the client.
 *     Authorized by `isAdminAuthorized`, requires an explicit `confirm`, and is
 *     attributed to a named person by `adminActorId`.
 *
 * Different authority, different intent, different audit trail. One route with a
 * `mode` parameter would have made the customer path one missing check away from
 * being the admin path.
 *
 * ── "Nothing auto-sends to a customer, ever" ────────────────────────────────
 *
 * Neither of these is reachable without a credential and a human action: no
 * cron, no LLM, no webhook calls them. They also do not touch `inquiry_drafts`,
 * so `approved` and `sent` remain the gated edges in lib/marketing/graph.ts that
 * only `actor.isAdmin` can cross. This is a link to a document the customer is
 * already entitled to see — not a drafted message, and not a route around review.
 *
 * ── The address is never taken from the request ─────────────────────────────
 *
 * Both routes send ONLY to the address stored on the booking. An
 * attacker-supplied `to` would turn "email me my invoice" into a way to have
 * someone else's invoice delivered to an inbox of their choosing, and the portal
 * cookie would make it look authorized. The address is a property of the plan.
 */

import { Resend } from 'resend'
import { getSupabase } from '@/lib/supabase'
import { generatePortalToken, buildPortalUrl } from '@/lib/portalAuth'
import { money, type PlanInvoice } from '@/lib/planInvoice'

type Supa = ReturnType<typeof getSupabase>

export type PlanLinkResult =
  | { ok: true; url: string }
  | { ok: false; reason: string; retryable: boolean }

/**
 * A fresh magic link that lands on this plan's summary page.
 *
 * A new token every time, which is the existing convention for every planner
 * link the app mails (see `portalAuth.TOKEN_EXPIRY_HOURS`'s comment): it means an
 * old email is a floor on access, not a permanent key.
 */
export async function buildPlanSummaryLink(
  bookingId: string,
  bookingRef: string,
  db?: Supa,
): Promise<PlanLinkResult> {
  const supabase = db ?? getSupabase()
  const secret = process.env.PORTAL_LINK_SIGNING_SECRET
  if (!secret) {
    console.error('buildPlanSummaryLink: PORTAL_LINK_SIGNING_SECRET is not set')
    return { ok: false, reason: 'Portal links are not configured', retryable: false }
  }

  const { token, hash, expiresAt } = generatePortalToken(bookingRef, secret)
  const { error } = await supabase.from('portal_tokens').insert({
    booking_id: bookingId,
    token_hash: hash,
    expires_at: expiresAt.toISOString(),
  })
  if (error) {
    // An unstored token is a link that will not work. Better to say so than to
    // mail a dead link.
    console.error('buildPlanSummaryLink: token insert failed:', error.message)
    return { ok: false, reason: 'Could not create a secure link — try again.', retryable: true }
  }

  return { ok: true, url: buildPortalUrl(bookingRef, token, `/plan/${bookingRef}/summary`) }
}

const BRAND = {
  headerBg: 'linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%)',
  footerBg: '#BCCDEB',
  bodyBg: '#F6F1EB',
  navy: '#1a2744',
  gray: '#555',
} as const

/**
 * The email body. Deliberately a LINK and not the invoice inline: the summary
 * page carries the template's `@media print` rules, so "Save as PDF" in the
 * browser produces the same document — which is option (a) from plan §17, and
 * why no puppeteer is in this repo.
 */
export function planSummaryEmailHtml(opts: {
  invoice: PlanInvoice
  url: string
  /** An admin's covering note, or null for the customer's own "email me this". */
  note: string | null
}): string {
  const { invoice } = opts
  const first = (invoice.booking.contact_name || 'there').split(' ')[0]
  const doc = invoice.docTitle

  const detail = (label: string, value: string) =>
    `<tr><td style="padding:9px 12px;font-weight:bold;color:${BRAND.navy};width:150px;">${label}</td><td style="padding:9px 12px;color:${BRAND.gray};">${value}</td></tr>`

  const detailRows = [
    invoice.invoiceNumber ? detail('Invoice #', invoice.invoiceNumber) : '',
    invoice.eventDateTime ? detail('Date', invoice.eventDateTime) : '',
    invoice.totalCents > 0 ? detail('Total', money(invoice.totalCents)) : '',
    invoice.totalCents > 0 ? detail('Balance Due', money(invoice.balanceDueCents)) : '',
    invoice.depositCents > 0 ? detail(invoice.depositIsSeparate ? 'Security deposit' : 'Deposit', money(invoice.depositCents)) : '',
    detail('Reference', invoice.booking.booking_ref),
  ]
    .filter(Boolean)
    .join('')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton &middot; Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:26px;margin:0;font-weight:normal;">${doc}</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${first},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 22px;">${
      opts.note
        ? opts.note
        : `Here&rsquo;s your ${doc.toLowerCase()}. The link below opens the full document &mdash; you can review everything, pay online, or use your browser&rsquo;s &ldquo;Save as PDF&rdquo; to keep a copy.`
    }</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:26px;background:#f9f7f4;border-radius:10px;">
      ${detailRows}
    </table>
    <div style="text-align:center;margin-bottom:26px;">
      <a href="${opts.url}" style="display:inline-block;background:${BRAND.navy};color:${BRAND.bodyBg};padding:16px 46px;border-radius:50px;text-decoration:none;font-size:15px;font-weight:bold;letter-spacing:0.5px;">View your ${doc.toLowerCase().includes('invoice') ? 'invoice' : 'quote'}</a>
    </div>
    <p style="font-size:13px;color:${BRAND.gray};line-height:1.7;margin:0;">This link is private to you &mdash; please don&rsquo;t forward it. Questions? Call or text <strong>(631) 998-9325</strong>.</p>
  </div>
  <div style="background:${BRAND.footerBg};padding:20px 40px;text-align:center;">
    <p style="color:${BRAND.navy};font-size:12px;margin:0 0 4px;">295 Montauk Highway, Suite 7 &middot; Speonk, NY 11972</p>
    <p style="color:${BRAND.navy};opacity:0.5;font-size:11px;margin:0;">Thank you for choosing Host Hampton!</p>
  </div>
</div>
</body></html>`
}

export function planSummarySms(invoice: PlanInvoice, url: string): string {
  const first = (invoice.booking.contact_name || 'there').split(' ')[0]
  const doc = invoice.docTitle.toLowerCase()
  return `Hi ${first}! Here's your Host Hampton ${doc}${
    invoice.totalCents > 0 ? ` (${money(invoice.totalCents)})` : ''
  }: ${url}`
}

export type SendResult = { ok: true } | { ok: false; reason: string }

/** Send the plan email. Returns the failure rather than throwing, so the route can say why. */
export async function sendPlanSummaryEmail(opts: {
  to: string
  invoice: PlanInvoice
  url: string
  note: string | null
  subjectPrefix?: string
}): Promise<SendResult> {
  if (!process.env.RESEND_API_KEY) {
    console.error('sendPlanSummaryEmail: RESEND_API_KEY is not set')
    return { ok: false, reason: 'Email is not configured' }
  }
  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
  const { error } = await resend.emails.send({
    from,
    to: opts.to,
    subject: `${opts.subjectPrefix ?? ''}${opts.invoice.docTitle} — ${opts.invoice.booking.booking_ref} | Host Hampton`,
    html: planSummaryEmailHtml({ invoice: opts.invoice, url: opts.url, note: opts.note }),
  })
  if (error) {
    console.error('sendPlanSummaryEmail error:', error.message)
    return { ok: false, reason: `Email failed: ${error.message}` }
  }
  return { ok: true }
}
