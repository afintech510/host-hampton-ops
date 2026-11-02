import type Anthropic from '@anthropic-ai/sdk'
import { getSupabase } from '@/lib/supabase'
import { findBookingsByContactEmail, findContactsByEmail, findContactsByPhone, contactSearchFilter } from '@/lib/contactLookup'
import { orIlikeFilter } from '@/lib/postgrestFilter'
import { loadPlanInvoice } from '@/lib/planInvoice'
import { loadPricingCatalog, loadLineItemAddOns } from '@/lib/pricingCatalog'
import { loadStudioThemes } from '@/lib/partyCostFaq'
import { getCalendarEvents, parseCalendarBlocks } from '@/lib/googleCalendar'
import { bookingStage, etToday } from '@/lib/bookingStatus'
import { sumPayments } from '@/lib/bookingBalance'
import { billedTotalCents, type BilledItem } from '@/lib/planBalance'
import { CLIENT_LINK_KINDS, screenLinkKinds, clientLinkLabel, type ClientLinkKind } from '@/lib/clientLinks'
import { PARTY_TYPES, isPartyType } from '@/lib/pipelineStages'
import { mintProposal, type Proposal } from './proposals'

/**
 * The Manager assistant's tools.
 *
 * Two kinds, and the split is the whole safety model:
 *
 *   * READ tools run immediately and return data.
 *   * PROPOSE tools (`propose_*`) run NOTHING. They screen their input, build a
 *     human-readable card, and return a signed proposal (./proposals.ts). The
 *     write happens only when an admin clicks Confirm on that card, and it is
 *     carried out by replaying the very admin API call the dashboard makes
 *     (./execute.ts) — so every guard those routes already have (quiet hours,
 *     STOP lists, cancelled bookings, placeholder checks, payment caps) applies
 *     unchanged, and no money or messaging logic is duplicated here.
 *
 * Everything a tool returns is DATA about customers, written partly by
 * customers. The system prompt says so; nothing a tool returns is an
 * instruction.
 */

type Supa = ReturnType<typeof getSupabase>

export interface ToolContext {
  actor: string
  supabase?: Supa
  now?: Date
}

export interface ToolOutcome {
  /** JSON-serialisable result handed back to the model. */
  result: unknown
  isError?: boolean
  /** Set by propose_* tools: the card the UI shows, with its signed token. */
  proposal?: { proposal: Proposal; token: string }
}

const MAX_LIST = 25
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

const PARTY_COLUMNS =
  'id, booking_ref, status, party_type, event_type, party_date, party_time, guest_count_approx, child_name, contact_name, contact_phone, total_cents, created_at'

/* ── Tool definitions ─────────────────────────────────────────────────── */

