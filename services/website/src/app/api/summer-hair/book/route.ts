import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { getSupabase } from '@/lib/supabase'
import { sendSMS } from '@/lib/twilio'
import { summerHairConfirmationHtml, summerHairAdminNotifyHtml } from '@/lib/email-templates/summer-hair'

export const dynamic = 'force-dynamic'

const ALLIE_EMAIL = 'allie@hosthampton.com'
const ALLIE_PHONE = '+16315992469'

const VALID_SERVICES = [
  'Hair Tinsel',
  'Hair Wraps',
  'Hair Wraps + Charms',
  'Hair Glitter',
  'Glitter Freckles',
]

const TIME_SLOTS = Array.from({ length: 18 }, (_, i) => {
  const totalMin = 9 * 60 + i * 20
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`
})

export async function GET() {
  const supabase = getSupabase()

  const { data: bookings } = await supabase
    .from('summer_hair_bookings')
    .select('time_slot')
    .eq('status', 'confirmed')

  const taken = new Set((bookings || []).map(b => b.time_slot))
  const slots = TIME_SLOTS.map(s => ({ time: s, available: !taken.has(s) }))

  return NextResponse.json({ slots })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, email, phone, timeSlot, services, partySize, notes } = body

  if (!name || !email || !phone || !timeSlot || !services?.length || !partySize) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
  }

  if (!TIME_SLOTS.includes(timeSlot)) {
    return NextResponse.json({ error: 'Invalid time slot' }, { status: 400 })
  }

  for (const s of services) {
    if (!VALID_SERVICES.includes(s)) {
      return NextResponse.json({ error: `Invalid service: ${s}` }, { status: 400 })
    }
  }

  if (partySize < 1 || partySize > 10) {
    return NextResponse.json({ error: 'Party size must be 1-10' }, { status: 400 })
  }

  const supabase = getSupabase()

  // Check slot availability
  const { data: existing } = await supabase
    .from('summer_hair_bookings')
    .select('id')
    .eq('time_slot', timeSlot)
    .eq('status', 'confirmed')

  if (existing && existing.length > 0) {
    return NextResponse.json({ error: 'That time slot is no longer available' }, { status: 409 })
  }

  // Insert booking
  const { data: booking, error } = await supabase
    .from('summer_hair_bookings')
    .insert({
      name,
      email,
      phone,
      time_slot: timeSlot,
      services,
      party_size: partySize,
      notes: notes || null,
      status: 'confirmed',
    })
    .select()
    .single()

  if (error) {
    console.error('summer-hair booking insert error:', error)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }

  // Calculate estimated total
  const priceMap: Record<string, number> = {
    'Hair Tinsel': 15,
    'Hair Wraps': 35,
    'Hair Wraps + Charms': 38,
    'Hair Glitter': 5,
    'Glitter Freckles': 10,
  }
  const perPersonTotal = services.reduce((sum: number, s: string) => sum + (priceMap[s] || 0), 0)
  const estimatedTotal = perPersonTotal * partySize

  // Send notifications (non-blocking)
  const notifyPromises: Promise<unknown>[] = []

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

    // Admin notification to Allie
    notifyPromises.push(
      resend.emails.send({
        from,
        to: ALLIE_EMAIL,
        subject: `Summer Hair Booking: ${name} at ${timeSlot}`,
        replyTo: email,
        html: summerHairAdminNotifyHtml({
          name, email, phone, timeSlot, services, partySize, notes, estimatedTotal,
        }),
      })
    )

    // Customer confirmation
    notifyPromises.push(
      resend.emails.send({
        from,
        to: email,
        subject: "You're booked — Summer Hair at Host Hampton!",
        html: summerHairConfirmationHtml({
          name, timeSlot, services, partySize, estimatedTotal,
        }),
      })
    )
  }

  // SMS to Allie
  const serviceList = services.join(', ')
  const smsBody = `New Summer Hair booking!\n${name} at ${timeSlot}\n${partySize} ${partySize === 1 ? 'person' : 'people'}\nServices: ${serviceList}\nEst. total: $${estimatedTotal}\nPhone: ${phone}`

  notifyPromises.push(
    sendSMS(ALLIE_PHONE, smsBody).catch(err => console.error('SMS to Allie failed (non-fatal):', err))
  )

  await Promise.allSettled(notifyPromises)

  return NextResponse.json({ success: true, bookingId: booking.id })
}
