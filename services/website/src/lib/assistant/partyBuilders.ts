import type Anthropic from '@anthropic-ai/sdk'
import type { getSupabase } from '@/lib/supabase'
import { etToday } from '@/lib/bookingStatus'
import { billedTotalCents, type BilledItem } from '@/lib/planBalance'
import { loadPricingCatalog } from '@/lib/pricingCatalog'
import { loadQuoteCatalog, matchByName, MAX_QUOTE_GUESTS } from '@/lib/quoteRequest'
import { computeQuote, type QuoteSelection } from '@/lib/quoteEngine'
import { getDepositCents } from '@/lib/partyPricing'
import { hoursBetween, STUDIO_STANDING_CAPACITY, studioRentalRateWith } from '@/lib/studioRental'
import { travelFeeForAddress } from '@/lib/mileage'
import { shiftEtDate } from '@/lib/partyTime'
import type { PricingItem } from '@/components/QuoteBuilder/types'
import { mintProposal } from './proposals'
import { dollars } from './dollars'
import { clock12 } from './timeFormat'
import type { ToolContext, ToolOutcome } from './tools'

/**
 * Two party builders for the Manager assistant, one card each:
 *
 *   propose_create_mobile_party  - we go to the family. Activities, an ADDRESS,
 *                                  sometimes add-ons and desserts.
 *   propose_create_studio_rental - the room by the hour, at its defined rates.
 *
 * The model supplies WORDS (names, a date, a window, a head count) and never a
 * price. Every figure on a card comes from the live catalog: the mobile package
 * and its per-person activities from lib/quoteEngine.ts, the travel fee from the
 * address (lib/mileage.ts), the rental fee from the studio rate card
 * (lib/studioRental.ts), add-ons from the same menu the public pages sell from.
 * A name that matches nothing, or matches several, is REFUSED - the card is never
 * drawn around a guess.
 *
 * Nothing here writes. The card is a signed proposal; Confirm replays
 * `/api/admin/parties/create` (execute.ts), which sends the client nothing.
 */

type Supa = ReturnType<typeof getSupabase>

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_ADDON_QTY = 50

const named = { type: 'object', properties: { name: { type: 'string' }, quantity: { type: 'integer', description: '1-50. Default 1.' } }, required: ['name'] }

export const BUILDER_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'propose_create_mobile_party',
    description:
      'PROPOSE a new MOBILE party (we travel to the family). It has its own card. Needs the client (name + email), the date, the head count and the party ADDRESS. Mobile parties are mostly activities; add-ons and desserts are occasional. You give NAMES only: activities (e.g. "slime making"), add_ons (entertainment / party extras) and desserts, exactly as in get_pricing / get_quote. The server prices everything from the live catalog, adds the travel fee from the address, and refuses any name that does not match. Nothing is created until the manager clicks Confirm; no email or text goes to the client. For a party AT the studio use propose_create_party; for the room by the hour use propose_create_studio_rental.',
    input_schema: {
      type: 'object',
      properties: {
        contact_name: { type: 'string' },
        contact_email: { type: 'string' },
        contact_phone: { type: 'string' },
        child_name: { type: 'string' },
        party_date: { type: 'string', description: 'YYYY-MM-DD' },
        party_time: { type: 'string', description: 'HH:mm, 24-hour start time' },
        guest_count: { type: 'integer', description: `Kids, 1-${MAX_QUOTE_GUESTS}.` },
        address: { type: 'string', description: 'Where the party is: street, town and state. Required.' },
        activities: { type: 'array', items: { type: 'string' } },
        add_ons: { type: 'array', items: { type: 'string' }, description: 'Entertainment and party extras by name.' },
        desserts: { type: 'array', items: { type: 'string' }, description: 'Desserts by name.' },
        notes: { type: 'string', description: 'Internal admin notes. Never shown to the client.' },
      },
      required: ['contact_name', 'contact_email', 'party_date', 'guest_count', 'address'],
    },
  },
  {
    name: 'propose_create_studio_rental',
    description:
      `PROPOSE a new STUDIO RENTAL (the whole room by the hour, for a family event). It has its own card. Needs the client (name + email), what the event is (event_label, e.g. "Baby shower"), the date, the start and end time of the WHOLE window (setup and cleanup included) and the head count (up to ${STUDIO_STANDING_CAPACITY}). The server prices the window from the studio rate card (weekend or weekday, 3-hour minimum), adds any add-ons you name from the studio menu (decor, services, food, desserts, beverages) and shows the booking deposit and the refundable security hold. You give words and times, never prices; a name that does not match is refused. Nothing is created until the manager clicks Confirm; nothing is sent to the client.`,
    input_schema: {
      type: 'object',
      properties: {
        contact_name: { type: 'string' },
        contact_email: { type: 'string' },
        contact_phone: { type: 'string' },
        event_label: { type: 'string', description: 'What the event is, e.g. "Baby shower", "Graduation party".' },
        party_date: { type: 'string', description: 'YYYY-MM-DD' },
        start_time: { type: 'string', description: 'HH:mm, 24-hour' },
        end_time: { type: 'string', description: 'HH:mm, 24-hour, same day' },
        guest_count: { type: 'integer' },
        seating_needed: { type: 'integer', description: 'How many seats, if they said.' },
        client_address: { type: 'string', description: "The client's own address, if given." },
        add_ons: { type: 'array', items: named, description: 'Studio menu items by name, optional quantity.' },
        notes: { type: 'string', description: 'Internal admin notes. Never shown to the client.' },
      },
      required: ['contact_name', 'contact_email', 'event_label', 'party_date', 'start_time', 'end_time', 'guest_count'],
    },
  },
]

