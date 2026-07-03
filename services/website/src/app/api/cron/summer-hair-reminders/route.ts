import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { sendSMS, normalizePhone } from '@/lib/twilio'

export const dynamic = 'force-dynamic'

const TIME_SLOTS = Array.from({ length: 18 }, (_, i) => {
  const totalMin = 9 * 60 + i * 20
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`
})

function slotToMinutesSinceMidnight(slot: string): number {
  const idx = TIME_SLOTS.indexOf(slot)
  if (idx < 0) return -1
  return 9 * 60 + idx * 20
}

function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return secret === process.env.CRON_SECRET
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabase()

  // Only run on July 3, 2026 (ET)
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const dateStr = `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-${String(et.getDate()).padStart(2, '0')}`

  if (dateStr !== '2026-07-03') {
    return NextResponse.json({ message: 'Not event day', sent: 0 })
  }

  const currentMinutes = et.getHours() * 60 + et.getMinutes()

  // Fetch confirmed bookings that haven't had a reminder sent
  const { data: bookings, error } = await supabase
    .from('summer_hair_bookings')
    .select('id, name, phone, time_slot, services, party_size')
    .eq('status', 'confirmed')
    .eq('reminder_sent', false)

  if (error) {
    console.error('cron:summer-hair-reminders fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 })
  }

  if (!bookings?.length) {
    return NextResponse.json({ message: 'No reminders to send', sent: 0 })
  }

  let sent = 0
  const sentIds: string[] = []

  for (const b of bookings) {
    const slotMinutes = slotToMinutesSinceMidnight(b.time_slot)
    if (slotMinutes < 0) continue

    // Send reminder when we're within 60-75 min before the slot
    // (cron runs every 15 min, so this window catches each slot once)
    const minutesUntil = slotMinutes - currentMinutes
    if (minutesUntil > 75 || minutesUntil < 0) continue

    const firstName = (b.name || 'there').split(' ')[0]
    const serviceList = (b.services || []).join(', ')

    const sms = `Hi ${firstName}! Reminder: your Summer Hair appointment at Host Hampton is in about 1 hour (${b.time_slot}).\n\nServices: ${serviceList}\nParty size: ${b.party_size}\n\nSee you soon! ✨`

    const sid = await sendSMS(normalizePhone(b.phone), sms)
    if (sid) {
      sent++
      sentIds.push(b.id)
    }
  }

  // Mark reminders as sent
  if (sentIds.length > 0) {
    await supabase
      .from('summer_hair_bookings')
      .update({ reminder_sent: true })
      .in('id', sentIds)
  }

  console.log(`cron:summer-hair-reminders sent ${sent} reminder(s)`)

  return NextResponse.json({ sent, total: bookings.length })
}
