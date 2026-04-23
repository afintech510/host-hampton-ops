import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabase()
  const status = req.nextUrl.searchParams.get('status')
  const page = parseInt(req.nextUrl.searchParams.get('page') || '1', 10)
  const limit = 25

  let query = supabase
    .from('bookings')
    .select('id, booking_ref, status, event_type, party_date, party_time, package_type, guest_count_approx, child_name, contact_name, contact_email, contact_phone, total_cents, balance_due_cents, payment_method_preference, approved_at, paid_in_full_at, created_at', { count: 'exact' })
    .in('event_type', ['kid-party', 'kids-party', 'kids_party'])
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ bookings: data || [], total: count || 0, page, limit })
}
