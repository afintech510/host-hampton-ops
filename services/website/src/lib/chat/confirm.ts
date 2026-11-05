/**
 * What happens when a visitor taps "Book it & see my invoice".
 *
 * This is the ONLY place the chat creates a booking, and it does not create one
 * itself: it REPLAYS the party planner's own save route (`/api/party-builder/save`)
 * in-process, so every guard that route carries applies unchanged —
 * `screenPublicLineItems` / `screenPublicGuestCount`, the "never fold into a plan
 * money has landed on" check, `status: 'awaiting_deposit'`, the owner's
 * notification email, the contact + sequence side effects. A second implementation
 * of "make a plan from line items" would be a second set of guards nothing checks.
 *
 * ORDER (each step is a reason to stop before the next):
 *
 *   1. the card verifies  — signed, unexpired, THIS session, not already used
 *   2. this session has not already booked
 *   3. the price list still says what the card says (`price_changed` otherwise)
 *   4. the date is STILL open (checked again, right now)
 *   5. the card is claimed — in memory, then durably in `chat_sessions`
 *   6. replay the planner's save route
 *   7. mint the invoice link (`mintPortalLink`) and link the transcript
 *   8. email that link to the address the visitor typed, so a mistyped address
 *      surfaces as "I didn't get it" and not as a booking nobody can open
 *
 * A refusal at 6 releases both claims, so the visitor can tap again. Nothing
 * here touches Stripe: the deposit is paid on `/plan/<ref>/summary`, by the
 * existing PayPanel, never in the chat.
 */

import { NextRequest } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { POST as savePlan } from '@/app/api/party-builder/save/route'
import { mintPortalLink } from '@/lib/portalLinkMint'
import { loadQuoteCatalog, quoteFromCatalog } from '@/lib/quoteRequest'
import { loadPlanInvoice } from '@/lib/planInvoice'
import { sendPlanSummaryEmail } from '@/lib/planShare'
import { verifyCard, markCardUsed, releaseCardUsed, type BookingCard } from '@/lib/chat/card'
import { claimCard, releaseCard, markBooked, saveTurn, persistable, type ChatSession } from '@/lib/chat/session'
import { dateIsOpen, usd } from '@/lib/chat/tools'
import type { QuoteLineItem } from '@/lib/quoteEngine'

type Supa = ReturnType<typeof getSupabase>

export type ConfirmFailure =
  | 'malformed' | 'bad_signature' | 'expired' | 'wrong_session' | 'already_used'
  | 'already_booked' | 'price_changed' | 'date_taken' | 'calendar_unavailable'
  | 'prices_unavailable' | 'unavailable' | 'save_refused'

export type ConfirmResult =
  | {
      ok: true
      bookingRef: string
      /** Null only if the link could not be issued — the booking still stands. */
      invoiceUrl: string | null
      emailedTo: string
      emailSent: boolean
      total: string
      deposit: string
      /** The planner route's Set-Cookie, so this browser opens its own invoice without a sign-in. */
      setCookie: string | null
    }
  | { ok: false; reason: ConfirmFailure; message: string; status: number }

const refuse = (reason: ConfirmFailure, message: string, status: number): ConfirmResult => ({ ok: false, reason, message, status })

const CARD_REASONS: Record<'malformed' | 'bad_signature' | 'expired' | 'wrong_session' | 'already_used', [string, number]> = {
  malformed: ['That booking card is not valid. Ask me to set it up again.', 400],
  bad_signature: ['That booking card is not valid. Ask me to set it up again.', 400],
  expired: ['That booking card has expired. Ask me to set it up again and I will re-check the date and price.', 410],
  wrong_session: ['That booking card belongs to a different chat.', 403],
  already_used: ['That booking card was already used.', 409],
}

/** The fields of a line item that decide what is charged — what the re-quote compares. */
const money = (l: QuoteLineItem) => [l.name, l.quantity, l.unit_price_cents, l.price_type, l.guest_multiplied, l.pricing_item_id ?? null].join('|')

