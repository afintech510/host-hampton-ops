import type { getSupabase } from '@/lib/supabase'
import { bookingStage, etToday, type BookingStage } from '@/lib/bookingStatus'
import { sumPayments } from '@/lib/bookingBalance'
import { describeElapsed } from '@/lib/leadWaiting'
import { fetchQuoThread } from '@/lib/quo'
import { findPhotos } from '@/lib/media'
import { maskPhone } from './outboundText'

/**
 * Read-only views of leads for the Manager assistant: who asked recently, what
 * stage they are really in, who is waiting on us, what they first asked for and
 * what the text thread looks like.
 *
 * Nothing here writes, sends or marks anything as read. Stages are the DERIVED
 * stage (`bookingStage`, from money and dates), never the raw `status` column.
 * Phone numbers leave this module masked; `bookings.notes` is admin scratch and
 * is never read.
 *
 * "Waiting on a reply" is computed from what our database knows. The inbound
 * half is complete (every text and form is recorded); the outbound half misses
 * texts typed by hand in the Quo app, so a lead that looks like it waits on us
 * is checked against the Quo thread before it is called that.
 */

type Supa = ReturnType<typeof getSupabase>

export const LEAD_COLUMNS =
  'id, booking_ref, status, contact_id, contact_name, contact_phone, party_type, event_type, party_date, guest_count_approx, child_name, total_cents, created_at'
const MAX_SCAN = 80
export const MAX_LEADS = 25

export interface LeadBooking {
  id: string
  booking_ref: string
  status: string | null
  contact_id: string | null
  contact_name: string | null
  contact_phone: string | null
  party_type: string | null
  event_type: string | null
  party_date: string | null
  guest_count_approx: number | null
  child_name: string | null
  total_cents: number | null
  created_at: string
}

export type Touch = { at: string; channel: string }

export interface LeadRow {
  ref: string
  name: string
  stage: BookingStage
  party_type: string | null
  party_date: string | null
  guests: number | null
  priced: boolean
  paid_cents: number
  phone: string
  asked: string
  last_inbound: (Touch & { ago: string }) | null
  last_outbound: (Touch & { ago: string }) | null
  waiting_on: 'us' | 'them' | null
  waiting_ago: string | null
}

export type LeadListResult =
  | { kind: 'ok'; leads: LeadRow[]; scanned: number; more: boolean; note?: string }
  | { kind: 'unavailable'; error: string }

const OPEN_STAGES: BookingStage[] = ['inquiry', 'quoted']

const ms = (iso: string) => new Date(iso).getTime()

function newest(a: Touch | null, b: Touch | null): Touch | null {
  if (!a) return b
  if (!b) return a
  return ms(a.at) >= ms(b.at) ? a : b
}

