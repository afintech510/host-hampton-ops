/**
 * The tools the website Host Assistant may call.
 *
 * ── THE AUTHORITY MODEL, IN ONE PARAGRAPH ──
 *
 * The model can READ (price list, photos, the calendar, the theme list) and it
 * can PROPOSE. `propose_booking` signs a card and writes nothing; the only code
 * that creates a booking is `/api/chat/confirm`, reached by a visitor tapping the
 * button on that card (lib/chat/confirm.ts). The one other tool that writes is
 * `start_inquiry`, which replays the website's own lead form — screened,
 * rate-limited, attributed and owner-notified exactly like a form fill — once
 * per session, with a name, email and phone the visitor typed themselves.
 * Nothing here takes a payment, moves money, sends a message to a customer or
 * looks up anyone's existing booking.
 *
 * ── THE MODEL NEVER SUPPLIES A NUMBER ──
 *
 * Prices come from `quoteParty` (the planner's engine). The model passes NAMES
 * and a guest count. Totals on a card are recomputed here with the arithmetic
 * `/api/party-builder/save` will use, and a card is refused if the two disagree.
 *
 * Visitor text is untrusted, so it never becomes a write argument directly: each
 * contact detail the model passes must appear verbatim in what the visitor typed
 * (`unstatedByVisitor`), and everything else is a name the engine must match.
 */

import { TENANT } from '@/tenant'
import { getSupabase } from '@/lib/supabase'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { etToday } from '@/lib/bookingStatus'
import { callTool } from '@/lib/mcp/server'
import { photosFor, quoteParty } from '@/lib/mcp/readers'
import { POST as leadRoute } from '@/app/api/lead/route'
import { NextRequest } from 'next/server'
import type { LlmTool, ToolRunResult } from '@/lib/ai/provider'
import { MAX_QUOTE_GUESTS } from '@/lib/quoteRequest'
import { buildPlanSnapshot, coerceIsoDate } from '@/lib/plan'
import { screenPublicGuestCount, screenPublicLineItems } from '@/lib/publicIntake'
import { isPlausibleEmailAddress } from '@/lib/contactLookup'
import type { BookingLineItem } from '@/types/booking-flow'
import type { QuoteLineItem } from '@/lib/quoteEngine'
import { unstatedByVisitor } from '@/lib/chat/text'
import { mintCard } from '@/lib/chat/card'
import { claimInquiry, markInquiry, releaseInquiry } from '@/lib/chat/session'

type Supa = ReturnType<typeof getSupabase>

/** What a turn collects for the widget to draw, beside the model's words. */
export type ChatCard =
  | { type: 'photos'; photos: { url: string; alt: string }[]; moreUrl: string }
  | { type: 'booking'; token: string; title: string; lines: string[]; total: string; deposit: string; date: string; guests: number }

export interface ChatToolContext {
  supabase: Supa
  /** The visitor's request, for the headers a replayed route reads (rate-limit identity, host). */
  req: Request
  sessionId: string
  /** Everything the visitor has typed in this session, unfenced. */
  visitorSaid: string[]
  /** Pushed to by tools; returned to the widget. */
  cards: ChatCard[]
  now?: Date
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const EVENT_TYPES = ['Kids Birthday Party', 'Studio Rental', 'Mobile Services', 'Permanent Jewelry', 'Other'] as const

export const usd = (cents: number): string => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t.slice(0, max) : undefined
}

const strList = (v: unknown, max = 10): string[] =>
  (Array.isArray(v) ? (v as unknown[]) : []).filter((x): x is string => typeof x === 'string').map(x => x.trim().slice(0, 80)).filter(Boolean).slice(0, max)

const ok = (result: unknown): ToolRunResult => ({ result })
const fail = (message: string): ToolRunResult => ({ result: { error: message }, isError: true })

function forwardHeaders(original: Request, extra: Record<string, string> = {}): Headers {
  const headers = new Headers(extra)
  for (const h of ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip', 'user-agent', 'host']) {
    const v = original.headers.get(h)
    if (v) headers.set(h, v)
  }
  return headers
}

/** The planner's own total for these items — the arithmetic `/api/party-builder/save` will run. */
export function plannerTotals(lineItems: QuoteLineItem[], guests: number): { totalCents: number; depositCents: number } {
  const snap = buildPlanSnapshot({ lineItems: lineItems as unknown as BookingLineItem[], guestCount: guests })
  return { totalCents: snap.totalCents, depositCents: snap.depositCents }
}

/* ── the tool list ───────────────────────────────────────────────────────── */

