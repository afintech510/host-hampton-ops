import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { getSupabase } from '@/lib/supabase'
import { sendSMSVia, normalizePhone } from '@/lib/sms'
import { notifyOwnerSms } from '@/lib/ownerNotify'
import { summerHairConfirmationHtml, summerHairAdminNotifyHtml } from '@/lib/email-templates/summer-hair'

export const dynamic = 'force-dynamic'

const ALLIE_EMAIL = 'allie@hosthampton.com'

const VALID_SERVICES = [
  'Hair Tinsel',
  'Hair Wraps',
  'Hair Wraps + Charms',
  'Hair Glitter',
  'Glitter Freckles',
]

const WRAP_SERVICES = ['Hair Wraps', 'Hair Wraps + Charms']
const QUICK_SERVICES = ['Hair Tinsel', 'Hair Glitter', 'Glitter Freckles']

const TIME_SLOTS = Array.from({ length: 18 }, (_, i) => {
  const totalMin = 9 * 60 + i * 20
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`
})

function calcSlotsNeeded(services: string[], partySize: number): number {
  const hasWraps = services.some(s => WRAP_SERVICES.includes(s))
  const hasQuick = services.some(s => QUICK_SERVICES.includes(s))

  if (hasWraps) {
    // Wraps: 1 slot per person (20 min each). Quick services fit within wrap time.
    return partySize
  }
  if (hasQuick) {
    // Quick only: 4 people per 20-min slot
    return Math.ceil(partySize / 4)
  }
  return 1
}

function getOccupiedSlotIndices(startIndex: number, slotsNeeded: number): number[] {
  return Array.from({ length: slotsNeeded }, (_, i) => startIndex + i)
}

export async function GET(req: NextRequest) {
  const supabase = getSupabase()

  const url = new URL(req.url)
  const services = url.searchParams.getAll('service')
  const partySize = parseInt(url.searchParams.get('partySize') || '1', 10)
  const slotsNeeded = services.length > 0 ? calcSlotsNeeded(services, partySize) : 1

  const { data: bookings } = await supabase
    .from('summer_hair_bookings')
    .select('time_slot, slots_needed')
    .eq('status', 'confirmed')

  // Build set of all occupied slot indices
  const occupied = new Set<number>()
  for (const b of bookings || []) {
    const idx = TIME_SLOTS.indexOf(b.time_slot)
    if (idx >= 0) {
      for (const i of getOccupiedSlotIndices(idx, b.slots_needed || 1)) {
        occupied.add(i)
      }
    }
  }

  // A start time is available if all N consecutive slots from it are free and within bounds
  const slots = TIME_SLOTS.map((time, idx) => {
    const endIdx = idx + slotsNeeded - 1
    if (endIdx >= TIME_SLOTS.length) return { time, available: false }
    const needed = getOccupiedSlotIndices(idx, slotsNeeded)
    const available = needed.every(i => !occupied.has(i))
    return { time, available }
  })

  return NextResponse.json({ slots, slotsNeeded })
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

  const slotsNeeded = calcSlotsNeeded(services, partySize)
  const startIdx = TIME_SLOTS.indexOf(timeSlot)
  const endIdx = startIdx + slotsNeeded - 1

  if (endIdx >= TIME_SLOTS.length) {
    return NextResponse.json({ error: 'Not enough time before closing for this booking' }, { status: 400 })
  }

  const supabase = getSupabase()

  // Check all needed slots are free
  const { data: existing } = await supabase
    .from('summer_hair_bookings')
    .select('time_slot, slots_needed')
    .eq('status', 'confirmed')

  const occupied = new Set<number>()
  for (const b of existing || []) {
    const idx = TIME_SLOTS.indexOf(b.time_slot)
    if (idx >= 0) {
      for (const i of getOccupiedSlotIndices(idx, b.slots_needed || 1)) {
        occupied.add(i)
      }
    }
  }

  const neededIndices = getOccupiedSlotIndices(startIdx, slotsNeeded)
  if (neededIndices.some(i => occupied.has(i))) {
    return NextResponse.json({ error: 'One or more of those time slots is no longer available' }, { status: 409 })
  }

  const endTime = TIME_SLOTS[endIdx]
  const duration = `${timeSlot} – ${endIdx + 1 < TIME_SLOTS.length ? TIME_SLOTS[endIdx + 1] : '3:00 PM'}`

  // Insert booking
  const { data: booking, error } = await supabase
    .from('summer_hair_bookings')
    .insert({
      name,
      email,
      phone,
      time_slot: timeSlot,
      slots_needed: slotsNeeded,
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

    notifyPromises.push(
      resend.emails.send({
        from,
        to: ALLIE_EMAIL,
        subject: `Summer Hair Booking: ${name} at ${timeSlot}`,
        replyTo: email,
        html: summerHairAdminNotifyHtml({
          name, email, phone, timeSlot, services, partySize, notes, estimatedTotal, duration,
        }),
      })
    )

    notifyPromises.push(
      resend.emails.send({
        from,
        to: email,
        subject: "You're booked — Summer Hair at Host Hampton!",
        html: summerHairConfirmationHtml({
          name, timeSlot, services, partySize, estimatedTotal, duration,
        }),
      })
    )
  }

  const serviceList = services.join(', ')
  const firstName = name.split(' ')[0]

  // SMS to the reviewers (REVIEWER_PHONES)
  const adminSms = `New Summer Hair booking!\n${name} — ${duration}\n${partySize} ${partySize === 1 ? 'person' : 'people'} (${slotsNeeded} slots)\nServices: ${serviceList}\nEst. total: $${estimatedTotal}\nPhone: ${phone}`
  notifyPromises.push(
    notifyOwnerSms(adminSms).catch(err => console.error('SMS to reviewers failed (non-fatal):', err))
  )

  // Confirmation SMS to client
  const normalizedPhone = normalizePhone(phone)
  const clientSms = `Hi ${firstName}! You're booked for Summer Hair at Host Hampton on July 3rd, ${duration}.\n\nServices: ${serviceList}\nEst. total: $${estimatedTotal} (pay in person)\n\nSee you there! ✨`
  notifyPromises.push(
    sendSMSVia('quo', normalizedPhone, clientSms).catch(err => console.error('SMS to client failed (non-fatal):', err))
  )

  await Promise.allSettled(notifyPromises)

  return NextResponse.json({ success: true, bookingId: booking.id, duration })
}