export const ASSISTANT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'find_client',
    description:
      'Look up a client (contact) by email address, phone number, or name. Returns matching contacts, oldest first — the oldest row is the canonical one. Use this before proposing a new party so you do not create a duplicate person.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'An email, a phone number, or part of a name.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_parties',
    description:
      'List parties/bookings. Filter by a name, child name or booking ref (HH-…), or by a client email, and/or a date range. Defaults to upcoming parties, soonest first. Cancelled and lost bookings are excluded unless include_cancelled is true.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Client name, child name, booking ref, or client email. Optional.' },
        from_date: { type: 'string', description: 'YYYY-MM-DD, inclusive. Defaults to today.' },
        to_date: { type: 'string', description: 'YYYY-MM-DD, inclusive. Optional.' },
        include_past: { type: 'boolean', description: 'Include parties before today. Default false.' },
        include_cancelled: { type: 'boolean', description: 'Default false.' },
        limit: { type: 'integer', description: `1-${MAX_LIST}. Default 10.` },
      },
    },
  },
  {
    name: 'get_party',
    description:
      'Full detail of one party by booking ref: status, date, client, guest count, every line item, the total, what has been paid and what is still owed.',
    input_schema: {
      type: 'object',
      properties: { booking_ref: { type: 'string', description: 'e.g. HH-PTY-AB12C' } },
      required: ['booking_ref'],
    },
  },
  {
    name: 'check_date',
    description:
      'Is a date free? Returns the calendar blocks for that day and every non-cancelled party already on it.',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
      required: ['date'],
    },
  },
  {
    name: 'get_pricing',
    description:
      'The live price list: studio theme parties, studio rental rates, guest rules, mobile party tiers, and priced add-ons. Use these figures when quoting; never invent a price.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'propose_create_party',
    description:
      'PROPOSE creating a new party plan (a booking awaiting deposit). Nothing is created until the manager clicks Confirm on the card. No email is sent to the client by creating it; send links separately with propose_send_client_links. Look the client up with find_client first.',
    input_schema: {
      type: 'object',
      properties: {
        contact_name: { type: 'string' },
        contact_email: { type: 'string' },
        contact_phone: { type: 'string' },
        child_name: { type: 'string' },
        party_date: { type: 'string', description: 'YYYY-MM-DD' },
        party_time: { type: 'string', description: 'HH:mm, 24-hour' },
        guest_count: { type: 'integer' },
        party_type: { type: 'string', enum: [...PARTY_TYPES] },
        package_type: { type: 'string', description: 'Theme or package name, e.g. "Slime Party".' },
        notes: { type: 'string', description: 'Internal admin notes. Never shown to the client.' },
        line_items: {
          type: 'array',
          description: 'Optional priced items. Use prices from get_pricing.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              unit_price_cents: { type: 'integer' },
              quantity: { type: 'integer' },
              price_type: { type: 'string', enum: ['flat', 'per_person'] },
              category: { type: 'string' },
            },
            required: ['name', 'unit_price_cents'],
          },
        },
      },
      required: ['contact_name', 'contact_email'],
    },
  },
  {
    name: 'propose_send_client_links',
    description:
      'PROPOSE sending a client links for their party by email and/or text, using the standard wording. Kinds: invite (their digital invitation), planner (edit the party), invoice, portal (their booking page). Nothing is sent until the manager clicks Confirm. Texts are refused outside 8am-9pm and to numbers that replied STOP.',
    input_schema: {
      type: 'object',
      properties: {
        booking_ref: { type: 'string' },
        links: { type: 'array', items: { type: 'string', enum: [...CLIENT_LINK_KINDS] } },
        email: { type: 'boolean' },
        sms: { type: 'boolean' },
      },
      required: ['booking_ref', 'links', 'email', 'sms'],
    },
  },
  {
    name: 'propose_pay_link',
    description:
      'PROPOSE creating a Stripe payment link for a party — the deposit or the remaining balance, computed from what has actually been paid. The link is shown to the manager; it is not sent to the client. Nothing is created until the manager clicks Confirm.',
    input_schema: {
      type: 'object',
      properties: {
        booking_ref: { type: 'string' },
        purpose: { type: 'string', enum: ['deposit', 'balance'] },
      },
      required: ['booking_ref', 'purpose'],
    },
  },
]

/* ── Small screens ────────────────────────────────────────────────────── */