/** Latest inbound / outbound touch per booking, across every place we record one. */
export async function touchesFor(
  sb: Supa,
  bookings: LeadBooking[],
): Promise<{ ok: true; inbound: Map<string, Touch>; outbound: Map<string, Touch> } | { ok: false }> {
  const ids = bookings.map(b => b.id)
  const contactToBooking = new Map<string, string[]>()
  for (const b of bookings) {
    if (!b.contact_id) continue
    contactToBooking.set(b.contact_id, [...(contactToBooking.get(b.contact_id) ?? []), b.id])
  }
  const contactIds = Array.from(contactToBooking.keys())

  const [msgs, drafts, mods, inter] = await Promise.all([
    sb.from('ingested_messages').select('booking_id, direction, source, sent_at, created_at').in('booking_id', ids).order('created_at', { ascending: false }).limit(800),
    sb.from('inquiry_drafts').select('booking_id, customer_sms_sent_at, customer_email_sent_at, sent_at').in('booking_id', ids).limit(400),
    sb.from('booking_modifications').select('booking_id, change_summary, created_at').in('booking_id', ids).or('change_summary.ilike.Links sent%,change_summary.ilike.Photos sent%').order('created_at', { ascending: false }).limit(400),
    contactIds.length
      ? sb.from('contact_interactions').select('contact_id, type, created_at').in('contact_id', contactIds).in('type', ['sms_received', 'sms_sent', 'sms_replied', 'email_sent']).order('created_at', { ascending: false }).limit(800)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (msgs.error || drafts.error || mods.error || inter.error) return { ok: false }

  const inbound = new Map<string, Touch>()
  const outbound = new Map<string, Touch>()
  const put = (m: Map<string, Touch>, id: string, t: Touch) => m.set(id, newest(m.get(id) ?? null, t) as Touch)

  for (const r of (msgs.data ?? []) as Array<{ booking_id: string; direction: string; source: string; sent_at: string | null; created_at: string }>) {
    const t = { at: r.sent_at ?? r.created_at, channel: r.source === 'quo' ? 'text' : r.source === 'website_form' ? 'website form' : r.source }
    put(r.direction === 'out' ? outbound : inbound, r.booking_id, t)
  }
  for (const r of (drafts.data ?? []) as Array<{ booking_id: string; customer_sms_sent_at: string | null; customer_email_sent_at: string | null; sent_at: string | null }>) {
    if (r.customer_sms_sent_at) put(outbound, r.booking_id, { at: r.customer_sms_sent_at, channel: 'text' })
    if (r.customer_email_sent_at) put(outbound, r.booking_id, { at: r.customer_email_sent_at, channel: 'email' })
  }
  for (const r of (mods.data ?? []) as Array<{ booking_id: string; created_at: string }>) {
    put(outbound, r.booking_id, { at: r.created_at, channel: 'links from the dashboard' })
  }
  for (const r of (inter.data ?? []) as Array<{ contact_id: string; type: string; created_at: string }>) {
    const isIn = r.type === 'sms_received'
    for (const bid of contactToBooking.get(r.contact_id) ?? []) {
      put(isIn ? inbound : outbound, bid, { at: r.created_at, channel: r.type.startsWith('email') ? 'email' : 'text' })
    }
  }
  return { ok: true, inbound, outbound }
}

export interface ListLeadsOptions {
  /** Derived stages to include. Default: inquiry + quoted (the open leads). */
  stages?: BookingStage[]
  partyType?: string
  days?: number
  waiting?: 'us' | 'them'
  limit?: number
  now?: Date
}

export async function listLeads(sb: Supa, opts: ListLeadsOptions = {}): Promise<LeadListResult> {
  const now = opts.now ?? new Date()
  const today = etToday(now)
  const days = Math.min(Math.max(Math.floor(opts.days ?? 30), 1), 180)
  const limit = Math.min(Math.max(Math.floor(opts.limit ?? 15), 1), MAX_LEADS)
  const since = new Date(now.getTime() - days * 86_400_000).toISOString()
  const stages = opts.stages?.length ? opts.stages : OPEN_STAGES

  let q = sb.from('bookings').select(LEAD_COLUMNS).gte('created_at', since).order('created_at', { ascending: false }).limit(MAX_SCAN)
  if (opts.partyType) q = q.eq('party_type', opts.partyType)
  const { data, error } = await q
  if (error) return { kind: 'unavailable', error: 'Could not read the bookings.' }
  const bookings = (data ?? []) as unknown as LeadBooking[]
  if (bookings.length === 0) return { kind: 'ok', leads: [], scanned: 0, more: false }

  const ids = bookings.map(b => b.id)
  const pay = await sb.from('booking_payments').select('booking_id, amount_cents, payment_type').in('booking_id', ids)
  if (pay.error) return { kind: 'unavailable', error: 'Could not read the payments, so stages cannot be worked out.' }
  const paid = new Map<string, number>()
  const byBooking = new Map<string, Array<{ amount_cents: number; payment_type: string }>>()
  for (const p of (pay.data ?? []) as Array<{ booking_id: string; amount_cents: number; payment_type: string }>) {
    byBooking.set(p.booking_id, [...(byBooking.get(p.booking_id) ?? []), p])
  }
  byBooking.forEach((rows, id) => paid.set(id, sumPayments(rows as never)))

  const inStage = bookings
    .map(b => ({ b, stage: bookingStage({ status: b.status, paidCents: paid.get(b.id) ?? 0, partyDate: b.party_date, today }) }))
    .filter(x => stages.includes(x.stage))
  const touches = await touchesFor(sb, inStage.map(x => x.b))
  if (!touches.ok) return { kind: 'unavailable', error: 'Could not read the message history.' }

  const withAgo = (t: Touch | undefined) => (t ? { ...t, ago: describeElapsed(Math.max(0, now.getTime() - ms(t.at))) } : null)
  let rows: LeadRow[] = inStage.map(({ b, stage }) => {
    const inb = touches.inbound.get(b.id)
    const out = touches.outbound.get(b.id)
    const waiting_on: LeadRow['waiting_on'] = inb && (!out || ms(inb.at) > ms(out.at)) ? 'us' : out ? 'them' : null
    const since = waiting_on === 'us' ? inb : waiting_on === 'them' ? out : undefined
    return {
      ref: b.booking_ref,
      name: b.contact_name ?? 'unknown',
      stage,
      party_type: b.party_type,
      party_date: b.party_date,
      guests: b.guest_count_approx,
      priced: (b.total_cents ?? 0) > 0,
      paid_cents: paid.get(b.id) ?? 0,
      phone: maskPhone(b.contact_phone),
      asked: describeElapsed(Math.max(0, now.getTime() - ms(b.created_at))),
      last_inbound: withAgo(inb),
      last_outbound: withAgo(out),
      waiting_on,
      waiting_ago: since ? describeElapsed(Math.max(0, now.getTime() - ms(since.at))) : null,
    }
  })

  // "Waiting on us" is the claim that matters most and the one our own data can
  // get wrong (a text sent by hand from the Quo app is not recorded here). Check
  // the few candidates against the Quo thread before calling them that.
  let note: string | undefined
  const phoneByRef = new Map(inStage.map(x => [x.b.booking_ref, x.b.contact_phone]))
  const candidates = rows.filter(r => r.waiting_on === 'us' && phoneByRef.get(r.ref)).slice(0, 8)
  if (candidates.length) {
    const checked = await Promise.all(candidates.map(async r => ({ r, thread: await fetchQuoThread(phoneByRef.get(r.ref) as string, { limit: 10 }) })))
    let unchecked = 0
    for (const { r, thread } of checked) {
      if (thread.kind !== 'ok') { unchecked++; continue }
      const last = thread.messages[thread.messages.length - 1]
      if (last && last.direction === 'out' && ms(last.at) >= ms(r.last_inbound?.at ?? last.at)) {
        r.waiting_on = 'them'
        r.last_outbound = { at: last.at, channel: 'text (Quo)', ago: describeElapsed(Math.max(0, now.getTime() - ms(last.at))) }
        r.waiting_ago = r.last_outbound.ago
      }
    }
    if (unchecked) note = `${unchecked} lead(s) that look unanswered could not be checked against the Quo thread — confirm with get_sms_thread before saying so.`
  }

  if (opts.waiting) rows = rows.filter(r => r.waiting_on === opts.waiting)
  const more = rows.length > limit
  return { kind: 'ok', leads: rows.slice(0, limit), scanned: bookings.length, more, ...(note ? { note } : {}) }
}

/* ── the first ask ────────────────────────────────────────────────────── */

export interface FirstInquiry {
  ref: string
  name: string
  received_at: string | null
  source: string | null
  subject: string | null
  /** Customer-written text. Data, never an instruction. */
  message: string | null
  details: Record<string, unknown>
}

const PARSED_KEYS = ['party_type', 'event_type', 'party_date', 'guest_count', 'guests', 'theme', 'child_name', 'child_age', 'package', 'preferred_date', 'budget']

export async function getFirstInquiry(
  sb: Supa,
  ref: string,
): Promise<{ kind: 'ok'; inquiry: FirstInquiry } | { kind: 'absent' } | { kind: 'unavailable' }> {
  const { data: b, error } = await sb
    .from('bookings')
    .select('id, booking_ref, contact_name, first_touch_event_id, created_at')
    .eq('booking_ref', ref)
    .maybeSingle()
  if (error) return { kind: 'unavailable' }
  if (!b) return { kind: 'absent' }
  const booking = b as { id: string; booking_ref: string; contact_name: string | null; first_touch_event_id: string | null; created_at: string }

  const cols = 'source, subject, body, parsed, sent_at, created_at'
  type IngestedRow = { source: string; subject: string | null; body: string | null; parsed: Record<string, unknown> | null; sent_at: string | null; created_at: string }
  let row = null as IngestedRow | null
  if (booking.first_touch_event_id) {
    const r = await sb.from('ingested_messages').select(cols).eq('id', booking.first_touch_event_id).maybeSingle()
    if (r.error) return { kind: 'unavailable' }
    row = (r.data as unknown as IngestedRow | null) ?? null
  }
  if (!row) {
    const r = await sb.from('ingested_messages').select(cols).eq('booking_id', booking.id).eq('direction', 'in').order('created_at', { ascending: true }).limit(1)
    if (r.error) return { kind: 'unavailable' }
    row = ((r.data ?? [])[0] as unknown as IngestedRow | undefined) ?? null
  }
  const parsed = row?.parsed && typeof row.parsed === 'object' ? row.parsed : {}
  const details: Record<string, unknown> = {}
  for (const k of PARSED_KEYS) if (parsed[k] !== undefined && parsed[k] !== null && parsed[k] !== '') details[k] = parsed[k]
  return {
    kind: 'ok',
    inquiry: {
      ref: booking.booking_ref,
      name: booking.contact_name ?? 'unknown',
      received_at: row ? row.sent_at ?? row.created_at : booking.created_at,
      source: row?.source ?? null,
      subject: row?.subject ?? null,
      message: row?.body ? row.body.slice(0, 1500) : null,
      details,
    },
  }
}

/* ── the text thread ──────────────────────────────────────────────────── */

export interface ThreadView {
  ref: string
  name: string
  phone: string
  source: 'quo' | 'recorded_inbound_only'
  complete: boolean
  messages: Array<{ at: string; direction: 'in' | 'out'; text: string; has_media?: boolean }>
  note?: string
}

const SMS_TEXT_CAP = 500

export async function getSmsThread(
  sb: Supa,
  ref: string,
  limit = 30,
): Promise<{ kind: 'ok'; thread: ThreadView } | { kind: 'absent' } | { kind: 'no_phone' } | { kind: 'unavailable' }> {
  const { data, error } = await sb.from('bookings').select('id, booking_ref, contact_name, contact_phone').eq('booking_ref', ref).maybeSingle()
  if (error) return { kind: 'unavailable' }
  if (!data) return { kind: 'absent' }
  const b = data as { id: string; booking_ref: string; contact_name: string | null; contact_phone: string | null }
  if (!b.contact_phone) return { kind: 'no_phone' }

  const base = { ref: b.booking_ref, name: b.contact_name ?? 'unknown', phone: maskPhone(b.contact_phone) }
  const quo = await fetchQuoThread(b.contact_phone, { limit })
  if (quo.kind === 'ok') {
    return {
      kind: 'ok',
      thread: {
        ...base, source: 'quo', complete: true,
        messages: quo.messages.map(m => ({
          at: m.at, direction: m.direction, text: m.text.slice(0, SMS_TEXT_CAP), ...(m.hasMedia ? { has_media: true } : {}),
        })),
      },
    }
  }

  // Quo unreachable: fall back to the inbound texts we recorded. Say plainly that
  // the thread is missing our side of it.
  const rec = await sb
    .from('ingested_messages')
    .select('body, sent_at, created_at')
    .eq('booking_id', b.id)
    .eq('source', 'quo')
    .eq('direction', 'in')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (rec.error) return { kind: 'unavailable' }
  const rows = ((rec.data ?? []) as Array<{ body: string | null; sent_at: string | null; created_at: string }>).reverse()
  return {
    kind: 'ok',
    thread: {
      ...base, source: 'recorded_inbound_only', complete: false,
      messages: rows.map(r => ({ at: r.sent_at ?? r.created_at, direction: 'in' as const, text: (r.body ?? '').slice(0, SMS_TEXT_CAP) })),
      note: 'Quo could not be read, so this shows only the texts the customer sent; replies from us are missing. Do not say a lead is unanswered from this.',
    },
  }
}

/* ── what to do next ──────────────────────────────────────────────────── */

export interface NextStepAction {
  /** What to do, in a manager's words. */
  do: string
  /** The assistant tool that prepares it (a propose_* tool shows a card; nothing is sent). */
  tool: string
  /** Arguments worth passing, as plain text. */
  how?: string
  why: string
}

export interface NextStep {
  ref: string
  name: string
  stage: BookingStage
  summary: string
  facts: string[]
  actions: NextStepAction[]
}


const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

export async function getNextStep(
  sb: Supa,
  ref: string,
  now: Date = new Date(),
): Promise<{ kind: 'ok'; step: NextStep } | { kind: 'absent' } | { kind: 'unavailable' }> {
  const { data, error } = await sb.from('bookings').select(LEAD_COLUMNS).eq('booking_ref', ref).maybeSingle()
  if (error) return { kind: 'unavailable' }
  if (!data) return { kind: 'absent' }
  const b = data as unknown as LeadBooking

  const pay = await sb.from('booking_payments').select('booking_id, amount_cents, payment_type').eq('booking_id', b.id)
  if (pay.error) return { kind: 'unavailable' }
  const paidCents = sumPayments((pay.data ?? []) as never)
  const stage = bookingStage({ status: b.status, paidCents, partyDate: b.party_date, today: etToday(now) })
  const touches = await touchesFor(sb, [b])
  if (!touches.ok) return { kind: 'unavailable' }
  const inb = touches.inbound.get(b.id)
  const out = touches.outbound.get(b.id)
  const waiting_on = inb && (!out || ms(inb.at) > ms(out.at)) ? 'us' : out ? 'them' : null
  const ago = (t?: Touch) => (t ? describeElapsed(Math.max(0, now.getTime() - ms(t.at))) : null)

  const facts = [
    `Stage: ${stage}${b.party_date ? ` · party ${b.party_date}` : ' · no date yet'}${b.guest_count_approx ? ` · ${b.guest_count_approx} guests` : ''}`,
    (b.total_cents ?? 0) > 0 ? `Priced: ${money(b.total_cents as number)}, paid ${money(paidCents)}` : 'Not priced yet',
    inb ? `They last wrote ${ago(inb)} ago (${inb.channel})` : 'No message from them on record',
    out ? `We last reached out ${ago(out)} ago (${out.channel})` : 'We have not reached out on record',
  ]

  const actions: NextStepAction[] = []
  const done = stage === 'cancelled' || stage === 'lost' || stage === 'completed'
  if (done) {
    return { kind: 'ok', step: { ref: b.booking_ref, name: b.contact_name ?? 'unknown', stage, summary: `${stage} — nothing to do.`, facts, actions } }
  }

  if (waiting_on === 'us') {
    actions.push({
      do: 'Answer what they last wrote',
      tool: 'get_sms_thread',
      how: `read the thread first (and get_first_inquiry for their original ask), then reply from the Quo app`,
      why: `They wrote ${ago(inb)} ago and nothing after it is on record from us.`,
    })
  }

  if (stage === 'inquiry' || !(b.total_cents && b.total_cents > 0)) {
    actions.push({
      do: 'Send the party planner link so they can choose a theme and see the price',
      tool: 'propose_send_client_links',
      how: `booking_ref ${b.booking_ref}, links ["planner"]`,
      why: 'The plan is not priced yet; the planner is how a lead becomes a quote.',
    })
  }

  if (b.party_type) {
    const photos = await findPhotos(sb, { partyType: b.party_type, limit: 3 })
    if (photos.kind === 'ok' && photos.data.length > 0) {
      actions.push({
        do: 'Send real photos from similar parties',
        tool: 'propose_send_photos',
        how: `booking_ref ${b.booking_ref}, party_type "${b.party_type}"`,
        why: 'Approved photos exist for their party type, and photos are the fastest way to answer "what is it like".',
      })
    }
  }

  if (stage === 'inquiry' || stage === 'quoted') {
    const ev = await sb.from('evites').select('archived_at').eq('booking_id', b.id).maybeSingle()
    if (!ev.error && ev.data && !(ev.data as { archived_at: string | null }).archived_at) {
      actions.push({
        do: 'Send a mock invitation: a preview of their theme with their child\'s details',
        tool: 'get_invitation',
        how: `read it for the link and the preview wording, then propose_send_client_links with links ["invite"] and that wording`,
        why: 'They already have an invitation preview, and seeing their own child\'s name on a design is a strong nudge to book.',
      })
    }
  }

  if ((b.total_cents ?? 0) > 0 && paidCents === 0) {
    actions.push({
      do: 'Send the invoice, and make a deposit payment link',
      tool: 'propose_send_client_links',
      how: `booking_ref ${b.booking_ref}, links ["invoice"]; then propose_pay_link purpose "deposit"`,
      why: `It is priced at ${money(b.total_cents as number)} and nothing is paid, so the next step is the deposit.`,
    })
  } else if ((b.total_cents ?? 0) > 0 && paidCents > 0 && paidCents < (b.total_cents as number)) {
    actions.push({
      do: 'Send the invoice or the balance payment link',
      tool: 'propose_pay_link',
      how: `booking_ref ${b.booking_ref}, purpose "balance"`,
      why: `${money((b.total_cents as number) - paidCents)} is still owed.`,
    })
  }

  if (stage === 'inquiry' || stage === 'quoted') {
    actions.push({
      do: 'Put them on a follow-up email sequence',
      tool: 'propose_enrol_sequence',
      how: `list_sequences for the ids, then booking_ref ${b.booking_ref} and the new_inquiry sequence. The card shows the first email and whether they have opted out`,
      why: 'A lead who goes quiet is better followed up on a schedule than remembered. Enrolling sends nothing today.',
    })
  }

  const summary =
    waiting_on === 'us'
      ? `They are waiting on a reply (${ago(inb)}).`
      : waiting_on === 'them'
        ? `We are waiting on them (we last reached out ${ago(out)} ago).`
        : 'No conversation on record yet.'
  return { kind: 'ok', step: { ref: b.booking_ref, name: b.contact_name ?? 'unknown', stage, summary, facts, actions } }
}

/* ── payments customers said they would send ──────────────────────────── */

export interface Pledge {
  ref: string
  name: string
  party_status: string | null
  amount_cents: number
  method: string
  pledged_ago: string
  /** A payment was written down on this booking AFTER the pledge - it has probably been reconciled. */
  payment_recorded_since: boolean
  total_cents: number | null
  paid_cents: number
}

/**
 * Pledges from the customer portal ("I will Venmo $250"), newest first. A pledge
 * is a CLAIM, not money: nothing is owed or paid because of it, and it never
 * changes a balance. It is reconciled by a person writing down the payment when
 * it actually arrives (propose_record_payment). Pledges on cancelled or lost
 * parties are left out.
 */
export async function listPledges(
  sb: Supa,
  now: Date = new Date(),
  days = 45,
): Promise<{ kind: 'ok'; pledges: Pledge[] } | { kind: 'unavailable' }> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString()
  const mods = await sb
    .from('booking_modifications')
    .select('booking_id, change_summary, new_data, created_at')
    .ilike('change_summary', 'Customer pledged%')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(60)
  if (mods.error) return { kind: 'unavailable' }
  const rows = (mods.data ?? []) as Array<{ booking_id: string; new_data: { amount_cents?: number; method?: string } | null; created_at: string }>
  if (rows.length === 0) return { kind: 'ok', pledges: [] }

  const ids = Array.from(new Set(rows.map(r => r.booking_id)))
  const [bks, pays] = await Promise.all([
    sb.from('bookings').select('id, booking_ref, contact_name, status, total_cents').in('id', ids),
    sb.from('booking_payments').select('booking_id, amount_cents, payment_type, paid_at').in('booking_id', ids),
  ])
  if (bks.error || pays.error) return { kind: 'unavailable' }
  const bookingBy = new Map(((bks.data ?? []) as Array<{ id: string; booking_ref: string; contact_name: string | null; status: string | null; total_cents: number | null }>).map(b => [b.id, b]))
  const paysBy = new Map<string, Array<{ amount_cents: number; payment_type: string; paid_at: string | null }>>()
  for (const p of (pays.data ?? []) as Array<{ booking_id: string; amount_cents: number; payment_type: string; paid_at: string | null }>) {
    paysBy.set(p.booking_id, [...(paysBy.get(p.booking_id) ?? []), p])
  }

  const out: Pledge[] = []
  for (const r of rows) {
    const b = bookingBy.get(r.booking_id)
    if (!b || b.status === 'cancelled' || b.status === 'lost') continue
    const payments = paysBy.get(b.id) ?? []
    out.push({
      ref: b.booking_ref,
      name: b.contact_name ?? 'unknown',
      party_status: b.status,
      amount_cents: Number(r.new_data?.amount_cents) || 0,
      method: String(r.new_data?.method ?? 'unknown'),
      pledged_ago: describeElapsed(Math.max(0, now.getTime() - ms(r.created_at))),
      payment_recorded_since: payments.some(p => p.payment_type !== 'refund' && !!p.paid_at && ms(p.paid_at) >= ms(r.created_at)),
      total_cents: b.total_cents,
      paid_cents: sumPayments(payments as never),
    })
  }
  return { kind: 'ok', pledges: out }
}