const NAMES = new Set(BUILDER_TOOLS.map(t => t.name))
export const isBuilderTool = (name: string) => NAMES.has(name)

export async function runBuilderTool(name: string, input: Record<string, unknown>, ctx: ToolContext & { supabase: Supa }): Promise<ToolOutcome> {
  if (name === 'propose_create_mobile_party') return proposeMobileParty(input, ctx)
  if (name === 'propose_create_studio_rental') return proposeStudioRental(input, ctx)
  return { result: { error: `Unknown tool: ${name}` }, isError: true }
}

/* ── shared bits ─────────────────────────────────────────────────────────── */

const fail = (error: string): ToolOutcome => ({ result: { error }, isError: true })
const text = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

function dayLabel(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function realDate(v: unknown): string | null {
  if (typeof v !== 'string' || !ISO_DATE.test(v.trim())) return null
  const s = v.trim()
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? s : null
}

interface Client { contactName: string; contactEmail: string; contactPhone: string | null }

function readClient(input: Record<string, unknown>): { ok: true; client: Client } | { ok: false; out: ToolOutcome } {
  const contactName = text(input.contact_name, 120)
  const contactEmail = text(input.contact_email, 200)
  if (!contactName) return { ok: false, out: fail('contact_name is required') }
  if (!contactEmail || !looksLikeEmail(contactEmail)) return { ok: false, out: fail('A valid contact_email is required - ask the manager for it.') }
  return { ok: true, client: { contactName, contactEmail, contactPhone: text(input.contact_phone, 40) } }
}

function readDate(input: Record<string, unknown>, ctx: ToolContext): { ok: true; date: string } | { ok: false; out: ToolOutcome } {
  const date = realDate(input.party_date)
  if (!date) return { ok: false, out: fail('party_date must be a real date, YYYY-MM-DD') }
  if (date < etToday(ctx.now)) return { ok: false, out: fail(`party_date ${date} is in the past - confirm the date with the manager.`) }
  return { ok: true, date }
}

/** Who else is already on that date. A read; if it fails the card says so rather than staying quiet. */
async function sameDayLine(sb: Supa, date: string): Promise<string> {
  const { data, error } = await sb
    .from('bookings')
    .select('booking_ref, party_type, party_time, status')
    .eq('party_date', date)
    .not('status', 'in', '(cancelled,lost)')
    .order('party_time', { ascending: true })
  if (error) return 'Same day: could not check the bookings - use check_date before confirming.'
  const rows = (data ?? []) as Array<{ booking_ref: string; party_type: string | null; party_time: string | null }>
  if (rows.length === 0) return 'Same day: nothing else is booked.'
  const shown = rows.slice(0, 4).map(r => `${r.booking_ref}${r.party_time ? ` ${clock12(r.party_time)}` : ''}`).join(', ')
  return `Same day: ${rows.length} other ${rows.length === 1 ? 'booking' : 'bookings'} (${shown}${rows.length > 4 ? ', ...' : ''}) - check the times don't clash.`
}

type Wanted = { name: string; quantity: number }

function wantedList(v: unknown): Wanted[] | null {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) return null
  const out: Wanted[] = []
  for (const raw of v.slice(0, 20)) {
    const name = typeof raw === 'string' ? text(raw, 80) : text((raw as { name?: unknown } | null)?.name, 80)
    if (!name) continue
    const q = typeof raw === 'object' && raw ? Math.floor(Number((raw as { quantity?: unknown }).quantity ?? 1)) : 1
    if (!(q >= 1 && q <= MAX_ADDON_QTY)) return null
    out.push({ name, quantity: q })
  }
  return out
}