function str(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

function money(cents: number | null | undefined): string {
  const n = Number(cents) || 0
  return `$${(n / 100).toFixed(2)}`
}

/**
 * A calendar date that EXISTS, in exactly `YYYY-MM-DD` — no truncation first,
 * because `'2026-13-45x'.slice(0, 10)` passes a shape check and is not a day.
 */
function isoDate(v: unknown): string | null | 'invalid' {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' || !ISO_DATE.test(v.trim())) return 'invalid'
  const s = v.trim()
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? s : 'invalid'
}

function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

function looksLikePhone(s: string): boolean {
  return s.replace(/\D/g, '').length >= 10 && /^[\d\s()+.-]+$/.test(s)
}

/**
 * Net paid per booking, from `booking_payments` — the same source and the same
 * `sumPayments` the Parties tab uses. `null` when the read failed: a stage
 * derived from "no payments" would call a paid party a lead.
 */
async function paidByBooking(supabase: Supa, ids: string[]): Promise<Map<string, number> | null> {
  const out = new Map<string, number>()
  if (ids.length === 0) return out
  const { data, error } = await supabase
    .from('booking_payments')
    .select('booking_id, amount_cents, payment_type')
    .in('booking_id', ids)
  if (error) return null
  const by = new Map<string, { amount_cents: number; payment_type: string }[]>()
  for (const p of (data ?? []) as { booking_id: string; amount_cents: number; payment_type: string }[]) {
    const list = by.get(p.booking_id) ?? []
    list.push(p)
    by.set(p.booking_id, list)
  }
  for (const id of ids) out.set(id, sumPayments(by.get(id)))
  return out
}

async function shapeParties(supabase: Supa, rows: Record<string, unknown>[], today: string) {
  const paid = await paidByBooking(supabase, rows.map(r => r.id as string).filter(Boolean))
  return rows.map(r => shapeParty(r, today, paid ? paid.get(r.id as string) ?? 0 : null))
}

function shapeParty(row: Record<string, unknown>, today: string, paidCents: number | null) {
  return {
    booking_ref: row.booking_ref,
    stage:
      paidCents === null
        ? 'unknown (payments could not be read)'
        : bookingStage({
            status: (row.status as string) ?? null,
            paidCents,
            partyDate: (row.party_date as string) ?? null,
            today,
          }),
    paid: paidCents === null ? null : money(paidCents),
    status: row.status,
    party_type: row.party_type,
    date: row.party_date,
    time: row.party_time,
    client: row.contact_name,
    child: row.child_name,
    guests: row.guest_count_approx,
    total: row.total_cents == null ? null : money(row.total_cents as number),
  }
}

async function readBookingByRef(supabase: Supa, ref: string) {
  return supabase
    .from('bookings')
    .select('id, booking_ref, status, contact_name, contact_email, contact_phone, child_name, event_type, party_type, party_date, total_cents')
    .eq('booking_ref', ref)
    .maybeSingle()
}

/* ── Executors ────────────────────────────────────────────────────────── */

export async function runAssistantTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const input = (rawInput && typeof rawInput === 'object' ? rawInput : {}) as Record<string, unknown>
  const supabase = ctx.supabase ?? getSupabase()
  const today = etToday(ctx.now)
  try {
    switch (name) {
      case 'find_client':
        return await findClient(supabase, input)
      case 'search_parties':
        return await searchParties(supabase, input, today)
      case 'get_party':
        return await getParty(supabase, input)
      case 'check_date':
        return await checkDate(supabase, input)
      case 'get_pricing':
        return await getPricing(supabase)
      case 'propose_create_party':
        return proposeCreateParty(input, ctx)
      case 'propose_send_client_links':
        return await proposeSendClientLinks(supabase, input, ctx)
      case 'propose_pay_link':
        return await proposePayLink(supabase, input, ctx)
      default:
        return { result: { error: `Unknown tool ${name}` }, isError: true }
    }
  } catch (err) {
    // A tool that throws must not take the conversation down with it; the
    // model is told plainly that the read failed so it does not guess.
    console.error(`assistant tool ${name} failed:`, err)
    return { result: { error: 'That lookup failed. Say so; do not guess the answer.' }, isError: true }
  }
}

const CONTACT_COLUMNS = 'id, first_name, last_name, email, phone, status, email_opt_in, sms_opt_in, created_at'

async function findClient(supabase: Supa, input: Record<string, unknown>): Promise<ToolOutcome> {
  const q = str(input.query, 120)
  if (!q) return { result: { error: 'query is required' }, isError: true }

  if (looksLikeEmail(q)) {
    const r = await findContactsByEmail(supabase, q, CONTACT_COLUMNS)
    if (r.kind === 'unavailable') return { result: { error: 'Contact lookup unavailable — say so.' }, isError: true }
    return { result: { matched_by: 'email', contacts: r.kind === 'found' ? r.contacts : [] } }
  }
  if (looksLikePhone(q)) {
    const r = await findContactsByPhone(supabase, q, CONTACT_COLUMNS)
    if (r.kind === 'unavailable') return { result: { error: 'Contact lookup unavailable — say so.' }, isError: true }
    return { result: { matched_by: 'phone', contacts: r.kind === 'found' ? r.contacts : [] } }
  }
  const { data, error } = await supabase
    .from('contacts')
    .select(CONTACT_COLUMNS)
    .or(contactSearchFilter(q))
    .order('created_at', { ascending: true })
    .limit(MAX_LIST + 1)
  if (error) return { result: { error: 'Contact lookup unavailable — say so.' }, isError: true }
  const rows = data ?? []
  return {
    result: { matched_by: 'name', contacts: rows.slice(0, MAX_LIST), more_than_shown: rows.length > MAX_LIST },
  }
}

