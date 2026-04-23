import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return secret === process.env.CRON_SECRET
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabase()
  const today = new Date().toISOString().split('T')[0]

  // Find approved bookings where modification_cutoff <= today
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, booking_ref, modification_cutoff, contact_email, contact_name')
    .eq('status', 'approved')
    .lte('modification_cutoff', today)

  if (error) {
    console.error('cron:booking-locks fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!bookings || bookings.length === 0) {
    return NextResponse.json({ locked: 0 })
  }

  let locked = 0

  for (const booking of bookings) {
    const { error: updateErr } = await supabase
      .from('bookings')
      .update({
        status: 'modifications_locked',
        updated_at: new Date().toISOString(),
      })
      .eq('id', booking.id)

    if (updateErr) {
      console.error(`Failed to lock ${booking.booking_ref}:`, updateErr)
      continue
    }

    await supabase.from('booking_modifications').insert({
      booking_id: booking.id,
      modified_by: 'system',
      change_summary: 'Modifications locked (T-14 cutoff reached)',
    })

    locked++
    console.log(`Locked modifications for ${booking.booking_ref}`)
  }

  console.log(`cron:booking-locks locked ${locked} bookings`)
  return NextResponse.json({ locked, checked: bookings.length })
}