/** Resolve names against a menu. Any miss or ambiguity is a refusal that names it, never an approximation. */
function resolveAll(wanted: Wanted[], menu: PricingItem[], what: string): { ok: true; items: Array<{ item: PricingItem; quantity: number }> } | { ok: false; out: ToolOutcome } {
  const items: Array<{ item: PricingItem; quantity: number }> = []
  for (const w of wanted) {
    const m = matchByName(menu, w.name)
    if (m.kind === 'one') {
      const existing = items.find(i => i.item.id === m.item.id)
      if (existing) existing.quantity += w.quantity
      else items.push({ item: m.item, quantity: w.quantity })
    } else if (m.kind === 'ambiguous') {
      return { ok: false, out: fail(`"${w.name}" matches more than one ${what}: ${m.names.join(', ')}. Ask which one - do not pick.`) }
    } else {
      return { ok: false, out: fail(`No ${what} named "${w.name}". Check get_pricing for the names and ask the manager - do not approximate.`) }
    }
  }
  return { ok: true, items }
}

const perGuest = (i: PricingItem) => i.price_type === 'per_person'

function done(kind: 'create_mobile_party' | 'create_studio_rental', body: Record<string, unknown>, title: string, details: string[], ctx: ToolContext): ToolOutcome {
  const minted = mintProposal({ kind, input: body, title, details, actor: ctx.actor })
  return {
    result: {
      status: 'awaiting_manager_confirmation',
      proposal_id: minted.proposal.id,
      shown_to_manager: details,
      instruction: 'Nothing has been created. Tell the manager to review the card and click Confirm. The card shows every figure; do not restate prices that are not on it.',
    },
    proposal: minted,
  }
}

/* ── mobile party ────────────────────────────────────────────────────────── */

