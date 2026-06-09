import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const status = req.nextUrl.searchParams.get('status')
  const past = req.nextUrl.searchParams.get('past') === 'true'
  const photoFilter = req.nextUrl.searchParams.get('photos') // 'missing' | 'set' | null
  const page = parseInt(req.nextUrl.searchParams.get('page') || '1', 10)
  const limit = 25

  let query = supabase
    .from('bookings')
    .select('id, booking_ref, status, event_type, party_date, party_time, package_type, guest_count_approx, child_name, contact_name, contact_email, contact_phone, total_cents, balance_due_cents, payment_method_preference, approved_at, paid_in_full_at, photo_gallery_url, created_at', { count: 'exact' })
    .in('event_type', ['kid-party', 'kids-party', 'kids_party', 'studio-rental'])
    .range((page - 1) * limit, page * limit - 1)

  if (past) {
    // Photo backfill view: parties whose date has passed, most recent first
    const today = new Date().toISOString().split('T')[0]
    query = query.lt('party_date', today).order('party_date', { ascending: false })
  } else {
    query = query.order('created_at', { ascending: false })
  }

  if (status) {
    query = query.eq('status', status)
  }

  if (photoFilter === 'missing') {
    query = query.is('photo_gallery_url', null)
  } else if (photoFilter === 'set') {
    query = query.not('photo_gallery_url', 'is', null)
  }

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ bookings: data || [], total: count || 0, page, limit })
}