/** Does today's price list still produce exactly the line items the card promised? */
async function repriceMatches(supabase: Supa, card: BookingCard): Promise<'same' | 'changed' | 'unavailable'> {
  const loaded = await loadQuoteCatalog(supabase)
  if (loaded.kind !== 'ok') return 'unavailable'
  const ans = quoteFromCatalog(loaded.data, {
    partyType: 'studio',
    guests: card.selection.guests,
    theme: card.selection.theme,
    activities: card.selection.activities,
    mini: card.selection.mini,
    addOns: card.selection.addOns,
  })
  if (!ans.ok || ans.unmatched.length || ans.ambiguous.length) return 'changed'
  if (ans.quote.totalCents !== card.totalCents) return 'changed'
  const now = ans.quote.lineItems.map(money)
  const then = card.lineItems.map(money)
  return now.length === then.length && now.every((m, i) => m === then[i]) ? 'same' : 'changed'
}

/** The planner's own saved-selection blob for this card, so /party-builder can reopen the plan filled in. */
async function plannerQuoteData(supabase: Supa, card: BookingCard): Promise<Record<string, unknown> | undefined> {
  const loaded = await loadQuoteCatalog(supabase)
  if (loaded.kind !== 'ok') return undefined
  const ans = quoteFromCatalog(loaded.data, {
    partyType: 'studio', guests: card.selection.guests, theme: card.selection.theme,
    activities: card.selection.activities, mini: card.selection.mini, addOns: card.selection.addOns,
  })
  if (!ans.ok) return undefined
  try {
    const q = new URL(ans.plannerUrl).searchParams.get('q')
    if (!q) return undefined
    const data = JSON.parse(Buffer.from(q.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as Record<string, unknown>
    return {
      ...data,
      contactName: card.contact.name, contactEmail: card.contact.email, contactPhone: card.contact.phone,
      childName: card.childName ?? '', childAge: card.childAge == null ? '' : String(card.childAge),
    }
  } catch {
    return undefined
  }
}

function forwardHeaders(original: Request): Headers {
  const headers = new Headers({ 'content-type': 'application/json' })
  // Deliberately NOT `cookie`: a chat visitor's old portal cookie must not decide
  // which plan this save edits. A new chat booking is a new plan (or the unpaid
  // plan the planner itself would match by email and date).
  for (const h of ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip', 'user-agent', 'host']) {
    const v = original.headers.get(h)
    if (v) headers.set(h, v)
  }
  return headers
}

export async function confirmBooking(opts: {
  supabase: Supa
  req: Request
  session: ChatSession
  cardToken: unknown
  now?: number
}): Promise<ConfirmResult> {
  const { supabase, session } = opts

  // 1. the card
  const v = verifyCard(opts.cardToken, session.id, { now: opts.now })
  if (!v.ok) {
    const [message, status] = CARD_REASONS[v.reason]
    return refuse(v.reason, message, status)
  }
  const card = v.card

  // 2. one booking per chat
  if (session.bookingRef) {
    return refuse('already_booked', 'This chat already has a booking. Open it from your invoice email, or text us to change it.', 409)
  }

  // 3. the price list still agrees with the card
  const repriced = await repriceMatches(supabase, card)
  if (repriced === 'unavailable') return refuse('prices_unavailable', 'I could not re-check the price just now. Please try again in a minute.', 503)
  if (repriced === 'changed') {
    return refuse('price_changed', 'Our prices changed since that card was made, so I have not booked anything. Ask me to set it up again with the current price.', 409)
  }

  // 4. the date, AGAIN
  const open = await dateIsOpen(card.date, { req: opts.req })
  if (open === 'blocked') return refuse('date_taken', 'That date was just taken, so I have not booked anything. Ask me for another date.', 409)
  if (open === 'unknown') return refuse('calendar_unavailable', 'I could not re-check the calendar just now, so I have not booked anything. Please try again in a minute.', 503)

  // 5. claim the card — memory first (a double-click), then durably
  if (!markCardUsed(card, opts.now)) return refuse('already_used', CARD_REASONS.already_used[0], 409)
  const claim = await claimCard(supabase, session.id, card.id)
  if (claim !== 'claimed') {
    releaseCardUsed(card.id)
    return claim === 'taken'
      ? refuse('already_used', CARD_REASONS.already_used[0], 409)
      : refuse('unavailable', 'Something went wrong on our side. Please try again in a minute, or text us.', 503)
  }
  const release = async () => {
    releaseCardUsed(card.id)
    await releaseCard(supabase, session.id, card.id)
  }

  // 6. the planner's own save
  let saved: { ok?: boolean; bookingRef?: string; bookingId?: string; error?: string } = {}
  let setCookie: string | null = null
  let status = 500
  try {
    const quoteData = await plannerQuoteData(supabase, card)
    const res = await savePlan(
      new NextRequest(new URL('/api/party-builder/save', CANONICAL_ORIGIN), {
        method: 'POST',
        headers: forwardHeaders(opts.req),
        body: JSON.stringify({
          lineItems: card.lineItems,
          contactName: card.contact.name,
          contactEmail: card.contact.email,
          contactPhone: card.contact.phone,
          childName: card.childName ?? undefined,
          childAge: card.childAge ?? undefined,
          guestCount: card.guestsPriced,
          partyDate: card.date,
          partyTime: card.time ?? undefined,
          packageType: card.selection.theme,
          isMiniParty: card.selection.mini,
          locationType: 'host_hampton',
          notes: `Booked through the website chat assistant (chat ${session.id.slice(0, 8)}). The date was open when the visitor tapped Book; it is held only once the deposit is paid.`,
          marketingConsent: false,
          quoteData,
          // The first touch for this plan: it came from the chat. `utm_source` is what
          // lib/attribution.ts reads as the channel (source_page for a form fill).
          attribution: { utm_source: 'website-chat', utm_medium: 'chat', utm_campaign: 'host-assistant', landing_path: '/' },
        }),
      }),
    )
    status = res.status
    setCookie = res.headers.get('set-cookie')
    saved = (await res.json().catch(() => ({}))) as typeof saved
  } catch (err) {
    console.error('chat/confirm: the planner save threw:', err instanceof Error ? err.message : err)
  }
  if (status !== 200 || !saved.ok || !saved.bookingRef || !saved.bookingId) {
    await release()
    console.error(`chat/confirm: planner save refused (HTTP ${status}): ${saved.error ?? 'no detail'}`)
    // A 4xx is the planner explaining a refusal to a customer; a 5xx is ours.
    const customerSafe = status >= 400 && status < 500 && saved.error ? saved.error : null
    return refuse('save_refused', customerSafe ?? 'I could not save your plan just now. Nothing was booked — please try again, or text us.', status >= 400 && status < 500 ? 409 : 503)
  }

  // 7. the invoice link, and the transcript link
  const bookingRef = saved.bookingRef
  const minted = await mintPortalLink(supabase, saved.bookingId, bookingRef, `/plan/${encodeURIComponent(bookingRef)}/summary`)
  const invoiceUrl = minted.ok ? minted.url : null
  await markBooked(supabase, session.id, { bookingRef, bookingId: saved.bookingId, name: card.contact.name, email: card.contact.email })

  // 8. the same link, by email, to the address they typed
  let emailSent = false
  if (invoiceUrl) {
    try {
      const loaded = await loadPlanInvoice(bookingRef, supabase)
      if (loaded.ok) {
        const sent = await sendPlanSummaryEmail({ to: card.contact.email, invoice: loaded.invoice, url: invoiceUrl, note: null })
        emailSent = sent.ok
      } else {
        console.error(`chat/confirm: could not load the invoice for ${bookingRef} to email it`)
      }
    } catch (err) {
      console.error('chat/confirm: invoice email threw:', err instanceof Error ? err.message : err)
    }
  } else {
    console.error(`chat/confirm: ${bookingRef} booked but the invoice link could not be issued`)
  }

  // The transcript: a server-authored pair, best effort (a lost compare-and-swap just means the
  // pair is absent; `booking_ref` on the session row is the durable record).
  const notice = `<system_notice>The visitor tapped Book on the card. Plan ${bookingRef} was created, awaiting its deposit. The invoice link was shown to them${emailSent ? ' and emailed' : ''}.</system_notice>`
  await saveTurn(supabase, session, {
    messages: persistable([
      ...session.messages,
      { role: 'user', content: notice },
      { role: 'assistant', content: [{ type: 'text', text: `Your plan ${bookingRef} is saved. The date is held once the deposit is paid on the invoice page.` }] },
    ]),
    spentUsd: 0,
  })

  return {
    ok: true,
    bookingRef,
    invoiceUrl,
    emailedTo: card.contact.email,
    emailSent,
    total: usd(card.totalCents),
    deposit: usd(card.depositCents),
    setCookie,
  }
}
