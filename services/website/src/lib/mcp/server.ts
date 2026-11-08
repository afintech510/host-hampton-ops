import { NextRequest } from 'next/server'
import { TENANT, featureEnabled } from '@/tenant'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { HOSTED_THEME_GROUPS } from '@/lib/hostedThemes'
import { RATING, HOMEPAGE_REVIEWS, PACKAGES_REVIEWS } from '@/lib/reviews'
import { STUDIO_ADDRESS_LINE } from '@/lib/studioLocation'
import { etToday } from '@/lib/bookingStatus'
import { GET as llmsTxt } from '@/app/llms.txt/route'
import { GET as availabilityRoute } from '@/app/api/availability/route'
import { GET as eventsRoute } from '@/app/api/events/route'
import { POST as leadRoute } from '@/app/api/lead/route'
import { MAX_QUOTE_GUESTS, plannerTotals } from '@/lib/quoteRequest'
import { mobileQuoteAnchor, partyMenu, photosFor, quoteParty, themesForAgents } from '@/lib/mcp/readers'
import { ACTIVITY_TAGS, THEME_TAGS } from '@/lib/mediaVocab'
import { summarizeMonth, type AvailabilityResponse } from '@/lib/agentAvailability'

/**
 * The PUBLIC MCP server: what ChatGPT, Claude or Gemini can ask this business
 * on a parent's behalf. https://modelcontextprotocol.io — Streamable HTTP,
 * stateless, JSON responses (no SSE stream, no session).
 *
 * Marketing surface, so the rules are the AI-facing ones the site already
 * follows (`/llms.txt`): answer from the same sources the pages render, never
 * restate a fact in a second place, and never publish a figure the site does
 * not. Every read tool is a call to an existing public route or loader.
 *
 * `start_inquiry` is the one tool that writes. It replays the website's own
 * lead form (`/api/lead`), so it is screened, rate-limited, attributed and
 * owner-notified exactly like a form fill — and it can be switched off on its
 * own (`publicMcpInquiry`).
 */

export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const
const LATEST = MCP_PROTOCOL_VERSIONS[0]

interface McpTool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  // All three are stated on every tool: the ChatGPT directory rejects a tool that leaves one out.
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean; idempotentHint?: boolean }
}

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const EVENT_TYPES = ['Kids Birthday Party', 'Studio Rental', 'Mobile Services', 'Permanent Jewelry', 'Other'] as const