async function searchParties(supabase: Supa, input: Record<string, unknown>, today: string): Promise<ToolOutcome> {
  const q = str(input.query, 120)
  const limit = Math.min(MAX_LIST, Math.max(1, Math.floor(Number(input.limit) || 10)))
  const includePast = input.include_past === true
  const includeCancelled = input.include_cancelled === true
  const from = isoDate(input.from_date)
  const to = isoDate(input.to_date)
  if (from === 'invalid' || to === 'invalid') {
    return { result: { error: 'Dates must be YYYY-MM-DD' }, isError: true }
  }

  // An email is never a filter here — it goes through the one lookup that
  // compares case-insensitively and exactly (lib/contactLookup.ts).
  if (q && looksLikeEmail(q)) {
    const r = await findBookingsByContactEmail(supabase, q, PARTY_COLUMNS, {
      excludeCancelled: !includeCancelled,
      limit: MAX_LIST,
    })
    if (r.kind === 'unavailable') return { result: { error: 'Booking lookup unavailable — say so.' }, isError: true }
    const rows = (r.kind === 'found' ? r.bookings : []) as unknown as Record<string, unknown>[]
    return { result: { parties: await shapeParties(supabase, rows.slice(0, limit), today) } }
  }

  let query = supabase.from('bookings').select(PARTY_COLUMNS)
  if (q) query = query.or(orIlikeFilter(['contact_name', 'child_name', 'booking_ref'], q))
  if (!includeCancelled) query = query.not('status', 'in', '(cancelled,lost)')
  const start = from ?? (includePast || q ? null : today)
  if (start) query = query.gte('party_date', start)
  if (to) query = query.lte('party_date', to)
  const { data, error } = await query
    .order('party_date', { ascending: !(includePast && !from), nullsFirst: false })
    .limit(limit + 1)
  if (error) return { result: { error: 'Booking lookup unavailable — say so.' }, isError: true }
  const rows = (data ?? []) as Record<string, unknown>[]
  return {
    result: {
      parties: await shapeParties(supabase, rows.slice(0, limit), today),
      more_than_shown: rows.length > limit,
    },
  }
}

async function getParty(supabase: Supa, input: Record<string, unknown>): Promise<ToolOutcome> {
  const ref = str(input.booking_ref, 40)
  if (!ref) return { result: { error: 'booking_ref is required' }, isError: true }
  const loaded = await loadPlanInvoice(ref, supabase)
  if (!loaded.ok) {
    return loaded.notFound
      ? { result: { error: `No party with ref ${ref}` }, isError: true }
      : { result: { error: 'Could not read that party — say so.' }, isError: true }
  }
  const inv = loaded.invoice
  const b = inv.booking
  return {
    result: {
      booking_ref: b.booking_ref,
      status: b.status,
      party_type: inv.partyType,
      date: b.party_date,
      time: b.party_time,
      client: { name: b.contact_name, email: b.contact_email, phone: b.contact_phone },
      child: b.child_name,
      child_age: b.child_age,
      guests: inv.guestCount ?? b.guest_count_approx,
      package: b.package_type,
      venue: inv.venueAddress,
      line_items: inv.lineItems.map(li => ({
        name: li.name,
        quantity: li.quantity,
        amount: money(li.amountCents),
        optional: li.isOptional,
      })),
      total: money(inv.totalCents),
      deposit: money(inv.depositCents),
      paid: money(inv.paidCents),
      outstanding: money(inv.outstandingCents),
      deposit_still_owed: money(inv.depositOwedCents),
      overpaid: inv.overpaidCents > 0 ? money(inv.overpaidCents) : null,
      internal_notes: b.notes,
    },
  }
}

