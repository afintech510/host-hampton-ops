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
import { ADMIN_PAYMENT_METHODS, PAYMENT_TYPES } from '@/lib/adminMoney'
import { findPhotos, MAX_PHOTOS_PER_REQUEST } from '@/lib/media'
import { ACTIVITY_TAGS, THEME_TAGS } from '@/lib/mediaVocab'
import { loadQuoteCatalog, quoteFromCatalog, MAX_QUOTE_GUESTS } from '@/lib/quoteRequest'
import { mintProposal, type Proposal, type ProposalPhoto } from './proposals'
import { LEAD_TOOLS, isLeadTool, runLeadTool } from './leadTools'
import { buildEnrolCard } from './nurture'
import { maskEmail } from './outboundText'
import { buildClientLinksCard, buildPhotosCard, type BuiltCard, type MessageEdits, type MessagePreview } from './messageCard'

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
  /** For a message card: the exact wording, recipient, segments and send status. Display only. */
  preview?: MessagePreview
  /** The pending card this one replaces (a reworded message). The chat route retires it. */
  supersedes?: string
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
      'PROPOSE sending a client links for their party by email and/or text. The card shows the manager the exact message. Kinds: invite (their digital invitation), planner (edit the party), invoice, portal (their booking page). Omit the sms_body / email_* fields for the standard wording. To REWORD ("shorter", "mention the glow theme", "no emoji") call this again with the same booking, links and channels, the full revised text in sms_body and/or email_subject + email_body, and replaces_proposal_id set to the proposal_id of the card being replaced; write each link as a placeholder ({invite} {rsvps} {planner} {invoice} {portal}) exactly as in the message_preview you were given, never as a real URL. Keep the text signed by the studio sign-off and keep the "Reply STOP to opt out" line in texts. Never put a price, a discount, a phone number, an email address or any other website in it. Nothing is sent until the manager clicks Confirm. Texts are refused outside 8am-9pm and to numbers that replied STOP.',
    input_schema: {
      type: 'object',
      properties: {
        booking_ref: { type: 'string' },
        links: { type: 'array', items: { type: 'string', enum: [...CLIENT_LINK_KINDS] } },
        email: { type: 'boolean' },
        sms: { type: 'boolean' },
        sms_body: { type: 'string', description: 'Revised text message, with {placeholders} for links. Only when rewording.' },
        email_subject: { type: 'string', description: 'Revised email subject. Only when rewording.' },
        email_body: { type: 'string', description: 'Revised email body, with {placeholders} for links. Only when rewording.' },
        replaces_proposal_id: { type: 'string', description: 'proposal_id of the pending card this one replaces.' },
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
  {
    name: 'get_quote',
    description:
      'Price a party from the live catalog. You supply WORDS (a theme name, activity names, add-on names) and a guest count; the server does the arithmetic and returns the total and the line items. Names that match nothing are listed as not_found and are NOT in the total. Never quote a number that did not come from here, get_pricing or get_party.',
    input_schema: {
      type: 'object',
      properties: {
        party_type: { type: 'string', enum: ['studio', 'mobile'] },
        guests: { type: 'integer', description: `1-${MAX_QUOTE_GUESTS}` },
        theme: { type: 'string', description: 'Studio only: the theme name, e.g. "Slime Party".' },
        activities: { type: 'array', items: { type: 'string' } },
        add_ons: { type: 'array', items: { type: 'string' } },
        mini_party: { type: 'boolean', description: 'Studio mini party (small group).' },
      },
      required: ['party_type', 'guests'],
    },
  },
  {
    name: 'find_photos',
    description:
      `Find real party photos from the photo library. Only photos a human approved and that show no identifiable child are ever returned. Filter by party_type (in_studio_theme, mobile_party, public_event), theme (one of: ${THEME_TAGS.join(', ')}) and/or activity (one of: ${Object.keys(ACTIVITY_TAGS).join(', ')}). Returns id, url and alt for each, plus "text_lines": one "description: link" line per photo that the manager can paste into a text to a client. Show those lines as they are, and say plainly when nothing matches (then try fewer filters, e.g. party_type alone). To have the system send them to a booking's contact, pass the ids to propose_send_photos.`,
    input_schema: {
      type: 'object',
      properties: {
        party_type: { type: 'string' },
        theme: { type: 'string' },
        activity: { type: 'string' },
        limit: { type: 'integer', description: `1-${MAX_PHOTOS_PER_REQUEST}. Default 6.` },
      },
    },
  },
  {
    name: 'propose_update_party',
    description:
      "PROPOSE changing a party's details: date, time, guest count, child name/age, package, the client's contact details, party type, or the internal admin note. Cannot change status or money (use propose_cancel / propose_mark_lost / propose_record_payment, and line items for price). Nothing changes until the manager clicks Confirm. Check the date with check_date first when moving it.",
    input_schema: {
      type: 'object',
      properties: {
        booking_ref: { type: 'string' },
        party_date: { type: 'string', description: 'YYYY-MM-DD' },
        party_time: { type: 'string', description: 'HH:mm, 24-hour' },
        guest_count: { type: 'integer' },
        child_name: { type: 'string' },
        child_age: { type: 'integer' },
        package_type: { type: 'string' },
        contact_name: { type: 'string' },
        contact_email: { type: 'string' },
        contact_phone: { type: 'string' },
        party_type: { type: 'string', enum: [...PARTY_TYPES] },
        admin_notes: { type: 'string', description: 'Internal note. Never shown to the client.' },
      },
      required: ['booking_ref'],
    },
  },
  {
    name: 'propose_add_line_item',
    description:
      'PROPOSE adding a line item (add-on, decor, extra) to a party\'s invoice. Preferred: set add_on to a catalog add-on name and the server uses the catalog price. Otherwise give name + unit_price_cents ONLY if the manager stated that price. Discounts are not added from chat. Nothing changes until the manager clicks Confirm; the invoice total is recalculated when it does.',
    input_schema: {
      type: 'object',
      properties: {
        booking_ref: { type: 'string' },
        add_on: { type: 'string', description: 'Exact catalog add-on name, e.g. "Balloon Garland". Price comes from the catalog.' },
        name: { type: 'string', description: 'Custom item name (when it is not in the catalog).' },
        unit_price_cents: { type: 'integer', description: 'Custom item price in cents, as stated by the manager.' },
        quantity: { type: 'integer' },
        per_guest: { type: 'boolean', description: 'Custom item is priced per guest.' },
        category: { type: 'string' },
      },
      required: ['booking_ref'],
    },
  },
  {
    name: 'propose_remove_line_item',
    description:
      "PROPOSE removing a line item from a party's invoice, by its name as shown by get_party. Nothing changes until the manager clicks Confirm; the invoice total is recalculated when it does.",
    input_schema: {
      type: 'object',
      properties: {
        booking_ref: { type: 'string' },
        line_item_name: { type: 'string' },
        line_item_id: { type: 'string', description: 'Only when two lines share a name and a previous call listed candidates.' },
      },
      required: ['booking_ref'],
    },
  },
  {
    name: 'propose_record_payment',
    description:
      'PROPOSE writing down a payment that arrived outside Stripe (cash, Venmo, Zelle, check) against a party. It records money in the books and moves the balance; it takes no money and by default emails the client nothing. Use the amount and method the manager stated; never guess either. Nothing is recorded until the manager clicks Confirm.',
    input_schema: {
      type: 'object',
      properties: {
        booking_ref: { type: 'string' },
        amount_cents: { type: 'integer', description: 'Whole cents, e.g. 25000 for $250.' },
        payment_method: { type: 'string', enum: [...ADMIN_PAYMENT_METHODS] },
        payment_type: { type: 'string', enum: [...PAYMENT_TYPES.filter(t => t !== 'refund')], description: 'Default partial.' },
        notes: { type: 'string' },
        send_receipt: { type: 'boolean', description: 'Email the client a receipt. Default FALSE; only true if the manager asked.' },
      },
      required: ['booking_ref', 'amount_cents', 'payment_method'],
    },
  },
  {
    name: 'propose_cancel',
    description:
      'PROPOSE cancelling a party. It frees the date and stops reminders; it does NOT refund anything and sends the client nothing. Nothing happens until the manager clicks Confirm. For a lead that never booked and paid nothing, prefer propose_mark_lost.',
    input_schema: {
      type: 'object',
      properties: { booking_ref: { type: 'string' } },
      required: ['booking_ref'],
    },
  },
  {
    name: 'propose_mark_lost',
    description:
      'PROPOSE marking a lead as lost (they said no). Only for a party with nothing paid; it sends the client nothing. Nothing happens until the manager clicks Confirm.',
    input_schema: {
      type: 'object',
      properties: { booking_ref: { type: 'string' } },
      required: ['booking_ref'],
    },
  },
  {
    name: 'propose_send_photos',
    description:
      'PROPOSE sending a client real party photos from the library, by email (photos inline) and/or a text that carries a LINK to a photo page (never a picture message). Choose the photos with photo_ids from find_photos, or with a party_type / theme / activity filter (the server finds them and the card shows thumbnails). Texts are refused outside 8am-9pm and to numbers that replied STOP. The card shows the exact text; to reword it call this again with the same photo_ids, the revised sms_body (keep {photos}, the link to the photo page, and the "Reply STOP to opt out" line) and replaces_proposal_id set to the earlier card. Nothing is sent until the manager clicks Confirm.',
    input_schema: {
      type: 'object',
      properties: {
        booking_ref: { type: 'string' },
        photo_ids: { type: 'array', items: { type: 'string' } },
        party_type: { type: 'string' },
        theme: { type: 'string' },
        activity: { type: 'string' },
        email: { type: 'boolean' },
        sms: { type: 'boolean' },
        sms_body: { type: 'string', description: 'Revised text message containing {photos}. Only when rewording.' },
        replaces_proposal_id: { type: 'string', description: 'proposal_id of the pending card this one replaces.' },
      },
      required: ['booking_ref', 'email', 'sms'],
    },
  },
  {
    name: 'propose_approve_party',
    description:
      'PROPOSE approving a party: sets its status to Approved, the same as the Approve button in the Parties tab. NOTE: sending the client a planner, invoice or portal link (propose_send_client_links) ALREADY approves a waiting party by itself, so use this only to approve without sending a link. By default it also EMAILS THE CLIENT the standard "Your Party is Confirmed!" message (the studio-rental version for rentals) with a link to their booking; set send_confirmation_email false to approve without telling them (only if the manager says the client already knows). Refused for a cancelled or lost party (use propose_reopen_party first), one already approved, and a party with no price yet. The card shows exactly what will happen. Nothing changes until the manager clicks Confirm.',
    input_schema: {
      type: 'object',
      properties: { booking_ref: { type: 'string' }, send_confirmation_email: { type: 'boolean', description: 'Default true.' } },
      required: ['booking_ref'],
    },
  },
  {
    name: 'propose_reopen_party',
    description:
      'PROPOSE reopening a party that was marked lost or cancelled, putting it back to Quoted (if it has a price) or Lead. Sends the client nothing. Money already paid still counts, so a reopened party that had a deposit reads as Booked. Nothing changes until the manager clicks Confirm.',
    input_schema: { type: 'object', properties: { booking_ref: { type: 'string' } }, required: ['booking_ref'] },
  },
  {
    name: 'propose_party_link',
    description:
      'PROPOSE making a link for the manager to open or copy: the invoice page of the party, its party planner page, or its booking portal. It is the same link the client gets, so it SIGNS WHOEVER OPENS IT IN as the client for 30 days. It is shown to the manager only and is NOT sent to the client (to send it use propose_send_client_links). Nothing is made until the manager clicks Confirm. For the admin view of a party use get_party_links, not this.',
    input_schema: {
      type: 'object',
      properties: {
        booking_ref: { type: 'string' },
        destination: { type: 'string', enum: ['invoice', 'planner', 'portal'] },
      },
      required: ['booking_ref', 'destination'],
    },
  },
  {
    name: 'propose_enrol_sequence',
    description:
      'PROPOSE enrolling a lead in an email nurture sequence (ids from list_sequences). The card shows the steps and the FIRST email exactly as the lead would read it, and whether the person has opted out. Enrolling queues the person; it sends nothing now. Consent, stage and duplicates are checked again when the manager clicks Confirm. Only for leads who have not booked. Nothing happens until the manager clicks Confirm.',
    input_schema: {
      type: 'object',
      properties: { booking_ref: { type: 'string' }, sequence_id: { type: 'string' } },
      required: ['booking_ref', 'sequence_id'],
    },
  },
  ...LEAD_TOOLS,
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
      case 'get_quote':
        return await getQuote(supabase, input)
      case 'find_photos':
        return await findPhotosTool(supabase, input)
      case 'propose_update_party':
        return await proposeUpdateParty(supabase, input, ctx)
      case 'propose_add_line_item':
        return await proposeAddLineItem(supabase, input, ctx)
      case 'propose_remove_line_item':
        return await proposeRemoveLineItem(supabase, input, ctx)
      case 'propose_record_payment':
        return await proposeRecordPayment(supabase, input, ctx)
      case 'propose_cancel':
        return await proposeCancel(supabase, input, ctx)
      case 'propose_mark_lost':
        return await proposeMarkLost(supabase, input, ctx)
      case 'propose_send_photos':
        return await proposeSendPhotos(supabase, input, ctx)
      case 'propose_enrol_sequence':
        return await proposeEnrolSequence(supabase, input, ctx)
      case 'propose_party_link':
        return await proposePartyLink(supabase, input, ctx)
      case 'propose_approve_party':
        return await proposeApproveParty(supabase, input, ctx)
      case 'propose_reopen_party':
        return await proposeReopenParty(supabase, input, ctx)
      default:
        if (isLeadTool(name)) return await runLeadTool(name, input, supabase, ctx.now)
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

  const edits = messageEdits(input)
  const built = await buildClientLinksCard(supabase, b, {
    kinds, email, sms, edits, authored: hasEdits(edits) ? 'model' : 'default', now: ctx.now,
  })
  return messageCardOutcome('send_client_links', built, ctx, input)
}

/** A party by ref, INCLUDING cancelled and lost (loadBooking refuses those; reopen needs them). */
async function loadAnyBooking(supabase: Supa, input: Record<string, unknown>): Promise<LoadedBooking> {
  const ref = str(input.booking_ref, 40)
  if (!ref) return { ok: false, out: fail('booking_ref is required') }
  const { data, error } = await supabase.from('bookings').select(BOOKING_EDIT_COLUMNS).eq('booking_ref', ref).maybeSingle()
  if (error) return { ok: false, out: fail('Could not read that party — say so.') }
  if (!data) return { ok: false, out: fail(`No party with ref ${ref}`) }
  return { ok: true, b: data as unknown as BookingRow }
}

/** Statuses that already say "approved or further": approving again would only re-email the client. */
const APPROVED_OR_BEYOND = ['approved', 'modifications_locked', 'paid_in_full', 'completed']

async function proposeApproveParty(supabase: Supa, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const l = await loadAnyBooking(supabase, input)
  if (!l.ok) return l.out
  const b = l.b
  if (b.status === 'cancelled' || b.status === 'lost') {
    return fail(`${b.booking_ref} is ${b.status}. Approving it would revive it and tell the client it is confirmed: use propose_reopen_party first, then approve. Nothing was proposed.`)
  }
  if (b.status && APPROVED_OR_BEYOND.includes(b.status)) {
    return fail(`${b.booking_ref} is already ${b.status}, so there is nothing to approve. Nothing was proposed.`)
  }
  const sendEmail = input.send_confirmation_email !== false
  const pic = await moneyPicture(supabase, b.booking_ref)
  if (!pic) return fail('Could not read the price and payments, so I cannot say what approving would tell the client. Nothing was proposed.')
  if (sendEmail) {
    if (!(b.contact_email && looksLikeEmail(b.contact_email))) {
      return fail('There is no valid email on this party, so the confirmation email cannot go. Fix the email, or propose again with send_confirmation_email false. Nothing was proposed.')
    }
    if (pic.total <= 0) {
      return fail('This party has no price yet; the confirmation email would show a $0.00 balance. Price it first, or propose again with send_confirmation_email false. Nothing was proposed.')
    }
  }
  const rental = b.event_type === 'studio-rental'
  const details = [
    `Party: ${partyLabel(b)}`,
    `Status: ${b.status ?? 'unknown'} → approved`,
    `Money: priced ${money(pic.total)}, paid ${money(pic.paid)}, still owed ${money(pic.outstanding)}`,
    sendEmail
      ? `Emails the client (${maskEmail(b.contact_email)}) the standard "${rental ? 'Your Studio Rental is Confirmed!' : 'Your Party is Confirmed!'}" message with a link to their booking and the balance of ${money(pic.outstanding)}.`
      : 'The client is NOT emailed (you said they already know). The change is logged as a deliberate no-email approval.',
    'It goes on the calendar only once a deposit has landed.',
  ]
  return cardOutcome(
    'approve_party',
    { bookingId: b.id, bookingRef: b.booking_ref, sendEmail },
    `Approve ${b.booking_ref}${sendEmail ? ' and email the client' : ' (no email)'}`,
    details,
    ctx,
    'Nothing has changed and nothing has been sent.',
  )
}

async function proposeReopenParty(supabase: Supa, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const l = await loadAnyBooking(supabase, input)
  if (!l.ok) return l.out
  const b = l.b
  if (b.status !== 'lost' && b.status !== 'cancelled') {
    return fail(`${b.booking_ref} is ${b.status ?? 'open'}; only a lost or cancelled party can be reopened. Nothing was proposed.`)
  }
  const next = (b.total_cents ?? 0) > 0 ? 'Quoted' : 'Lead'
  return cardOutcome(
    'reopen_party',
    { bookingId: b.id, bookingRef: b.booking_ref },
    `Reopen ${b.booking_ref} as ${next}`,
    [
      `Party: ${partyLabel(b)}`,
      `Status: ${b.status} → ${next.toLowerCase()}`,
      'The client is sent nothing. Any money already paid still counts, so the party reads as Booked if a deposit was paid.',
    ],
    ctx,
    'Nothing has changed.',
  )
}

const PARTY_LINK_LABELS = { invoice: 'invoice', planner: 'party planner', portal: 'booking portal' } as const

async function proposePartyLink(supabase: Supa, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const d = input.destination
  if (d !== 'invoice' && d !== 'planner' && d !== 'portal') return fail('destination must be invoice, planner or portal')
  const l = await loadBooking(supabase, input)
  if (!l.ok) return l.out
  const b = l.b
  const what = PARTY_LINK_LABELS[d]
  return cardOutcome(
    'party_link',
    { bookingId: b.id, bookingRef: b.booking_ref, destination: d },
    `Make the ${what} link for ${b.booking_ref}`,
    [
      `Party: ${partyLabel(b)}`,
      `A fresh ${what} link, for you to open or copy. It is NOT sent to the client.`,
      'It is the link the client gets: whoever opens it is signed in as them for 30 days, so treat it like a password. It is shown on this card only and is not saved in the chat history.',
    ],
    ctx,
    'No link has been made.',
  )
}

async function proposeEnrolSequence(supabase: Supa, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const ref = str(input.booking_ref, 40)
  const sequenceId = str(input.sequence_id, 64)
  if (!ref || !sequenceId) return fail('booking_ref and sequence_id are required (ids come from list_sequences)')
  const { data, error } = await supabase
    .from('bookings')
    .select('id, booking_ref, status, contact_id, contact_name, contact_email, contact_phone, party_date, total_cents')
    .eq('booking_ref', ref)
    .maybeSingle()
  if (error) return fail('Could not read that party — say so.')
  if (!data) return fail(`No party with ref ${ref}`)
  const built = await buildEnrolCard(supabase, data as never, sequenceId, ctx.now)
  if (!built.ok) return fail(built.error)
  const minted = mintProposal({ kind: 'enrol_sequence', input: built.input, title: built.title, details: built.details, actor: ctx.actor })
  return {
    result: {
      status: 'awaiting_manager_confirmation',
      proposal_id: minted.proposal.id,
      shown_to_manager: built.details,
      checks: built.preview.status,
      instruction: 'Nobody has been enrolled and nothing has been sent. Tell the manager to review the card (the steps and the first email) and click Confirm.',
    },
    proposal: minted,
    preview: built.preview,
  }
}

/** The reworded fields the model passed, trimmed to strings; absent means "standard wording". */
function messageEdits(input: Record<string, unknown>): MessageEdits {
  const pick = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined)
  return {
    smsBody: pick(input.sms_body, 2000),
    emailSubject: pick(input.email_subject, 400),
    emailBody: pick(input.email_body, 8000),
  }
}