export function listTools(env: NodeJS.ProcessEnv = process.env): McpTool[] {
  const name = TENANT.business.name
  const tools: McpTool[] = [
    {
      name: 'get_business_overview',
      title: `About ${name}`,
      description: `Everything an assistant needs to answer questions about ${name}: what it offers, party types, studio prices, what is included, service area, location, booking policy and links. Use it for general questions.`,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ,
    },
    {
      name: 'list_party_themes',
      title: 'Party themes and studio prices',
      description: `The studio party themes at ${name} with their live prices (10 kids, 2 hours), plus the custom themes we have hosted, by group. Every theme name returned here can be passed to get_quote exactly as written.`,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ,
    },
    {
      name: 'get_party_menu',
      title: 'The party menu',
      description: `What a studio party at ${name} includes, the activity choices and rules, and every add-on (food, desserts, drinks, decor, entertainment, extras) with its live price, plus how mobile parties are priced. Use the exact item names with get_quote.`,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ,
    },
    {
      name: 'check_availability',
      title: 'Open dates in a month',
      description:
        'The dates in a month that are open for a studio party, with the start times a 2-hour party fits, from the live studio calendar. Use this when a parent asks what is available ("which Saturdays in March?"). An open date is not held until the deposit is paid.',
      inputSchema: {
        type: 'object',
        properties: { month: { type: 'string', description: 'YYYY-MM' } },
        required: ['month'],
        additionalProperties: false,
      },
      annotations: READ,
    },
    {
      name: 'check_date_availability',
      title: 'Is a date open?',
      description:
        'Check whether a date is already blocked on the studio calendar. An open date is not a reservation — the parent books and pays a deposit to hold it.',
      inputSchema: {
        type: 'object',
        properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
        required: ['date'],
        additionalProperties: false,
      },
      annotations: READ,
    },
    {
      name: 'list_upcoming_events',
      title: 'Upcoming public events',
      description: `Ticketed public events and classes coming up at ${name}, with dates, prices and ticket links.`,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ,
    },
    {
      name: 'get_reviews',
      title: 'Reviews',
      description: `${name}'s Google rating and a few verbatim reviews from parents.`,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ,
    },
    {
      name: 'get_quote',
      title: 'Price a party',
      description: `Price a studio party at ${name} from the live price list: the theme, guest count, activities and add-ons. Prices come from the same engine as the website's party planner; never estimate one yourself. Names must match the catalog — use list_party_themes and get_party_menu. Returns the total, each line item, the deposit and a planner link already filled in. A quote is not a booking. Mobile parties are not totalled: the answer is how they are priced and how to get a quote.`,
      inputSchema: {
        type: 'object',
        properties: {
          party_type: { type: 'string', enum: ['studio', 'mobile'], description: 'studio = at the studio; mobile = we come to the family.' },
          guests: { type: 'integer', description: `Number of children invited, 1-${MAX_QUOTE_GUESTS}.` },
          theme: { type: 'string', description: 'Studio parties only: a theme name from list_party_themes.' },
          activities: { type: 'array', items: { type: 'string' }, description: 'Activity names, in the order the parent prefers them (the first premium one is the included one on higher themes).' },
          mini_party: { type: 'boolean', description: 'Studio only: the shorter Mini Party.' },
          add_ons: { type: 'array', items: { type: 'string' }, description: 'Food, dessert, drink, decor, entertainment or party add-on names.' },
        },
        required: ['party_type', 'guests'],
        additionalProperties: false,
      },
      annotations: READ,
    },
    {
      name: 'find_photos',
      title: 'Photos of our parties',
      description: `Real photos from ${name} parties, filtered by party type, theme or activity. Only photos that have been reviewed and show no identifiable children are ever returned. Share the links with the parent.`,
      inputSchema: {
        type: 'object',
        properties: {
          party_type: { type: 'string', enum: ['in_studio_theme', 'mobile_party', 'public_event'], description: 'Optional.' },
          theme: { type: 'string', enum: [...THEME_TAGS], description: 'Optional.' },
          activity: { type: 'string', enum: Object.keys(ACTIVITY_TAGS), description: 'Optional.' },
          limit: { type: 'integer', description: 'How many, 1-8. Default 4.' },
        },
        additionalProperties: false,
      },
      annotations: READ,
    },
    {
      name: 'get_booking_link',
      title: 'How to book',
      description: `The links a parent uses to book at ${name}: the planner (pick everything and pay the deposit) and the inquiry form, plus the phone number for a person. Nothing is reserved until the deposit is paid.`,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ,
    },
  ]
  if (featureEnabled('publicMcpInquiry', env)) {
    tools.push({
      name: 'start_inquiry',
      title: `Send an inquiry to ${name}`,
      description: `Send the parent's party inquiry to ${name}, who will reply by email or text. ONLY call this when the user has explicitly asked you to send their details, and has given you their name, email and phone themselves — never invent or infer contact details. It does not book or reserve anything.`,
      inputSchema: {
        type: 'object',
        properties: {
          full_name: { type: 'string', description: "The parent's full name." },
          email: { type: 'string' },
          phone: { type: 'string' },
          event_type: { type: 'string', enum: [...EVENT_TYPES] },
          preferred_date: { type: 'string', description: 'YYYY-MM-DD, if they have one.' },
          guest_count: { type: 'integer', description: 'Approximate number of kids/guests.' },
          // No child's name on this surface: the age helps plan the party, the name can wait for a person.
          child_age: { type: 'integer' },
          theme: { type: 'string', description: 'A theme they are interested in, if any.' },
          notes: { type: 'string', description: 'Anything else they want the business to know.' },
        },
        required: ['full_name', 'email', 'phone', 'event_type'],
        additionalProperties: false,
      },
      // destructive = irreversible, not harmful: an inquiry that went out cannot be recalled. It makes the client confirm first.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    })
  }
  return tools
}

export interface ToolCallResult {
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

function ok(data: Record<string, unknown>, text?: string): ToolCallResult {
  return { content: [{ type: 'text', text: text ?? JSON.stringify(data, null, 2) }], structuredContent: data }
}

function fail(message: string): ToolCallResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

/** Build a GET for one of our own public routes, forwarding who is asking (for rate limits). */
function internalGet(original: Request, path: string): NextRequest {
  const headers = new Headers()
  for (const h of ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip', 'user-agent', 'host']) {
    const v = original.headers.get(h)
    if (v) headers.set(h, v)
  }
  return new NextRequest(new URL(path, CANONICAL_ORIGIN), { method: 'GET', headers })
}

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t.slice(0, max) : undefined
}

export async function callTool(
  name: string,
  rawArgs: unknown,
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ToolCallResult> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>
  switch (name) {
    case 'get_business_overview': {
      const res = await llmsTxt()
      const text = await res.text()
      return { content: [{ type: 'text', text }] }
    }

    case 'list_party_themes': {
      const r = await themesForAgents()
      if (r.kind !== 'ok') return fail(`The theme list could not be read right now. Please call ${TENANT.contact.phoneDisplay}.`)
      const data = {
        studio_themes: r.themes.map(t => ({ name: t.name, price: usd(t.price_cents), about: t.about })),
        price_covers: '10 kids plus the birthday child, 2 hours. Use get_party_menu for what is included and the add-ons.',
        hosted_theme_groups: HOSTED_THEME_GROUPS.map(g => ({ group: g.title, themes: g.themes.map(t => t.name) })),
        plan_and_price_a_party: `${CANONICAL_ORIGIN}/party-builder`,
        book: `${CANONICAL_ORIGIN}/book`,
      }
      return ok(data)
    }

    case 'get_party_menu': {
      const r = await partyMenu()
      if (r.kind !== 'ok') return fail(`The menu could not be read right now. The full menu is at ${CANONICAL_ORIGIN}/party-menu.`)
      return ok(r.menu as unknown as Record<string, unknown>)
    }

    case 'check_availability': {
      const month = str(args.month, 7)
      if (!month || !ISO_MONTH.test(month)) return fail('month must be YYYY-MM')
      const today = etToday()
      if (month < today.slice(0, 7)) return fail('That month has passed.')
      const horizon = `${Number(today.slice(0, 4)) + 2}${today.slice(4, 7)}`
      if (month > horizon) return fail('That month is more than two years away.')
      const res = await availabilityRoute(internalGet(req, `/api/availability?month=${month}&bookingType=kids-party`))
      if (!res.ok) return fail('The calendar could not be checked right now.')
      const json = (await res.json()) as AvailabilityResponse
      if (!json.configured || json.calendarFailed) {
        return ok({ month, available: null, reason: `Availability is confirmed directly — call ${TENANT.contact.phoneDisplay}.` })
      }
      return ok({
        ...summarizeMonth(month, json, today),
        note:
          'Open dates come from the studio calendar and are not held until the deposit is paid. A date with anything already booked is not offered; a person can check whether another time works that day. Dates listed as too soon can still be asked about by phone or text.',
        book: `${CANONICAL_ORIGIN}/party-builder`,
        phone: TENANT.contact.phoneDisplay,
      })
    }

    case 'check_date_availability': {
      const date = str(args.date, 10)
      if (!date || !ISO_DATE.test(date)) return fail('date must be YYYY-MM-DD')
      if (date < etToday()) return ok({ date, available: false, reason: 'That date has passed.' })
      const res = await availabilityRoute(internalGet(req, `/api/availability?month=${date.slice(0, 7)}`))
      if (!res.ok) return fail('The calendar could not be checked right now.')
      const json = (await res.json()) as AvailabilityResponse
      // A calendar we could not read is not an empty one: `available: null` makes propose_booking refuse too.
      if (!json.configured || json.calendarFailed) {
        return ok({ date, available: null, reason: `Availability is confirmed directly — call ${TENANT.contact.phoneDisplay}.` })
      }
      const blocked = (json.blockedDates ?? []).includes(date)
      return ok({
        date,
        available: !blocked,
        note: blocked
          ? 'That date is already booked on the studio calendar.'
          : 'The studio calendar shows this date open. It is held only once the party is booked with a deposit; mobile parties are confirmed separately.',
        book: `${CANONICAL_ORIGIN}/book`,
      })
    }

    case 'list_upcoming_events': {
      const res = await eventsRoute(internalGet(req, '/api/events'))
      const json = (await res.json().catch(() => ({}))) as { events?: Record<string, unknown>[] }
      const events = (json.events ?? []).slice(0, 20).map(e => ({
        title: e.title,
        date: e.event_date,
        time: e.event_time,
        from_price: typeof e.price_cents === 'number' ? usd(e.price_cents) : null,
        summary: e.short_description,
        tickets_left: e.available_tickets,
        link: `${CANONICAL_ORIGIN}/events/${encodeURIComponent(String(e.slug ?? ''))}`,
      }))
      return ok({ events, all_events: `${CANONICAL_ORIGIN}/events` })
    }

    case 'get_reviews': {
      const seen = new Set<string>()
      const reviews = [...HOMEPAGE_REVIEWS, ...PACKAGES_REVIEWS]
        .filter(r => (seen.has(r.name) ? false : (seen.add(r.name), true)))
        .map(r => ({ name: r.name, stars: r.stars, occasion: r.occasion ?? null, text: r.text }))
      return ok({
        rating: RATING.ratingValue,
        review_count: RATING.reviewCount,
        source: 'Google',
        // Our own page, which holds every review verbatim: the website assistant may only hand out links to this site.
        all_reviews: `${CANONICAL_ORIGIN}/reviews`,
        reviews,
      })
    }

    case 'get_quote': {
      if (args.party_type === 'mobile') {
        const a = await mobileQuoteAnchor()
        if (a.kind !== 'ok') return fail(`Mobile parties are quoted individually — please call ${TENANT.contact.phoneDisplay} or use ${CANONICAL_ORIGIN}/mobile-party.`)
        return ok({ mobile_party: a.anchor })
      }
      const strList = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === 'string') : [])
      const q = await quoteParty({
        partyType: args.party_type as 'studio' | 'mobile',
        guests: Number(args.guests),
        theme: str(args.theme, 80),
        activities: strList(args.activities),
        mini: args.mini_party === true,
        addOns: strList(args.add_ons),
      })
      if (q.kind !== 'ok') return fail(`The price list could not be read right now. Please call ${TENANT.contact.phoneDisplay}.`)
      const ans = q.answer
      if (!ans.ok) return fail(ans.error)
      const guests = ans.quote.effectiveGuestCount
      const data = {
        total: usd(ans.quote.totalCents),
        total_cents: ans.quote.totalCents,
        deposit_to_hold_the_date: usd(plannerTotals(ans.quote.lineItems, guests).depositCents),
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
        over_the_activity_limit: ans.overLimit,
        notes: [
          'This is a quote, not a booking. The date is held once the deposit is paid.',
          ans.unmatched.length || ans.ambiguous.length ? 'Some names were not matched and are NOT in the total — ask the parent, or use list_party_themes and get_party_menu for the exact names.' : null,
          ans.overLimit.length ? 'Some activities are past the limit (2 premium, 3 standard) and are NOT in the total.' : null,
        ].filter(Boolean),
        open_in_planner: ans.plannerUrl,
        book: `${CANONICAL_ORIGIN}/book`,
      }
      return ok(data)
    }

    case 'find_photos': {
      const limit = Math.max(1, Math.min(8, Math.floor(Number(args.limit) || 4)))
      const r = await photosFor({
        partyType: str(args.party_type, 40), themeSlug: str(args.theme, 60), activity: str(args.activity, 60), limit,
      })
      if (r.kind !== 'ok') return fail('Photos could not be loaded right now.')
      const photos = r.photos.map(p => ({ url: p.url, description: p.alt, party_type: p.partyType, theme: p.themeSlug, activities: p.activities, instagram: p.igPermalink }))
      return ok(
        { photos, more_photos: `${CANONICAL_ORIGIN}/gallery` },
        photos.length
          ? `${photos.length} photo${photos.length === 1 ? '' : 's'}:\n${photos.map(p => `- ${p.description || 'Party photo'}: ${p.url}`).join('\n')}\n\nMore: ${CANONICAL_ORIGIN}/gallery`
          : `No reviewed photos match that yet. See the gallery: ${CANONICAL_ORIGIN}/gallery`,
      )
    }

    case 'get_booking_link': {
      return ok({
        plan_and_book: `${CANONICAL_ORIGIN}/party-builder`,
        inquiry_form: `${CANONICAL_ORIGIN}/book`,
        phone: TENANT.contact.phoneDisplay,
        note: 'The date is held once the deposit is paid; nothing is reserved before that.',
      })
    }

    case 'start_inquiry': {
      if (!featureEnabled('publicMcpInquiry', env)) return fail('Inquiries are not accepted here — use the website.')
      const fullName = str(args.full_name, 200)
      const email = str(args.email, 200)
      const phone = str(args.phone, 40)
      const eventType = (EVENT_TYPES as readonly string[]).includes(String(args.event_type)) ? String(args.event_type) : undefined
      if (!fullName || !email || !phone || !eventType) {
        return fail('full_name, email, phone and event_type are required — ask the parent for them.')
      }
      const preferredDate = str(args.preferred_date, 10)
      if (preferredDate && !ISO_DATE.test(preferredDate)) return fail('preferred_date must be YYYY-MM-DD')

      const headers = new Headers({ 'content-type': 'application/json' })
      for (const h of ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip', 'user-agent', 'host']) {
        const v = req.headers.get(h)
        if (v) headers.set(h, v)
      }
      const body = {
        eventType,
        fullName,
        email,
        phone,
        childAge: Number.isFinite(Number(args.child_age)) ? Number(args.child_age) : undefined,
        guestCount: args.guest_count,
        partyTheme: str(args.theme, 200),
        preferredDate,
        notes: [str(args.notes, 3500), '(Sent through an AI assistant via the MCP connector.)'].filter(Boolean).join('\n\n'),
        sourcePage: 'ai-assistant-mcp',
        // Attribution: the AI channel is already this business's #2 lead source;
        // this makes the MCP slice of it countable on its own.
        utm: { utm_source: 'mcp', utm_medium: 'ai-assistant', utm_campaign: 'start_inquiry', landing_path: '/api/mcp' },
        heardAbout: 'ai_assistant',
        marketingConsent: false,
      }
      const res = await leadRoute(new NextRequest(new URL('/api/lead', CANONICAL_ORIGIN), { method: 'POST', headers, body: JSON.stringify(body) }))
      const json = (await res.json().catch(() => ({}))) as { error?: string; success?: boolean }
      if (res.status === 429) return fail(`Too many inquiries right now — please call ${TENANT.contact.phoneDisplay} or use ${CANONICAL_ORIGIN}/book.`)
      if (!res.ok || json.success !== true) {
        return fail(json.error || `The inquiry could not be sent — please call ${TENANT.contact.phoneDisplay}.`)
      }
      return ok(
        { sent: true, reply_by: 'email or text', confirmation_email_to: email },
        `Sent. ${TENANT.business.name} has the inquiry and a confirmation email is on its way to ${email}. They usually reply by email or text. Nothing is booked yet — the date is held once the party is booked with a deposit.`,
      )
    }

    default:
      return fail(`Unknown tool: ${name}`)
  }
}