async function checkDate(supabase: Supa, input: Record<string, unknown>): Promise<ToolOutcome> {
  const date = isoDate(input.date)
  if (!date || date === 'invalid') return { result: { error: 'date must be a real date, YYYY-MM-DD' }, isError: true }
  const [events, parties] = await Promise.all([
    getCalendarEvents(date.slice(0, 7)),
    supabase
      .from('bookings')
      .select(PARTY_COLUMNS)
      .eq('party_date', date)
      .not('status', 'in', '(cancelled,lost)')
      .order('party_time', { ascending: true }),
  ])
  if (parties.error) return { result: { error: 'Booking lookup unavailable — say so.' }, isError: true }
  const blocks = parseCalendarBlocks(events).get(date) ?? []
  const calendarConfigured = !!process.env.GOOGLE_CALENDAR_ID
  return {
    result: {
      date,
      calendar_configured: calendarConfigured,
      calendar_blocks: blocks,
      parties_on_this_date: await shapeParties(supabase, (parties.data ?? []) as Record<string, unknown>[], date),
      note: calendarConfigured
        ? undefined
        : 'The Google Calendar is not configured here, so only bookings were checked.',
    },
  }
}

async function getPricing(supabase: Supa): Promise<ToolOutcome> {
  const [catalog, themes, addOns] = await Promise.all([
    loadPricingCatalog(supabase),
    loadStudioThemes(),
    loadLineItemAddOns(supabase),
  ])
  const r = catalog.studioRates
  return {
    result: {
      from_live_db: catalog.fromDb,
      studio_theme_parties: themes.map(t => ({ name: t.name, price: money(t.price_cents) })),
      guest_rules: {
        included_guests: catalog.guestRules.includedGuests,
        extra_guest: money(catalog.guestRules.extraGuestCents),
        mini_party_discount: money(catalog.guestRules.miniPartyDiscountCents),
        mini_party_max_guests: catalog.guestRules.miniPartyMaxGuests,
      },
      studio_rental: {
        weekend_base: money(r.weekendBaseCents),
        weekday_base: money(r.weekdayBaseCents),
        weekend_additional_hour: money(r.weekendAddlHourCents),
        weekday_additional_hour: money(r.weekdayAddlHourCents),
        weekend_full_day: money(r.weekendFullDayCents),
        weekday_full_day: money(r.weekdayFullDayCents),
        min_hours: r.minHours,
        security_hold: money(r.securityDepositCents),
      },
      mobile_tiers: catalog.mobileTiers.map(t => ({
        name: t.name,
        price: `$${t.price}`,
        minutes: t.minutes,
        kids_included: t.kids,
      })),
      add_ons: addOns.map(a => ({ name: a.name, price: money(a.priceCents), per_guest: a.guestMultiplied })),
    },
  }
}

/* ── Proposals ────────────────────────────────────────────────────────── */

const MAX_ITEM_CENTS = 1_000_000

