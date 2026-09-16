/**
 * The Venmo reconciliation queue: what arrived, and what to do about it.
 *
 * GET  — the proposals the agent has parsed out of the mailbox, newest first.
 * POST — a human's ruling on one:
 *          { id, action: 'record', … }  → tickets + books + inventory + email
 *          { id, action: 'ignore', note } → it was not a ticket, say why
 *
 * `record` is the only path in this codebase that issues a ticket for money
 * that did not come through Stripe (see `lib/offlineTicket.ts`). It is behind
 * the admin auth every other admin route uses, and it refuses to run twice on
 * the same proposal.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { issueOfflineTickets, seatTotalCents, type OfflineMethod } from '@/lib/offlineTicket'
import { VENMO_PAYMENT_COLUMNS, type VenmoPaymentRow } from '@/lib/venmoReconcile'
import type { SeatLine } from '@/lib/venmoReceipt'

export const dynamic = 'force-dynamic'

const ALLOWED_STATUS = new Set(['pending', 'recorded', 'ignored'])

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const status = req.nextUrl.searchParams.get('status') || 'pending'
  if (!ALLOWED_STATUS.has(status) && status !== 'all') {
    return NextResponse.json({ error: `unknown status "${status}"` }, { status: 400 })
  }
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 50) || 50, 200)

  const supabase = getSupabase()
  let query = supabase
    .from('venmo_payments')
    .select(VENMO_PAYMENT_COLUMNS)
    .order('paid_at', { ascending: false })
    .limit(limit)
  if (status !== 'all') query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const payments = (data ?? []) as unknown as VenmoPaymentRow[]
  // The suggested event's title, so the queue is readable without a join per
  // row in the browser.
  const eventIds = Array.from(new Set(payments.map(p => p.suggested_event_id).filter(Boolean))) as string[]
  let titles: Record<string, { title: string; event_date: string; available_tickets: number | null }> = {}
  if (eventIds.length) {
    const { data: evts } = await supabase
      .from('events')
      .select('id, title, event_date, available_tickets')
      .in('id', eventIds)
    titles = Object.fromEntries(
      (evts ?? []).map(e => [
        String(e.id),
        { title: String(e.title), event_date: String(e.event_date), available_tickets: e.available_tickets as number | null },
      ]),
    )
  }

  return NextResponse.json({
    payments: payments.map(p => ({
      ...p,
      suggested_event: p.suggested_event_id ? titles[p.suggested_event_id] ?? null : null,
    })),
    total: payments.length,
  })
}

interface RecordBody {
  id?: string
  action?: 'record' | 'ignore'
  eventId?: string
  customerName?: string
  customerEmail?: string
  customerPhone?: string | null
  seats?: SeatLine[]
  method?: OfflineMethod
  sendConfirmation?: boolean
  note?: string
}

function validSeats(seats: unknown): seats is SeatLine[] {
  return (
    Array.isArray(seats) &&
    seats.length > 0 &&
    seats.every(
      s =>
        s &&
        typeof s === 'object' &&
        Number.isInteger((s as SeatLine).unitPriceCents) &&
        (s as SeatLine).unitPriceCents >= 0 &&
        Number.isInteger((s as SeatLine).quantity) &&
        (s as SeatLine).quantity > 0 &&
        (s as SeatLine).quantity <= 20,
    )
  )
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const body = (await req.json().catch(() => ({}))) as RecordBody
  const { id, action } = body
  if (!id || (action !== 'record' && action !== 'ignore')) {
    return NextResponse.json({ error: 'id and action ("record" | "ignore") are required' }, { status: 400 })
  }

  const supabase = getSupabase()
  const { data: raw, error: readErr } = await supabase
    .from('venmo_payments')
    .select(VENMO_PAYMENT_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!raw) return NextResponse.json({ error: 'no such payment' }, { status: 404 })
  const payment = raw as unknown as VenmoPaymentRow
  if (payment.status !== 'pending') {
    // Already ruled on. Answering 409 rather than re-running is the whole point:
    // the expensive half of `record` is a live confirmation email and a real
    // inventory decrement.
    return NextResponse.json(
      { error: `payment is already ${payment.status}`, payment },
      { status: 409 },
    )
  }

  if (action === 'ignore') {
    const { error } = await supabase
      .from('venmo_payments')
      .update({
        status: 'ignored',
        resolved_at: new Date().toISOString(),
        resolved_by: 'admin',
        resolution_note: body.note || null,
      })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, status: 'ignored' })
  }

  // ── record ────────────────────────────────────────────────────────
  const eventId = body.eventId || payment.suggested_event_id
  const seats = validSeats(body.seats) ? body.seats : payment.suggested_seats
  const customerEmail = (body.customerEmail || '').trim()
  const customerName = (body.customerName || String(payment.payer_name || '')).trim()

  if (!eventId) return NextResponse.json({ error: 'eventId is required (the proposal has no suggested event)' }, { status: 400 })
  if (!validSeats(seats)) return NextResponse.json({ error: 'seats are required (the proposal could not work them out)' }, { status: 400 })
  if (!customerEmail) return NextResponse.json({ error: 'customerEmail is required — it is the ticket holder, not the Venmo handle' }, { status: 400 })
  if (!customerName) return NextResponse.json({ error: 'customerName is required' }, { status: 400 })

  // The seats must add up to the money that actually arrived. Without this the
  // books and the roster can disagree by a silent typo, which is the exact
  // class of bug this whole surface exists to end.
  const seatTotal = seatTotalCents(seats)
  if (seatTotal !== Number(payment.amount_cents)) {
    return NextResponse.json(
      {
        error:
          `seats total ${seatTotal} cents but the payment was ${payment.amount_cents} cents. ` +
          'Adjust the seats, or ignore this payment and record it by hand if it is a partial.',
      },
      { status: 400 },
    )
  }

  const paidOn = String(payment.paid_at).split('T')[0]
  const result = await issueOfflineTickets(supabase, {
    eventId,
    customerName,
    customerEmail,
    customerPhone: body.customerPhone ?? null,
    seats,
    method: body.method || 'venmo',
    paidOn,
    groupRef: `VENMO-${String(payment.id).slice(0, 8)}`,
    notes:
      `Venmo ${(Number(payment.amount_cents) / 100).toFixed(2)} from ${payment.payer_name} on ${paidOn}` +
      `${payment.note ? ` (note: ${payment.note})` : ''}. Accepted from the reconciliation queue.`,
    sendConfirmation: body.sendConfirmation !== false,
  })

  if (!result.ok) {
    // The proposal stays PENDING. A failed issue must remain in the queue —
    // marking it recorded here is how a customer who paid ends up with nothing
    // and no trace of why.
    return NextResponse.json({ error: result.error, steps: result.steps }, { status: 500 })
  }

  const { error: updErr } = await supabase
    .from('venmo_payments')
    .update({
      status: 'recorded',
      resolved_at: new Date().toISOString(),
      resolved_by: 'admin',
      resolution_note: body.note || null,
      suggested_event_id: eventId,
      ticket_refs: result.ticketRefs,
    })
    .eq('id', id)
  if (updErr) {
    // The tickets exist. Say loudly that the queue row did not move, because the
    // next click would otherwise issue them a second time.
    console.error(`venmo payment ${id}: tickets ${result.ticketRefs.join(', ')} issued but the row stayed pending —`, updErr.message)
    return NextResponse.json(
      { ...result, warning: `tickets issued (${result.ticketRefs.join(', ')}) but this payment is still pending: ${updErr.message}` },
      { status: 200 },
    )
  }

  return NextResponse.json({ ...result, status: 'recorded' })
}