/* ── JSON-RPC ─────────────────────────────────────────────────────────── */

interface RpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

export type RpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } }

function rpcError(id: RpcRequest['id'], code: number, message: string): RpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

export function serverInstructions(): string {
  return [
    `${TENANT.business.name}: ${TENANT.business.oneLiner}`,
    `Location: ${STUDIO_ADDRESS_LINE}. Phone ${TENANT.contact.phoneDisplay}. Website ${CANONICAL_ORIGIN}.`,
    'Use get_business_overview for general questions, list_party_themes for themes and studio prices, get_party_menu for what a party includes and every add-on, get_quote to price a specific party, check_availability for open dates in a month (check_date_availability for one date), find_photos for real party photos, list_upcoming_events for public events, get_reviews for reviews, get_booking_link for how to book, and start_inquiry only when the parent asks you to send their details.',
    'Quote only prices these tools return, exactly as returned. Mobile (at-home) parties are quoted individually: give the quote link and never a total, and no dollar figure unless a tool returns one. Never promise a date is reserved: it is held once the deposit is paid.',
    'To book, send the parent to the open_in_planner link from get_quote (it opens the planner already filled in), or use get_booking_link.',
  ].join('\n')
}

/** Handle one JSON-RPC message. Returns null for a notification (no reply). */
export async function handleRpc(msg: RpcRequest, req: Request, env: NodeJS.ProcessEnv = process.env): Promise<RpcResponse | null> {
  const isNotification = msg.id === undefined
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return isNotification ? null : rpcError(msg.id, -32600, 'Invalid request')
  }
  if (isNotification) return null // notifications/initialized, cancelled, …

  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '')
      const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : LATEST
      return {
        jsonrpc: '2.0',
        id: msg.id ?? null,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: `${TENANT.id}-public`, title: TENANT.business.name, version: '1.0.0' },
          instructions: serverInstructions(),
        },
      }
    }
    case 'ping':
      return { jsonrpc: '2.0', id: msg.id ?? null, result: {} }
    case 'tools/list':
      return { jsonrpc: '2.0', id: msg.id ?? null, result: { tools: listTools(env) } }
    case 'tools/call': {
      const name = String(msg.params?.name ?? '')
      if (!listTools(env).some(t => t.name === name)) return rpcError(msg.id, -32602, `Unknown tool: ${name}`)
      try {
        const result = await callTool(name, msg.params?.arguments, req, env)
        return { jsonrpc: '2.0', id: msg.id ?? null, result }
      } catch (err) {
        console.error(`mcp: tool ${name} threw`, err)
        return { jsonrpc: '2.0', id: msg.id ?? null, result: fail('Something went wrong — please try again.') }
      }
    }
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`)
  }
}