async function proposeMobileParty(input: Record<string, unknown>, ctx: ToolContext & { supabase: Supa }): Promise<ToolOutcome> {
  const sb = ctx.supabase
  const c = readClient(input)
  if (!c.ok) return c.out
  const d = readDate(input, ctx)
  if (!d.ok) return d.out
  const partyTime = text(input.party_time, 5)
  if (partyTime && !HHMM.test(partyTime)) return fail('party_time must be HH:mm (24-hour)')
  const guests = Math.floor(Number(input.guest_count))
  if (!(guests >= 1 && guests <= MAX_QUOTE_GUESTS)) return fail(`guest_count must be a whole number from 1 to ${MAX_QUOTE_GUESTS}`)
  const address = text(input.address, 300)
  if (!address || address.length < 8) return fail('A mobile party needs the party address (street, town, state) - ask the manager for it.')

  const activities = wantedList(input.activities)
  const addOns = wantedList(input.add_ons)
  const desserts = wantedList(input.desserts)
  if (!activities || !addOns || !desserts) return fail('activities, add_ons and desserts must be lists of names')

  const loaded = await loadQuoteCatalog(sb)
  if (loaded.kind !== 'ok') return fail('The price list could not be read - say so; do not guess a price.')
  const { cat, groups, items } = loaded.data

  const acts = resolveAll(activities, [...groups.premiumActivities, ...groups.standardActivities], 'activity')
  if (!acts.ok) return acts.out
  const ons = resolveAll(addOns, [...groups.entertainment, ...groups.partyAddOns], 'mobile add-on')
  if (!ons.ok) return ons.out
  const des = resolveAll(desserts, groups.desserts, 'dessert')
  if (!des.ok) return des.out

  const fee = await travelFeeForAddress(address).catch(() => ({ kind: 'geocode_failed' as const }))
  const sel: QuoteSelection = {
    locationType: 'mobile',
    guestCount: guests,
    isMiniParty: false,
    themeId: null,
    activityIds: acts.items.map(a => a.item.id),
    foodIds: [],
    dessertIds: [],
    beverageIds: [],
    decorIds: [],
    entertainmentIds: ons.items.filter(o => groups.entertainment.some(e => e.id === o.item.id)).map(o => o.item.id),
    partyAddOnIds: ons.items.filter(o => groups.partyAddOns.some(e => e.id === o.item.id)).map(o => o.item.id),
    travelFeeCents: fee.kind === 'ok' ? fee.feeCents : 0,
  }
  const quote = computeQuote(cat, items, sel)
  const eff = quote.effectiveGuestCount

  // Mobile mode hides desserts in the engine, so they are added as their own priced lines.
  const dessertLines = des.items.map(({ item, quantity }) => ({
    name: item.name, category: 'dessert-add-on', quantity, unit_price_cents: item.price_cents,
    price_type: perGuest(item) ? 'per_person' : 'flat', guest_multiplied: perGuest(item), pricing_item_id: item.id,
  }))
  const lineItems = [...quote.lineItems, ...dessertLines]
  const total = billedTotalCents(lineItems as unknown as BilledItem[], guests)
  const deposit = getDepositCents(total, 'mobile_party')

  const packageLine = quote.lineItems.find(l => l.category === 'mobile-package')
  const activityLines = quote.lineItems.filter(l => l.category === 'activity-add-on')
  const extraLines = quote.lineItems.filter(l => l.category === 'entertainment-add-on' || l.category === 'extra')
  const money = (l: { unit_price_cents: number; quantity: number; guest_multiplied: boolean }) =>
    dollars(billedTotalCents([l as unknown as BilledItem], guests))

  const travel =
    fee.kind === 'ok'
      ? fee.feeCents > 0 ? `${dollars(fee.feeCents)} travel (beyond the free 20 miles) - already in the package price` : 'No travel fee (inside the free 20 miles)'
      : 'Travel fee NOT included - the address could not be located. Add it by hand once the address is confirmed'

  const details = [
    `Client: ${c.client.contactName} <${c.client.contactEmail}>${c.client.contactPhone ? ` · ${c.client.contactPhone}` : ''}`,
    `When: ${dayLabel(d.date)}${partyTime ? ` · ${clock12(partyTime)}` : ' · time not set'}`,
    `Where: ${fee.kind === 'ok' ? fee.resolvedAddress : address}`,
    `Guests: ${guests}${text(input.child_name, 80) ? ` · Child: ${text(input.child_name, 80)}` : ''}${eff !== guests ? ` (priced for ${eff})` : ''}`,
    `Package: ${packageLine ? `${packageLine.name} (${money(packageLine)})` : 'none'}`,
    `Travel: ${travel}`,
    `Activities: ${activityLines.length ? activityLines.map(l => `${l.name} (${money(l)})`).join('; ') : 'none'}`,
    `Add-ons: ${extraLines.length ? extraLines.map(l => `${l.name} (${money(l)})`).join('; ') : 'none'}`,
    `Desserts: ${dessertLines.length ? dessertLines.map(l => `${l.name}${l.quantity > 1 ? ` ×${l.quantity}` : ''} (${money(l)})`).join('; ') : 'none'}`,
    `Total: ${dollars(total)}`,
    `Deposit to book: ${dollars(deposit)}`,
    await sameDayLine(sb, d.date),
    cat.mobilePolicy.minGuests > guests ? `Heads up: under the ${cat.mobilePolicy.minGuests}-guest minimum for mobile parties.` : 'Priced from the live catalog. No email or text goes to the client.',
  ]

  const body: Record<string, unknown> = {
    contactName: c.client.contactName,
    contactEmail: c.client.contactEmail,
    contactPhone: c.client.contactPhone ?? undefined,
    childName: text(input.child_name, 80) ?? undefined,
    partyDate: d.date,
    partyTime: partyTime ?? undefined,
    guestCount: guests,
    packageType: 'Mobile Party',
    partyType: 'mobile_party',
    locationAddress: address,
    notes: text(input.notes, 2000) ?? undefined,
    lineItems,
    sendEmail: false,
    source: 'admin',
  }
  return done('create_mobile_party', body, `Mobile party for ${c.client.contactName}`, details, ctx)
}

/* ── studio rental ───────────────────────────────────────────────────────── */