function proposeCreateParty(input: Record<string, unknown>, ctx: ToolContext): ToolOutcome {
  const contactName = str(input.contact_name, 120)
  const contactEmail = str(input.contact_email, 200)
  if (!contactName) return { result: { error: 'contact_name is required' }, isError: true }
  if (!contactEmail || !looksLikeEmail(contactEmail)) {
    return { result: { error: 'A valid contact_email is required — ask the manager for it.' }, isError: true }
  }
  const parsedDate = isoDate(input.party_date)
  if (parsedDate === 'invalid') return { result: { error: 'party_date must be a real date, YYYY-MM-DD' }, isError: true }
  const partyDate = parsedDate
  if (partyDate && partyDate < etToday(ctx.now)) {
    return { result: { error: `party_date ${partyDate} is in the past — confirm the date with the manager.` }, isError: true }
  }
  const partyTime = str(input.party_time, 5)
  if (partyTime && !HHMM.test(partyTime)) return { result: { error: 'party_time must be HH:mm (24-hour)' }, isError: true }
  const partyType = str(input.party_type, 40)
  if (partyType && !isPartyType(partyType)) {
    return { result: { error: `party_type must be one of ${PARTY_TYPES.join(', ')}` }, isError: true }
  }
  const guestRaw = input.guest_count
  const guestCount = guestRaw === undefined || guestRaw === null ? null : Math.floor(Number(guestRaw))
  if (guestCount !== null && !(guestCount >= 1 && guestCount <= 500)) {
    return { result: { error: 'guest_count must be between 1 and 500' }, isError: true }
  }

  const rawItems = Array.isArray(input.line_items) ? input.line_items.slice(0, 30) : []
  const lineItems: Record<string, unknown>[] = []
  for (const raw of rawItems) {
    const it = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const name = str(it.name, 120)
    const cents = Math.round(Number(it.unit_price_cents))
    const qty = it.quantity === undefined ? 1 : Math.floor(Number(it.quantity))
    const priceType = it.price_type === 'per_person' ? 'per_person' : 'flat'
    if (!name) return { result: { error: 'Every line item needs a name' }, isError: true }
    // Not negative: a discount is a deliberate act in the planner, not
    // something a chat transcript should be able to slip onto an invoice.
    if (!Number.isFinite(cents) || cents < 0 || cents > MAX_ITEM_CENTS) {
      return { result: { error: `Line item "${name}" needs a price between $0 and $10,000` }, isError: true }
    }
    if (!(qty >= 1 && qty <= 100)) return { result: { error: `Line item "${name}" quantity must be 1-100` }, isError: true }
    lineItems.push({
      name,
      category: str(it.category, 40) ?? 'package',
      quantity: qty,
      unit_price_cents: cents,
      price_type: priceType,
      guest_multiplied: priceType === 'per_person',
    })
  }

  const body: Record<string, unknown> = {
    contactName,
    contactEmail,
    contactPhone: str(input.contact_phone, 40) ?? undefined,
    childName: str(input.child_name, 80) ?? undefined,
    partyDate: partyDate ?? undefined,
    partyTime: partyTime ?? undefined,
    guestCount: guestCount ?? undefined,
    packageType: str(input.package_type, 120) ?? undefined,
    notes: str(input.notes, 2000) ?? undefined,
    partyType: partyType ?? undefined,
    eventType: partyType === 'studio_rental' ? 'studio-rental' : undefined,
    lineItems,
    // Creating a plan must never email the client by itself: an unpriced plan
    // mails "$0.00". Links go out through propose_send_client_links.
    sendEmail: false,
    source: 'admin',
  }

  // The one line-item arithmetic (lib/planBalance.ts), so the card shows what
  // the invoice will.
  const total = billedTotalCents(lineItems as unknown as BilledItem[], guestCount)
  const details = [
    `Client: ${contactName} <${contactEmail}>${body.contactPhone ? ` · ${body.contactPhone}` : ''}`,
    `Date: ${partyDate ?? 'not set'}${partyTime ? ` at ${partyTime}` : ''}`,
    `Guests: ${guestCount ?? 'not set'}${body.childName ? ` · Child: ${body.childName}` : ''}`,
    `Type: ${partyType ?? 'not set'}${body.packageType ? ` · ${body.packageType}` : ''}`,
    lineItems.length
      ? `Items: ${lineItems.map(li => `${li.name} ${money(li.unit_price_cents as number)}${li.price_type === 'per_person' ? '/guest' : ''}${(li.quantity as number) > 1 ? ` ×${li.quantity}` : ''}`).join('; ')} — about ${money(total)}`
      : 'Items: none yet (unpriced plan)',
    'No email is sent to the client.',
  ]
  const minted = mintProposal({
    kind: 'create_party',
    input: body,
    title: `Create party plan for ${contactName}`,
    details,
    actor: ctx.actor,
  })
  return {
    result: {
      status: 'awaiting_manager_confirmation',
      proposal_id: minted.proposal.id,
      shown_to_manager: details,
      instruction: 'Nothing has been created. Tell the manager to review the card and click Confirm.',
    },
    proposal: minted,
  }
}

