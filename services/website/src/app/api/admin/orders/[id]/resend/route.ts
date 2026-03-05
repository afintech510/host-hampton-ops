import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { Resend } from 'resend'
import { ticketConfirmationHtml, bookingConfirmationHtml } from '@/lib/emailTemplates'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const body = await req.json()
  const { order_type } = body

  if (!order_type || !['booking', 'ticket'].includes(order_type)) {
    return NextResponse.json({ error: 'Invalid order_type' }, { status: 400 })
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email not configured' }, { status: 500 })
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

  if (order_type === 'ticket') {
    const { data: ticket } = await supabase
      .from('event_tickets')
      .select('*, events(title, event_date, event_time, location)')
      .eq('id', params.id)
      .single()

    if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })

    const evt = (ticket as any).events
    const dateDisplay = evt?.event_date
      ? new Date(evt.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : 'TBD'

    const isFree = ticket.total_cents === 0
    const totalFormatted = isFree ? 'Free' : `$${(ticket.total_cents / 100).toFixed(2)}`

    await resend.emails.send({
      from,
      to: ticket.customer_email,
      subject: `You're in! ${evt?.title || 'Event'} at Host Hampton`,
      html: ticketConfirmationHtml({
        customerName: ticket.customer_name,
        eventTitle: evt?.title || 'Event',
        eventDate: dateDisplay,
        eventTime: evt?.event_time || '',
        location: evt?.location || 'Host Hampton',
        quantity: ticket.quantity,
        variantLabel: ticket.variant_label,
        totalFormatted,
        ticketRef: ticket.ticket_ref,
        isFree,
      }),
    })

    return NextResponse.json({ sent: true })
  }

  // Booking resend
  const { data: booking } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  const dateFormatted = booking.party_date
    ? new Date(booking.party_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : 'TBD'

  const balanceDueDate = booking.party_date
    ? new Date(new Date(booking.party_date + 'T12:00:00').getTime() - 48 * 60 * 60 * 1000)
        .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : 'day of your event'

  const depositFormatted = `$${(booking.deposit_amount || 0).toFixed(2)}`
  const isRoomRental = (booking.event_type || '').includes('room-rental')
  const eventTypeDisplay = (booking.event_type || 'Party')
    .split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

  await resend.emails.send({
    from,
    to: booking.contact_email,
    subject: `You're booked! ${dateFormatted} at Host Hampton`,
    html: bookingConfirmationHtml({
      customerName: booking.contact_name,
      bookingRef: booking.booking_ref,
      dateFormatted,
      partyTime: booking.party_time || 'TBD',
      eventTypeDisplay,
      depositFormatted,
      packageName: booking.package_type,
      childName: booking.child_name,
      childAge: booking.child_age ? String(booking.child_age) : undefined,
      guestCount: booking.guest_count_approx ? String(booking.guest_count_approx) : undefined,
      notes: booking.notes,
      isRoomRental,
      balanceDueDate,
    }),
  })

  return NextResponse.json({ sent: true })
}