export const CHAT_TOOLS: LlmTool[] = [
  {
    name: 'list_party_themes',
    description: `The current studio party themes at ${TENANT.business.name} with their live starting prices, plus the hosted theme groups. Call this before quoting so names match the catalog.`,
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_quote',
    description:
      'Price a party from the live price list. You pass NAMES (theme, activities, add-ons) and a guest count; the price comes back from the same engine as the website planner. Never state a price that did not come from this tool. A quote is not a booking. Names that are not matched are NOT priced.',
    input_schema: {
      type: 'object',
      properties: {
        party_type: { type: 'string', enum: ['studio', 'mobile'], description: 'studio = at the studio; mobile = we come to the family.' },
        guests: { type: 'integer', description: `Children invited, 1-${MAX_QUOTE_GUESTS}.` },
        theme: { type: 'string', description: 'Studio only: a theme name from list_party_themes.' },
        activities: { type: 'array', items: { type: 'string' }, description: 'Activity names in the order the parent prefers.' },
        mini_party: { type: 'boolean', description: 'Studio only: the shorter Mini Party.' },
        add_ons: { type: 'array', items: { type: 'string' }, description: 'Food, dessert, drink, decor, entertainment or party add-on names.' },
      },
      required: ['party_type', 'guests'],
      additionalProperties: false,
    },
  },
  {
    name: 'check_date_availability',
    description:
      'Is a date already blocked on the studio calendar? An open date is NOT held: it is held only once the deposit is paid. Never say a date is reserved.',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
      required: ['date'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_photos',
    description:
      'Real photos of parties, filtered by party type, theme or activity. Only reviewed photos with no identifiable children are ever returned. The photos are shown to the visitor automatically as a carousel — do not paste links.',
    input_schema: {
      type: 'object',
      properties: {
        party_type: { type: 'string', enum: ['in_studio_theme', 'mobile_party', 'public_event'] },
        theme: { type: 'string', description: 'Theme slug, e.g. glow-party.' },
        activity: { type: 'string', description: 'Activity tag, e.g. slime-making.' },
        limit: { type: 'integer', description: 'How many, 1-8. Default 4.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_booking_link',
    description: 'The links for booking yourself (the planner and the inquiry form) and how to reach a person.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'propose_booking',
    description:
      'PROPOSE a studio party booking. This books NOTHING and takes no payment: it shows the visitor a card with the date, the price and the deposit and a button. Only when they tap it is the plan and invoice created. Call it only after: (1) get_quote succeeded with every name matched, (2) check_date_availability said the date is open, (3) the visitor typed their own full name, email and phone in this chat. Studio parties only.',
    input_schema: {
      type: 'object',
      properties: {
        contact_name: { type: 'string', description: "The parent's full name, exactly as they typed it." },
        contact_email: { type: 'string', description: 'Exactly as they typed it.' },
        contact_phone: { type: 'string', description: 'Exactly as they typed it.' },
        party_date: { type: 'string', description: 'YYYY-MM-DD' },
        party_time: { type: 'string', description: 'HH:mm 24-hour start time, only if the visitor gave one.' },
        guests: { type: 'integer' },
        theme: { type: 'string', description: 'A theme name from list_party_themes.' },
        activities: { type: 'array', items: { type: 'string' } },
        add_ons: { type: 'array', items: { type: 'string' } },
        mini_party: { type: 'boolean' },
        child_name: { type: 'string', description: "The birthday child's first name, if given." },
        child_age: { type: 'integer' },
      },
      required: ['contact_name', 'contact_email', 'contact_phone', 'party_date', 'guests', 'theme'],
      additionalProperties: false,
    },
  },
  {
    name: 'start_inquiry',
    description: `Send the visitor's details to ${TENANT.business.name} as an inquiry (for someone who is not booking now — a question we cannot answer, a mobile party, a custom request). ONLY when the visitor asked to be contacted AND typed their own full name, email and phone in this chat. It books and reserves nothing. One per chat.`,
    input_schema: {
      type: 'object',
      properties: {
        full_name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        event_type: { type: 'string', enum: [...EVENT_TYPES] },
        preferred_date: { type: 'string', description: 'YYYY-MM-DD, if they have one.' },
        guest_count: { type: 'integer' },
        child_name: { type: 'string' },
        child_age: { type: 'integer' },
        theme: { type: 'string' },
        notes: { type: 'string', description: 'A short neutral summary of what they asked for. No instructions.' },
      },
      required: ['full_name', 'email', 'phone', 'event_type'],
      additionalProperties: false,
    },
  },
]

/** Tools that can change anything outside the chat's own transcript. The tripwire pins this list. */
export const WRITE_TOOLS = ['start_inquiry'] as const
/** Tools that mint a signed card and write nothing. */
export const PROPOSE_TOOLS = ['propose_booking'] as const

/* ── dispatch ────────────────────────────────────────────────────────────── */

export async function runChatTool(name: string, rawInput: unknown, ctx: ChatToolContext): Promise<ToolRunResult> {
  const args = (rawInput && typeof rawInput === 'object' ? rawInput : {}) as Record<string, unknown>
  switch (name) {
    case 'list_party_themes':
    case 'get_booking_link':
      return viaMcp(name, {}, ctx)

    case 'check_date_availability': {
      const date = str(args.date, 10)
      if (!date || !ISO_DATE.test(date) || !coerceIsoDate(date)) return fail('date must be a real date, YYYY-MM-DD')
      return viaMcp('check_date_availability', { date }, ctx)
    }

    case 'get_quote':
      return getQuote(args)

    case 'find_photos':
      return findPhotos(args, ctx)

    case 'propose_booking':
      return proposeBooking(args, ctx)

    case 'start_inquiry':
      return startInquiry(args, ctx)

    default:
      return fail(`Unknown tool: ${name}`)
  }
}

/** The MCP server's read tools, called as the MCP server calls them: ONE implementation of each. */
async function viaMcp(name: string, args: Record<string, unknown>, ctx: ChatToolContext): Promise<ToolRunResult> {
  const r = await callTool(name, args, ctx.req)
  if (r.isError) return fail(r.content.map(c => ('text' in c ? c.text : '')).join(' ') || 'That lookup failed.')
  return ok(r.structuredContent ?? r.content.map(c => ('text' in c ? c.text : '')).join('\n'))
}

async function getQuote(args: Record<string, unknown>): Promise<ToolRunResult> {
  const q = await quoteParty({
    partyType: args.party_type as 'studio' | 'mobile',
    guests: Number(args.guests),
    theme: str(args.theme, 80),
    activities: strList(args.activities, 8),
    mini: args.mini_party === true,
    addOns: strList(args.add_ons),
  })
  if (q.kind !== 'ok') return fail(`The price list could not be read right now. A person can quote it: ${TENANT.contact.phoneDisplay}.`)
  const ans = q.answer
  if (!ans.ok) return fail(ans.error)
  const guests = ans.quote.effectiveGuestCount
  const { depositCents } = plannerTotals(ans.quote.lineItems, guests)
  return ok({
    total: usd(ans.quote.totalCents),
    deposit_due_to_hold_the_date: usd(depositCents),
    guests_priced: guests,
    line_items: ans.quote.lineItems.map(l => ({
      item: l.name,
      quantity: l.quantity,
      each: usd(l.unit_price_cents),
      per_guest: l.guest_multiplied,
      line_total: usd(l.guest_multiplied ? l.unit_price_cents * l.quantity * guests : l.unit_price_cents * l.quantity),
    })),
    not_found: ans.unmatched,
    ambiguous: ans.ambiguous,
    notes: [
      ans.travelNotIncluded ? 'Mobile parties: the travel fee is added from the party address when it is booked, so it is not in this total. Mobile parties cannot be booked in this chat — offer start_inquiry or the planner link.' : null,
      'This is a quote, not a booking. The date is held once the deposit is paid.',
      ans.unmatched.length || ans.ambiguous.length ? 'Some names were not matched and are NOT in the total. Ask the visitor, or call list_party_themes.' : null,
    ].filter(Boolean),
  })
}

async function findPhotos(args: Record<string, unknown>, ctx: ChatToolContext): Promise<ToolRunResult> {
  const limit = Math.max(1, Math.min(8, Math.floor(Number(args.limit) || 4)))
  const r = await photosFor({ partyType: str(args.party_type, 40), themeSlug: str(args.theme, 60), activity: str(args.activity, 60), limit })
  if (r.kind !== 'ok') return fail('Photos could not be loaded right now.')
  const photos = r.photos.map(p => ({ url: p.url, alt: p.alt || 'A party at the studio' }))
  const moreUrl = `${CANONICAL_ORIGIN}/gallery`
  if (photos.length) ctx.cards.push({ type: 'photos', photos, moreUrl })
  return ok({
    shown_to_visitor: photos.length,
    descriptions: photos.map(p => p.alt),
    note: photos.length
      ? 'The photos are displayed to the visitor as a carousel with a link to the full gallery. Do not paste links.'
      : `No reviewed photos match that yet. The full gallery is at ${moreUrl}.`,
  })
}

/* ── propose_booking ─────────────────────────────────────────────────────── */

async function proposeBooking(args: Record<string, unknown>, ctx: ChatToolContext): Promise<ToolRunResult> {
  const name = str(args.contact_name, 200)
  const email = str(args.contact_email, 200)
  const phone = str(args.contact_phone, 40)
  if (!name || !email || !phone) return fail('contact_name, contact_email and contact_phone are required — ask the visitor for them.')
  if (!isPlausibleEmailAddress(email)) return fail('That email address does not look right — ask the visitor to check it.')

  // The visitor must have typed these themselves. The model cannot supply or "fix" them.
  const unstated = unstatedByVisitor(ctx.visitorSaid, { name, email, phone })
  if (unstated.length) {
    return fail(`The visitor has not typed their own ${unstated.join(', ')} in this chat. Ask them for it; never guess or infer contact details.`)
  }

  const date = str(args.party_date, 10)
  if (!date || !ISO_DATE.test(date) || !coerceIsoDate(date)) return fail('party_date must be a real date, YYYY-MM-DD')
  const today = etToday(ctx.now)
  if (date <= today) return fail('That date is today or has passed — ask for a future date.')
  const horizon = new Date(`${today}T12:00:00Z`)
  horizon.setUTCFullYear(horizon.getUTCFullYear() + 2)
  if (date > horizon.toISOString().slice(0, 10)) return fail('That date is more than two years away — ask the visitor to confirm it.')

  const time = str(args.party_time, 5)
  if (time && !HHMM.test(time)) return fail('party_time must be HH:mm (24-hour)')

  const guests = screenPublicGuestCount(args.guests)
  if (guests === null || guests > MAX_QUOTE_GUESTS) return fail(`guests must be a whole number from 1 to ${MAX_QUOTE_GUESTS}`)

  const theme = str(args.theme, 80)
  if (!theme) return fail('A theme is required. Call list_party_themes for the names.')

  const open = await dateIsOpen(date, ctx)
  if (open !== 'open') {
    return fail(open === 'blocked'
      ? 'That date is already booked on the studio calendar. Offer another date.'
      : `The calendar could not be checked just now. Do not propose a booking; offer to try again in a moment, or a person can help: ${TENANT.contact.phoneDisplay}.`)
  }

  const activities = strList(args.activities, 8)
  const addOns = strList(args.add_ons)
  const mini = args.mini_party === true
  const q = await quoteParty({ partyType: 'studio', guests, theme, activities, mini, addOns })
  if (q.kind !== 'ok') return fail(`The price list could not be read right now. A person can help: ${TENANT.contact.phoneDisplay}.`)
  if (!q.answer.ok) return fail(q.answer.error)
  const ans = q.answer
  if (ans.unmatched.length || ans.ambiguous.length) {
    return fail(`These names were not matched exactly, so no card was made: ${[...ans.unmatched, ...ans.ambiguous.map(a => a.asked)].join(', ')}. Confirm them with list_party_themes and the visitor.`)
  }

  // The card will be saved through the planner's own route, which screens the items
  // and recomputes the totals. Do both HERE too, so a card is never a dud and never
  // shows a figure the save will not write.
  const effective = ans.quote.effectiveGuestCount
  const screened = screenPublicLineItems(ans.quote.lineItems, effective)
  if (!screened.ok) {
    console.error(`chat: the engine produced line items the public screen refuses — ${screened.reason}`)
    return fail(`This party could not be priced for online booking (${screened.reason}). A person will need to help: ${TENANT.contact.phoneDisplay}.`)
  }
  const { totalCents, depositCents } = plannerTotals(ans.quote.lineItems, effective)
  if (totalCents !== ans.quote.totalCents || totalCents <= 0) {
    console.error(`chat: planner total ${totalCents} disagrees with engine total ${ans.quote.totalCents} — no card`)
    return fail(`The price could not be confirmed for online booking. A person will need to help: ${TENANT.contact.phoneDisplay}.`)
  }

  const childAge = Number.isInteger(Number(args.child_age)) && Number(args.child_age) >= 0 && Number(args.child_age) <= 25 ? Number(args.child_age) : null
  const themeName = ans.theme ?? theme
  const { card, token } = mintCard({
    sid: ctx.sessionId,
    contact: { name, email, phone },
    date,
    time: time ?? null,
    childName: str(args.child_name, 80) ?? null,
    childAge,
    selection: { theme: themeName, guests, mini, activities: ans.activities, addOns: ans.addOns },
    guestsPriced: effective,
    lineItems: ans.quote.lineItems,
    totalCents,
    depositCents,
  })

  // One live card at a time: a changed mind replaces the old one.
  for (let i = ctx.cards.length - 1; i >= 0; i--) if (ctx.cards[i].type === 'booking') ctx.cards.splice(i, 1)
  ctx.cards.push({
    type: 'booking',
    token,
    title: `${themeName} party`,
    lines: [
      ...ans.quote.lineItems.map(l => `${l.name}${l.quantity > 1 ? ` x${l.quantity}` : ''}`),
    ],
    total: usd(totalCents),
    deposit: usd(depositCents),
    date,
    guests: effective,
  })

  return ok({
    status: 'awaiting_visitor_tap',
    nothing_booked_yet: true,
    card_id: card.id,
    date,
    total: usd(totalCents),
    deposit_due_to_hold_the_date: usd(depositCents),
    instruction:
      'A card with a "Book it & see my invoice" button is now showing. Tell the visitor that NOTHING is booked yet, that tapping the button creates their plan and invoice, and that the date is held once the deposit is paid on the secure invoice page. Do not describe it as booked.',
  })
}

/** open | blocked | unknown — never "ok" on an error (rule 12). */
export async function dateIsOpen(date: string, ctx: Pick<ChatToolContext, 'req'>): Promise<'open' | 'blocked' | 'unknown'> {
  const r = await callTool('check_date_availability', { date }, ctx.req)
  if (r.isError) return 'unknown'
  const a = r.structuredContent?.available
  if (a === true) return 'open'
  if (a === false) return 'blocked'
  return 'unknown'
}

/* ── start_inquiry ───────────────────────────────────────────────────────── */

async function startInquiry(args: Record<string, unknown>, ctx: ChatToolContext): Promise<ToolRunResult> {
  const fullName = str(args.full_name, 200)
  const email = str(args.email, 200)
  const phone = str(args.phone, 40)
  const eventType = (EVENT_TYPES as readonly string[]).includes(String(args.event_type)) ? String(args.event_type) : undefined
  if (!fullName || !email || !phone || !eventType) return fail('full_name, email, phone and event_type are required — ask the visitor for them.')
  if (!isPlausibleEmailAddress(email)) return fail('That email address does not look right — ask the visitor to check it.')

  const unstated = unstatedByVisitor(ctx.visitorSaid, { name: fullName, email, phone })
  if (unstated.length) return fail(`The visitor has not typed their own ${unstated.join(', ')} in this chat. Ask for it; never guess.`)

  const preferredDate = str(args.preferred_date, 10)
  if (preferredDate && (!ISO_DATE.test(preferredDate) || !coerceIsoDate(preferredDate))) return fail('preferred_date must be a real date, YYYY-MM-DD')

  const claim = await claimInquiry(ctx.supabase, ctx.sessionId)
  if (claim === 'taken') return fail('An inquiry was already sent from this chat. Tell the visitor a person will reply by email or text.')
  if (claim === 'failed') return fail(`The inquiry could not be sent right now — please call or text ${TENANT.contact.phoneDisplay}.`)

  const body = {
    eventType,
    fullName,
    email,
    phone,
    childName: str(args.child_name, 80),
    childAge: Number.isFinite(Number(args.child_age)) ? Number(args.child_age) : undefined,
    guestCount: screenPublicGuestCount(args.guest_count) ?? undefined,
    partyTheme: str(args.theme, 200),
    preferredDate,
    notes: [str(args.notes, 600), '(Sent through the website chat assistant.)'].filter(Boolean).join('\n\n'),
    sourcePage: 'website-chat',
    utm: { utm_source: 'website-chat', utm_medium: 'chat', utm_campaign: 'host-assistant', landing_path: '/' },
    marketingConsent: false,
  }
  const res = await leadRoute(
    new NextRequest(new URL('/api/lead', CANONICAL_ORIGIN), {
      method: 'POST',
      headers: forwardHeaders(ctx.req, { 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    }),
  )
  const json = (await res.json().catch(() => ({}))) as { success?: boolean }
  if (!res.ok || json.success !== true) {
    await releaseInquiry(ctx.supabase, ctx.sessionId)
    return fail(`The inquiry could not be sent right now — please call or text ${TENANT.contact.phoneDisplay}.`)
  }
  await markInquiry(ctx.supabase, ctx.sessionId, { name: fullName, email })
  return ok({
    sent: true,
    note: 'The inquiry reached the team, who reply by email or text. Nothing is booked or held. Say exactly that.',
  })
}
