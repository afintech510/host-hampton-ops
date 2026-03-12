import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

interface UnifiedOrder {
  id: string
  order_ref: string
  order_type: 'booking' | 'ticket'
  customer_name: string
  customer_email: string
  customer_phone: string | null
  amount_cents: number
  status: string
  event_title: string
  event_date: string | null
  event_time: string | null
  stripe_payment_intent_id: string | null
  created_at: string
  // Booking-specific
  package_type?: string | null
  child_name?: string | null
  child_age?: number | null
  guest_count?: number | null
  event_type?: string | null
  notes?: string | null
  // Ticket-specific
  quantity?: number
  variant_label?: string | null
  session_id?: string | null
  unit_price_cents?: number
  group_ref?: string | null
  refund_amount_cents?: number | null
  refund_reason?: string | null
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const { searchParams } = req.nextUrl
  const typeFilter = searchParams.get('type') // 'booking' | 'ticket' | null (all)
  const statusFilter = searchParams.get('status')
  const search = searchParams.get('search')?.toLowerCase()

  const orders: UnifiedOrder[] = []

  // Fetch bookings
  if (!typeFilter || typeFilter === 'booking') {
    const { data: bookings } = await supabase
      .from('bookings')
      .select('*')
      .order('created_at', { ascending: false })

    if (bookings) {
      for (const b of bookings) {
        const eventTypeDisplay = (b.event_type || 'Party')
          .split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

        orders.push({
          id: b.id,
          order_ref: b.booking_ref,
          order_type: 'booking',
          customer_name: b.contact_name,
          customer_email: b.contact_email,
          customer_phone: b.contact_phone || null,
          amount_cents: b.deposit_amount || 0,
          status: b.status,
          event_title: eventTypeDisplay,
          event_date: b.party_date,
          event_time: b.party_time || null,
          stripe_payment_intent_id: b.stripe_payment_intent_id || null,
          created_at: b.created_at,
          package_type: b.package_type,
          child_name: b.child_name,
          child_age: b.child_age,
          guest_count: b.guest_count_approx,
          event_type: b.event_type,
          notes: b.notes,
          refund_amount_cents: b.refund_amount_cents || null,
          refund_reason: b.refund_reason || null,
        })
      }
    }
  }

  // Fetch tickets with event info
  if (!typeFilter || typeFilter === 'ticket') {
    const { data: tickets } = await supabase
      .from('event_tickets')
      .select('*, events(title, event_date, event_time, location)')
      .order('created_at', { ascending: false })

    if (tickets) {
      for (const t of tickets) {
        const evt = (t as any).events
        orders.push({
          id: t.id,
          order_ref: t.ticket_ref,
          order_type: 'ticket',
          customer_name: t.customer_name,
          customer_email: t.customer_email,
          customer_phone: t.customer_phone || null,
          amount_cents: t.total_cents,
          status: t.status,
          event_title: evt?.title || 'Event',
          event_date: evt?.event_date || null,
          event_time: evt?.event_time || null,
          stripe_payment_intent_id: t.stripe_payment_intent_id || null,
          created_at: t.created_at,
          quantity: t.quantity,
          variant_label: t.variant_label,
          session_id: t.session_id,
          unit_price_cents: t.unit_price_cents,
          group_ref: t.group_ref,
          refund_amount_cents: t.refund_amount_cents || null,
          refund_reason: t.refund_reason || null,
        })
      }
    }
  }

  // Apply status filter
  let filtered = orders
  if (statusFilter) {
    filtered = filtered.filter(o => o.status === statusFilter)
  }

  // Apply search
  if (search) {
    filtered = filtered.filter(o =>
      o.customer_name.toLowerCase().includes(search) ||
      o.customer_email.toLowerCase().includes(search) ||
      o.order_ref.toLowerCase().includes(search) ||
      o.event_title.toLowerCase().includes(search)
    )
  }

  // Sort by created_at desc
  filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return NextResponse.json({ orders: filtered })
}