function hasEdits(e: MessageEdits): boolean {
  return e.smsBody !== undefined || e.emailSubject !== undefined || e.emailBody !== undefined
}

/**
 * Mint the card for a message and hand the model the exact wording back, so a
 * request to reword it starts from the text the manager is looking at.
 */
function messageCardOutcome(
  kind: 'send_client_links' | 'send_photos',
  built: BuiltCard,
  ctx: ToolContext,
  input: Record<string, unknown>,
  photos?: ProposalPhoto[],
): ToolOutcome {
  if (!built.ok) return fail(built.error)
  const minted = mintProposal({
    kind, input: built.input, title: built.title, details: built.details, actor: ctx.actor, ...(photos ? { photos } : {}),
  })
  const replaces = str(input.replaces_proposal_id, 64) ?? undefined
  return {
    result: {
      status: 'awaiting_manager_confirmation',
      proposal_id: minted.proposal.id,
      shown_to_manager: built.details,
      message_preview: {
        recipient_first_name: built.preview.recipient,
        send_status: built.preview.status,
        channels: built.preview.channels.map(c => ({
          channel: c.channel,
          ...(c.subject !== undefined ? { subject: c.subject } : {}),
          text: c.template,
          ...(c.sms ? { sms_segments: c.sms.segments, sms_encoding: c.sms.encoding } : {}),
          editable: c.editable,
        })),
      },
      instruction: 'Nothing has been sent. The card shows the manager the exact message. Tell them to review it and click Confirm, or tell you what to change.',
    },
    proposal: minted,
    preview: built.preview,
    ...(replaces ? { supersedes: replaces } : {}),
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

/* ── Read tools added with the admin overlay ──────────────────────────── */

async function getQuote(supabase: Supa, input: Record<string, unknown>): Promise<ToolOutcome> {
  const words = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const loaded = await loadQuoteCatalog(supabase)
  if (loaded.kind !== 'ok') return { result: { error: 'The price list could not be read — say so; do not guess a price.' }, isError: true }
  // The model supplies WORDS and a count. The arithmetic is lib/quoteEngine.ts.
  const ans = quoteFromCatalog(loaded.data, {
    partyType: input.party_type as 'studio' | 'mobile',
    guests: Number(input.guests),
    theme: str(input.theme, 80) ?? undefined,
    activities: words(input.activities),
    mini: input.mini_party === true,
    addOns: words(input.add_ons),
  })
  if (!ans.ok) return { result: { error: ans.error }, isError: true }
  return {
    result: {
      total: money(ans.quote.totalCents),
      guests_priced: ans.quote.effectiveGuestCount,
      line_items: ans.quote.lineItems.map(l => ({
        item: l.name,
        quantity: l.quantity,
        each: money(l.unit_price_cents),
        per_guest: l.guest_multiplied,
      })),
      not_found: ans.unmatched,
      ambiguous: ans.ambiguous,
      notes: [
        ans.travelNotIncluded ? 'Mobile parties: the travel fee is added from the party address, so it is not in this total.' : null,
        ans.unmatched.length || ans.ambiguous.length ? 'Some names did not match and are NOT in the total — ask, do not approximate.' : null,
      ].filter(Boolean),
      open_in_planner: ans.plannerUrl,
    },
  }
}

async function findPhotosTool(supabase: Supa, input: Record<string, unknown>): Promise<ToolOutcome> {
  const limit = Math.max(1, Math.min(MAX_PHOTOS_PER_REQUEST, Math.floor(Number(input.limit) || 6)))
  // findPhotos is the ONLY reader of the library: approved AND no identifiable child.
  const r = await findPhotos(supabase, {
    partyType: str(input.party_type, 40) ?? undefined,
    themeSlug: str(input.theme, 60) ?? undefined,
    activity: str(input.activity, 60) ?? undefined,
    limit,
  })
  if (r.kind !== 'ok') return { result: { error: 'The photo library could not be read — say so.' }, isError: true }
  return {
    result: {
      photos: r.data.map(p => ({ id: p.id, url: p.url, alt: p.alt, party_type: p.partyType, theme: p.themeSlug, activities: p.activities, kind: p.kind })),
      // A reel's thumbnail is a still of a video: the useful thing to text is the reel itself.
      text_lines: r.data.map(p => (p.kind === 'reel' && p.igPermalink ? `${p.alt || 'Party reel'} (video): ${p.igPermalink}` : `${p.alt || 'Party photo'}: ${p.url}`)),
      note: r.data.length ? undefined : 'No approved photos match that. Say so; do not describe photos you have not been shown.',
    },
  }
}

/* ── Proposals added with the admin overlay ───────────────────────────── */

interface BookingRow {
  id: string
  booking_ref: string
  status: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  child_name: string | null
  child_age: number | null
  party_type: string | null
  event_type: string | null
  party_date: string | null
  party_time: string | null
  guest_count_approx: number | null
  package_type: string | null
  admin_notes: string | null
  total_cents: number | null
}

const BOOKING_EDIT_COLUMNS =
  'id, booking_ref, status, contact_name, contact_email, contact_phone, child_name, child_age, party_type, event_type, party_date, party_time, guest_count_approx, package_type, admin_notes, total_cents'

type LoadedBooking = { ok: true; b: BookingRow } | { ok: false; out: ToolOutcome }

const fail = (error: string): ToolOutcome => ({ result: { error }, isError: true })

/**
 * Three outcomes: a failed read is not "no such party". A cancelled or lost
 * party is refused — the dashboard's reopen action is the way back, not a chat
 * message.
 */
async function loadBooking(supabase: Supa, input: Record<string, unknown>): Promise<LoadedBooking> {
  const ref = str(input.booking_ref, 40)
  if (!ref) return { ok: false, out: fail('booking_ref is required') }
  const { data, error } = await supabase.from('bookings').select(BOOKING_EDIT_COLUMNS).eq('booking_ref', ref).maybeSingle()
  if (error) return { ok: false, out: fail('Could not read that party — say so.') }
  if (!data) return { ok: false, out: fail(`No party with ref ${ref}`) }
  const b = data as unknown as BookingRow
  if (b.status === 'cancelled' || b.status === 'lost') {
    return { ok: false, out: fail(`${b.booking_ref} is ${b.status}. Reopen it in the Parties tab first; nothing was proposed.`) }
  }
  return { ok: true, b }
}

function cardOutcome(
  kind: Proposal['kind'],
  proposalInput: Record<string, unknown>,
  title: string,
  details: string[],
  ctx: ToolContext,
  nothing: string,
  photos?: ProposalPhoto[],
): ToolOutcome {
  const minted = mintProposal({ kind, input: proposalInput, title, details, actor: ctx.actor, ...(photos ? { photos } : {}) })
  return {
    result: {
      status: 'awaiting_manager_confirmation',
      proposal_id: minted.proposal.id,
      shown_to_manager: details,
      instruction: `${nothing} Tell the manager to review the card and click Confirm.`,
    },
    proposal: minted,
  }
}

const partyLabel = (b: BookingRow) => `${b.booking_ref} — ${b.contact_name ?? 'client'}${b.party_date ? ` on ${b.party_date}` : ''}`

/** Best-effort money picture for a card. null when the invoice could not be read. */
async function moneyPicture(supabase: Supa, ref: string) {
  const loaded = await loadPlanInvoice(ref, supabase)
  if (!loaded.ok) return null
  const inv = loaded.invoice
  return { total: inv.totalCents, paid: inv.paidCents, outstanding: inv.outstandingCents, guests: inv.guestCount ?? null }
}

async function proposeUpdateParty(supabase: Supa, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const l = await loadBooking(supabase, input)
  if (!l.ok) return l.out
  const b = l.b

  // [PATCH column, label, old, new]. Status and money are deliberately absent.
  const changes: Array<[string, string, unknown, unknown]> = []
  const updates: Record<string, unknown> = {}
  const set = (col: string, label: string, old: unknown, next: unknown) => {
    updates[col] = next
    changes.push([col, label, old, next])
  }

  if (input.party_date !== undefined) {
    const d = isoDate(input.party_date)
    if (d === 'invalid' || !d) return fail('party_date must be a real date, YYYY-MM-DD')
    if (d < etToday(ctx.now)) return fail(`party_date ${d} is in the past — confirm the date with the manager.`)
    set('party_date', 'Date', b.party_date, d)
  }
  if (input.party_time !== undefined) {
    const t = str(input.party_time, 5)
    if (!t || !HHMM.test(t)) return fail('party_time must be HH:mm (24-hour)')
    set('party_time', 'Time', b.party_time, t)
  }
  if (input.guest_count !== undefined) {
    const g = Math.floor(Number(input.guest_count))
    if (!(g >= 1 && g <= 500)) return fail('guest_count must be between 1 and 500')
    set('guest_count_approx', 'Guests', b.guest_count_approx, g)
  }
  if (input.child_name !== undefined) {
    const v = str(input.child_name, 80)
    if (!v) return fail('child_name cannot be empty')
    set('child_name', 'Child', b.child_name, v)
  }
  if (input.child_age !== undefined) {
    const a = Math.floor(Number(input.child_age))
    if (!(a >= 0 && a <= 120)) return fail('child_age must be between 0 and 120')
    set('child_age', 'Child age', b.child_age, a)
  }
  if (input.package_type !== undefined) {
    const v = str(input.package_type, 120)
    if (!v) return fail('package_type cannot be empty')
    set('package_type', 'Package', b.package_type, v)
  }
  if (input.contact_name !== undefined) {
    const v = str(input.contact_name, 120)
    if (!v) return fail('contact_name cannot be empty')
    set('contact_name', 'Client name', b.contact_name, v)
  }
  if (input.contact_email !== undefined) {
    const v = str(input.contact_email, 200)
    if (!v || !looksLikeEmail(v)) return fail('contact_email must be a valid email address')
    set('contact_email', 'Client email', b.contact_email, v)
  }
  if (input.contact_phone !== undefined) {
    const v = str(input.contact_phone, 40)
    if (!v || !looksLikePhone(v)) return fail('contact_phone must be a phone number')
    set('contact_phone', 'Client phone', b.contact_phone, v)
  }
  if (input.party_type !== undefined) {
    const v = str(input.party_type, 40)
    if (!v || !isPartyType(v)) return fail(`party_type must be one of ${PARTY_TYPES.join(', ')}`)
    set('party_type', 'Party type', b.party_type, v)
  }
  if (input.admin_notes !== undefined) {
    const v = str(input.admin_notes, 2000)
    if (!v) return fail('admin_notes cannot be empty')
    set('admin_notes', 'Internal note', b.admin_notes ? '(existing note)' : null, v)
  }
  if (changes.length === 0) return fail('Nothing to change — give at least one field.')

  const shown = (v: unknown) => (v === null || v === undefined || v === '' ? 'not set' : String(v))
  const details = [
    `Party: ${partyLabel(b)}`,
    ...changes.map(([, label, old, next]) => `${label}: ${shown(old)} → ${shown(next)}`),
    ...(changes.some(c => c[0] === 'guest_count_approx') ? ['Per-guest items are re-priced and the invoice total is recalculated.'] : []),
    ...(changes.some(c => c[0] === 'contact_email')
      ? ['The email is what the client signs in to their booking page with — changing it changes who can open it.']
      : []),
    ...(changes.some(c => c[0] === 'party_date' || c[0] === 'party_time')
      ? ['The calendar event and the check-in reminders move with it. The client is not notified.']
      : []),
  ]
  return cardOutcome(
    'update_party',
    { bookingId: b.id, bookingRef: b.booking_ref, updates },
    `Update ${b.booking_ref}`,
    details,
    ctx,
    'Nothing has been changed.',
  )
}

async function proposeAddLineItem(supabase: Supa, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const l = await loadBooking(supabase, input)
  if (!l.ok) return l.out
  const b = l.b

  let name: string
  let cents: number
  let guestMultiplied: boolean
  let source: string
  const catalogName = str(input.add_on, 120)
  if (catalogName) {
    // The price comes from the catalog, not from the model.
    const addOns = await loadLineItemAddOns(supabase)
    const hits = addOns.filter(a => a.name.trim().toLowerCase() === catalogName.toLowerCase())
    if (hits.length !== 1) {
      const firstWord = catalogName.toLowerCase().split(/\s+/)[0] || '~'
      const near = addOns
        .filter(a => a.name.toLowerCase().includes(firstWord))
        .slice(0, 8)
        .map(a => `${a.name} (${money(a.priceCents)})`)
      return fail(
        hits.length > 1
          ? `"${catalogName}" matches more than one add-on.`
          : `No catalog add-on named "${catalogName}".${near.length ? ` Close: ${near.join('; ')}.` : ''} Use one of those names, or ask the manager for a custom name and price.`,
      )
    }
    name = hits[0].name
    cents = hits[0].priceCents
    guestMultiplied = hits[0].guestMultiplied
    source = 'catalog price'
  } else {
    const n = str(input.name, 120)
    if (!n) return fail('Give add_on (a catalog name) or a custom name and unit_price_cents.')
    const c = Math.round(Number(input.unit_price_cents))
    // Not negative: a discount is a deliberate act in the dashboard, not
    // something a chat transcript should be able to slip onto an invoice.
    if (!Number.isFinite(c) || c < 0 || c > MAX_ITEM_CENTS) return fail('Custom items need a price between $0 and $10,000.')
    name = n
    cents = c
    guestMultiplied = input.per_guest === true
    source = 'price as stated by the manager'
  }
  const qty = input.quantity === undefined ? 1 : Math.floor(Number(input.quantity))
  if (!(qty >= 1 && qty <= 100)) return fail('quantity must be 1-100')

  const pic = await moneyPicture(supabase, b.booking_ref)
  const guests = pic?.guests ?? b.guest_count_approx
  const adds = billedTotalCents([{ unit_price_cents: cents, quantity: qty, guest_multiplied: guestMultiplied }], guests)
  const details = [
    `Party: ${partyLabel(b)}`,
    `Add: ${name}${qty > 1 ? ` ×${qty}` : ''} — ${money(cents)}${guestMultiplied ? ' per guest' : ''} (${source})`,
    pic
      ? `Adds about ${money(adds)}: invoice ${money(pic.total)} → ${money(pic.total + adds)}.`
      : `Adds about ${money(adds)}. (The current total could not be read to preview.)`,
    'The invoice total is recalculated when you confirm. The client is not notified.',
  ]
  return cardOutcome(
    'add_line_item',
    {
      bookingId: b.id,
      bookingRef: b.booking_ref,
      name,
      category: str(input.category, 40) ?? 'add-on',
      quantity: qty,
      unit_price_cents: cents,
      guest_multiplied: guestMultiplied,
    },
    `Add ${name} to ${b.booking_ref}`,
    details,
    ctx,
    'Nothing has been added.',
  )
}

async function proposeRemoveLineItem(supabase: Supa, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const l = await loadBooking(supabase, input)
  if (!l.ok) return l.out
  const b = l.b
  const wanted = str(input.line_item_name, 120)
  const wantedId = str(input.line_item_id, 60)
  if (!wanted && !wantedId) return fail('line_item_name is required (as shown by get_party).')

  const { data, error } = await supabase
    .from('booking_line_items')
    .select('id, name, quantity, unit_price_cents, guest_multiplied')
    .eq('booking_id', b.id)
  if (error) return fail('Could not read the invoice lines — say so.')
  const rows = (data ?? []) as { id: string; name: string; quantity: number; unit_price_cents: number; guest_multiplied: boolean }[]
  const hits = wantedId
    ? rows.filter(r => r.id === wantedId)
    : rows.filter(r => r.name.trim().toLowerCase() === (wanted as string).toLowerCase())
  if (hits.length === 0) {
    return fail(`No line item named "${wanted ?? wantedId}" on ${b.booking_ref}. Lines: ${rows.map(r => r.name).join('; ') || 'none'}.`)
  }
  if (hits.length > 1) {
    return {
      result: {
        error: `More than one line is named "${wanted}". Call again with line_item_id for the one the manager means.`,
        candidates: hits.map(r => ({ line_item_id: r.id, name: r.name, quantity: r.quantity, each: money(r.unit_price_cents), per_guest: r.guest_multiplied })),
      },
      isError: true,
    }
  }
  const li = hits[0]
  const pic = await moneyPicture(supabase, b.booking_ref)
  const removes = billedTotalCents([li], pic?.guests ?? b.guest_count_approx)
  const details = [
    `Party: ${partyLabel(b)}`,
    `Remove: ${li.name}${li.quantity > 1 ? ` ×${li.quantity}` : ''} — ${money(li.unit_price_cents)}${li.guest_multiplied ? ' per guest' : ''}`,
    pic
      ? `Takes off about ${money(removes)}: invoice ${money(pic.total)} → ${money(pic.total - removes)}.`
      : `Takes off about ${money(removes)}. (The current total could not be read to preview.)`,
    'The invoice total is recalculated when you confirm. The client is not notified.',
  ]
  return cardOutcome(
    'remove_line_item',
    { bookingId: b.id, bookingRef: b.booking_ref, lineItemId: li.id },
    `Remove ${li.name} from ${b.booking_ref}`,
    details,
    ctx,
    'Nothing has been removed.',
  )
}

async function proposeRecordPayment(supabase: Supa, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const l = await loadBooking(supabase, input)
  if (!l.ok) return l.out
  const b = l.b
  const cents = Number(input.amount_cents)
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 10_000_000) {
    return fail('amount_cents must be a positive whole number of cents (up to $100,000).')
  }
  const method = typeof input.payment_method === 'string' ? input.payment_method : ''
  if (!(ADMIN_PAYMENT_METHODS as readonly string[]).includes(method)) {
    return fail(`payment_method must be one of ${ADMIN_PAYMENT_METHODS.join(', ')} — ask the manager which.`)
  }
  const type = input.payment_type === undefined ? 'partial' : String(input.payment_type)
  // A refund is a negative row with Stripe bookkeeping behind it; it is not a chat action.
  if (!(PAYMENT_TYPES as readonly string[]).includes(type) || type === 'refund') {
    return fail('payment_type must be deposit, partial or final. Refunds are made in the dashboard.')
  }
  const sendReceipt = input.send_receipt === true
  const notes = str(input.notes, 300)

  const pic = await moneyPicture(supabase, b.booking_ref)
  const details = [
    `Party: ${partyLabel(b)}`,
    `Record: ${money(cents)} by ${method} (${type}).${notes ? ` Note: ${notes}` : ''}`,
    pic
      ? `Now: total ${money(pic.total)}, paid ${money(pic.paid)}, outstanding ${money(pic.outstanding)} → outstanding about ${money(Math.max(0, pic.outstanding - cents))} after.`
      : 'The current balance could not be read to preview.',
    ...(pic && pic.total > 0 && cents > pic.outstanding
      ? [`Heads up: this is more than the ${money(pic.outstanding)} outstanding and will show as overpaid.`]
      : []),
    'This writes the payment into the books; it takes no money. The books decline it if a card payment already covers it.',
    sendReceipt ? 'A receipt email WILL be sent to the client.' : 'No receipt is sent to the client.',
  ]
  return cardOutcome(
    'record_payment',
    {
      bookingId: b.id,
      bookingRef: b.booking_ref,
      amount_cents: cents,
      payment_method: method,
      payment_type: type,
      notes: notes ?? undefined,
      send_receipt: sendReceipt,
    },
    `Record ${money(cents)} ${method} payment on ${b.booking_ref}`,
    details,
    ctx,
    'Nothing has been recorded.',
  )
}

async function proposeCancel(supabase: Supa, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const l = await loadBooking(supabase, input)
  if (!l.ok) return l.out
  const b = l.b
  const pic = await moneyPicture(supabase, b.booking_ref)
  const details = [
    `Party: ${partyLabel(b)}`,
    pic ? `Paid so far: ${money(pic.paid)}.` : 'What has been paid could not be read.',
    'Cancelling frees the date on the calendar and stops the check-in texts.',
    'It does NOT refund anything and sends the client nothing — refunds and messages are separate.',
    ...(pic && pic.paid === 0 ? ['Nothing is paid: if this was a lead that said no, "mark lost" fits better.'] : []),
  ]
  return cardOutcome('cancel_party', { bookingId: b.id, bookingRef: b.booking_ref }, `Cancel ${b.booking_ref}`, details, ctx, 'Nothing has been cancelled.')
}

async function proposeMarkLost(supabase: Supa, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const l = await loadBooking(supabase, input)
  if (!l.ok) return l.out
  const b = l.b
  const pic = await moneyPicture(supabase, b.booking_ref)
  if (!pic) return fail('Could not read what has been paid, so I cannot tell whether this is a lost lead. Nothing was proposed.')
  if (pic.paid > 0) {
    return fail(`${b.booking_ref} has ${money(pic.paid)} paid, so it was booked — propose_cancel is the right action, not mark lost.`)
  }
  const details = [
    `Party: ${partyLabel(b)}`,
    'Marks the lead as lost (they said no). Nothing is paid.',
    'The client is sent nothing. It can be reopened later in the Parties tab.',
  ]
  return cardOutcome('mark_lost', { bookingId: b.id, bookingRef: b.booking_ref }, `Mark ${b.booking_ref} as lost`, details, ctx, 'Nothing has changed.')
}

async function proposeSendPhotos(supabase: Supa, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const l = await loadBooking(supabase, input)
  if (!l.ok) return l.out
  const b = l.b
  const email = input.email === true
  const sms = input.sms === true
  if (!email && !sms) return fail('Choose email, sms, or both')
  if (email && !(b.contact_email && looksLikeEmail(b.contact_email))) return fail('No valid email on that booking.')
  if (sms && !b.contact_phone) return fail('No phone on that booking.')

  const ids = Array.isArray(input.photo_ids)
    ? Array.from(new Set((input.photo_ids as unknown[]).filter((v): v is string => typeof v === 'string'))).slice(0, MAX_PHOTOS_PER_REQUEST)
    : []
  const partyType = str(input.party_type, 40) ?? undefined
  const themeSlug = str(input.theme, 60) ?? undefined
  const activity = str(input.activity, 60) ?? undefined
  if (ids.length === 0 && !partyType && !themeSlug && !activity) {
    return fail('Say which photos: photo_ids from find_photos, or a party_type / theme / activity.')
  }
  // The ONLY reader of the photo library — approved AND no identifiable child.
  const found = await findPhotos(supabase, ids.length ? { ids, limit: MAX_PHOTOS_PER_REQUEST } : { partyType, themeSlug, activity, limit: 6 })
  if (found.kind !== 'ok') return fail('The photo library could not be read — say so.')
  const photos = found.data
  if (photos.length === 0) return fail('No approved photos match that, so there is nothing to send. Say so.')

  const edits = messageEdits(input)
  const built = await buildPhotosCard(supabase, b as never, {
    photos: photos.map(p => ({ id: p.id, url: p.url, alt: p.alt })),
    email, sms,
    edits: { smsBody: edits.smsBody },
    authored: edits.smsBody !== undefined ? 'model' : 'default',
    now: ctx.now,
  })
  if (built.ok && ids.length && photos.length < ids.length) {
    built.details.push(`${ids.length - photos.length} of the photos asked for are not approved to send and are left out.`)
  }
  return messageCardOutcome('send_photos', built, ctx, input, photos.map(p => ({ id: p.id, url: p.url, alt: p.alt })))
}