async function proposeSendClientLinks(
  supabase: Supa,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const ref = str(input.booking_ref, 40)
  if (!ref) return { result: { error: 'booking_ref is required' }, isError: true }
  const kinds: ClientLinkKind[] = screenLinkKinds(input.links)
  if (kinds.length === 0) return { result: { error: `links must include at least one of ${CLIENT_LINK_KINDS.join(', ')}` }, isError: true }
  const email = input.email === true
  const sms = input.sms === true
  if (!email && !sms) return { result: { error: 'Choose email, sms, or both' }, isError: true }

  const { data: b, error } = await readBookingByRef(supabase, ref)
  if (error) return { result: { error: 'Could not read that party — say so.' }, isError: true }
  if (!b) return { result: { error: `No party with ref ${ref}` }, isError: true }
  if (b.status === 'cancelled' || b.status === 'lost') {
    return { result: { error: `That booking is ${b.status}; nothing can be sent.` }, isError: true }
  }
  if (email && !b.contact_email) return { result: { error: 'No email on that booking.' }, isError: true }
  if (sms && !b.contact_phone) return { result: { error: 'No phone on that booking.' }, isError: true }

  const labels = kinds.map(k => clientLinkLabel(k, b))
  const via = [email && `email to ${b.contact_email}`, sms && `text to ${b.contact_phone}`].filter(Boolean).join(' and ')
  const details = [
    `Party: ${b.booking_ref} — ${b.contact_name ?? 'client'}${b.party_date ? ` on ${b.party_date}` : ''}`,
    `Links: ${labels.join(', ')}`,
    `Send by ${via}, using the standard wording.`,
    ...(sms ? ['Texts are refused outside 8am–9pm and to numbers that replied STOP.'] : []),
  ]
  const minted = mintProposal({
    kind: 'send_client_links',
    input: { bookingId: b.id, bookingRef: b.booking_ref, links: kinds, email, sms },
    title: `Send ${labels.join(' + ')} to ${b.contact_name ?? b.booking_ref}`,
    details,
    actor: ctx.actor,
  })
  return {
    result: {
      status: 'awaiting_manager_confirmation',
      proposal_id: minted.proposal.id,
      shown_to_manager: details,
      instruction: 'Nothing has been sent. Tell the manager to review the card and click Confirm.',
    },
    proposal: minted,
  }
}

async function proposePayLink(supabase: Supa, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const ref = str(input.booking_ref, 40)
  const purpose = input.purpose === 'deposit' || input.purpose === 'balance' ? input.purpose : null
  if (!ref) return { result: { error: 'booking_ref is required' }, isError: true }
  if (!purpose) return { result: { error: 'purpose must be deposit or balance' }, isError: true }

  const loaded = await loadPlanInvoice(ref, supabase)
  if (!loaded.ok) {
    return loaded.notFound
      ? { result: { error: `No party with ref ${ref}` }, isError: true }
      : { result: { error: 'Could not read that party — say so.' }, isError: true }
  }
  const inv = loaded.invoice
  const owed = purpose === 'deposit' ? inv.depositOwedCents : inv.outstandingCents
  if (!(owed > 0)) {
    return {
      result: { error: `Nothing is owed for the ${purpose} on ${ref} (paid ${money(inv.paidCents)} of ${money(inv.totalCents)}).` },
      isError: true,
    }
  }
  const details = [
    `Party: ${inv.booking.booking_ref} — ${inv.booking.contact_name ?? 'client'}`,
    `${purpose === 'deposit' ? 'Deposit' : 'Balance'}: about ${money(owed)} (total ${money(inv.totalCents)}, paid ${money(inv.paidCents)}). The exact figure, and any card fee, is computed when the link is made.`,
    'The link is shown to you here; it is not sent to the client.',
  ]
  const minted = mintProposal({
    kind: 'create_pay_link',
    input: { bookingRef: inv.booking.booking_ref, purpose },
    title: `Make a ${purpose} payment link for ${inv.booking.booking_ref}`,
    details,
    actor: ctx.actor,
  })
  return {
    result: {
      status: 'awaiting_manager_confirmation',
      proposal_id: minted.proposal.id,
      shown_to_manager: details,
      instruction: 'Nothing has been created. Tell the manager to review the card and click Confirm.',
    },
    proposal: minted,
  }
}