async function proposeStudioRental(input: Record<string, unknown>, ctx: ToolContext & { supabase: Supa }): Promise<ToolOutcome> {
  const sb = ctx.supabase
  const c = readClient(input)
  if (!c.ok) return c.out
  const d = readDate(input, ctx)
  if (!d.ok) return d.out
  const eventLabel = text(input.event_label, 80)
  if (!eventLabel) return fail('event_label is required - what is the event? (e.g. "Baby shower")')
  const start = text(input.start_time, 5)
  const end = text(input.end_time, 5)
  if (!start || !end || !HHMM.test(start) || !HHMM.test(end)) return fail('start_time and end_time must be HH:mm (24-hour)')
  if (end <= start) return fail('end_time must be after start_time on the same day')
  const guests = Math.floor(Number(input.guest_count))
  if (!(guests >= 1)) return fail('guest_count must be a whole number')
  if (guests > STUDIO_STANDING_CAPACITY) return fail(`The studio holds up to ${STUDIO_STANDING_CAPACITY} guests; tell the manager this is over capacity.`)
  const seatingRaw = input.seating_needed
  const seating = seatingRaw === undefined || seatingRaw === null ? null : Math.floor(Number(seatingRaw))
  if (seating !== null && !(seating >= 0 && seating <= 500)) return fail('seating_needed must be a small whole number')

  const wanted = wantedList(input.add_ons)
  if (!wanted) return fail('add_ons must be a list of { name, quantity }')

  const menuRes = await sb
    .from('pricing_items')
    .select('id, name, description, category, price_cents, price_label, price_type, is_popular, sort_order, emoji')
    .eq('is_active', true)
    .contains('event_types', ['studio-rental'])
    .order('sort_order', { ascending: true })
  if (menuRes.error) return fail('The studio add-on menu could not be read - say so; do not guess a price.')
  const menu = (menuRes.data ?? []) as PricingItem[]
  const picked = resolveAll(wanted, menu, 'studio add-on')
  if (!picked.ok) return picked.out

  const { studioRates } = await loadPricingCatalog(sb)
  const hours = hoursBetween(start, end)
  const rate = studioRentalRateWith(studioRates, d.date, hours)

  const lineItems = [
    { pricing_item_id: null, name: rate.lineItemLabel, category: 'rental', quantity: 1, unit_price_cents: rate.rentalCents, price_type: 'flat', guest_multiplied: false },
    ...picked.items.map(({ item, quantity }) => ({
      pricing_item_id: item.id, name: item.name, category: item.category, quantity, unit_price_cents: item.price_cents,
      price_type: perGuest(item) ? 'per_person' : 'flat', guest_multiplied: perGuest(item),
    })),
  ]
  const total = billedTotalCents(lineItems as unknown as BilledItem[], guests)
  const deposit = getDepositCents(total, 'studio_rental')
  const balanceDue = shiftEtDate(d.date, -7)
  const addOnLines = lineItems.slice(1)
  const lineMoney = (l: (typeof lineItems)[number]) => dollars(billedTotalCents([l as unknown as BilledItem], guests))

  const details = [
    `Client: ${c.client.contactName} <${c.client.contactEmail}>${c.client.contactPhone ? ` · ${c.client.contactPhone}` : ''}`,
    `Event: ${eventLabel}`,
    `When: ${dayLabel(d.date)} · ${clock12(start)} to ${clock12(end)}`,
    `Window: ${rate.hours} hr${rate.hours === 1 ? '' : 's'} (${rate.isWeekend ? 'weekend' : 'weekday'} rate${rate.hours > hours ? `, ${studioRates.minHours}-hour minimum` : ''}) - setup and cleanup are inside it`,
    `Guests: ${guests}${seating ? ` · Seating: ${seating}` : ''}`,
    `Rental fee: ${rate.lineItemLabel} (${dollars(rate.rentalCents)})`,
    `Add-ons: ${addOnLines.length ? addOnLines.map(l => `${l.name}${l.quantity > 1 ? ` ×${l.quantity}` : ''} (${lineMoney(l)}${l.guest_multiplied ? `, ${dollars(l.unit_price_cents)}/guest` : ''})`).join('; ') : 'none'}`,
    `Total: ${dollars(total)}`,
    `Deposit to book: ${dollars(deposit)}`,
    `Security hold: ${dollars(studioRates.securityDepositCents)} refundable card hold before the event (not part of the total)`,
    `Balance due: ${balanceDue ? dayLabel(balanceDue) : '7 days before'}`,
    await sameDayLine(sb, d.date),
    'Priced from the live studio rates. The rental agreement is sent separately. No email or text goes to the client.',
  ]

  const body: Record<string, unknown> = {
    contactName: c.client.contactName,
    contactEmail: c.client.contactEmail,
    contactPhone: c.client.contactPhone ?? undefined,
    partyDate: d.date,
    partyTime: start,
    guestCount: guests,
    packageType: rate.lineItemLabel,
    partyType: 'studio_rental',
    eventType: 'studio-rental',
    notes: text(input.notes, 2000) ?? undefined,
    lineItems,
    partyTagsExtra: {
      rental_start_time: start,
      rental_end_time: end,
      rental_hours: rate.hours,
      is_weekend: rate.isWeekend,
      event_label: eventLabel,
      ...(text(input.client_address, 200) ? { address: text(input.client_address, 200) } : {}),
      ...(seating !== null ? { seating_needed: seating } : {}),
      ...(balanceDue ? { balance_due_date: balanceDue } : {}),
      security_deposit_cents: studioRates.securityDepositCents,
    },
    sendEmail: false,
    source: 'admin',
  }
  return done('create_studio_rental', body, `Studio rental for ${c.client.contactName}`, details, ctx)
}
