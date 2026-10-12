/**
 * The job application book — GET, newest first.
 *
 * Copied from `/api/admin/market-vendors`: `isAdminAuthorized` and nothing else,
 * and an explicit column list rather than `select('*')`, so a column added by a
 * future migration stays private until somebody decides otherwise.
 *
 * Filters: `role` (lead | helper | either — an "lead" filter also returns
 * "either", because an Either applicant IS a Lead candidate), `weekend`
 * (every | most | occasional), `car` (yes | no), `status`. An unknown filter
 * value is a 400, not a silent read of everything: a typo must not quietly widen
 * the result set.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { APPLICATION_STATUSES, ROLE_INTERESTS, WEEKEND_OPTIONS } from '@/lib/careers'

export const dynamic = 'force-dynamic'

const APPLICATION_COLUMNS = [
  'id',
  'application_ref',
  'role_interest',
  'name',
  'email',
  'phone',
  'weekend_availability',
  'weekday_availability',
  'has_car',
  'heard_about',
  'heard_about_detail',
  'why_us',
  'hospitality_experience',
  'lead_comfort_rating',
  'decorating_experience',
  'balloon_experience',
  'portfolio_url',
  'kids_experience',
  'activity_comfort_rating',
  'crafts_experience',
  'braiding_experience',
  'tinsel_experience',
  'nails_experience',
  'will_learn_beauty',
  'status',
  'admin_notes',
  'reviewed_at',
  'created_at',
].join(', ')

interface ApplicationRow {
  status: string
  role_interest: string
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const url = new URL(req.url)
  const role = url.searchParams.get('role')
  const weekend = url.searchParams.get('weekend')
  const car = url.searchParams.get('car')
  const status = url.searchParams.get('status')

  if (role && !(ROLE_INTERESTS as readonly string[]).includes(role)) {
    return NextResponse.json({ error: `Unknown role "${role}"` }, { status: 400 })
  }
  if (weekend && !WEEKEND_OPTIONS.some(o => o.value === weekend)) {
    return NextResponse.json({ error: `Unknown weekend availability "${weekend}"` }, { status: 400 })
  }
  if (car && car !== 'yes' && car !== 'no') {
    return NextResponse.json({ error: 'car must be yes or no' }, { status: 400 })
  }
  if (status && !(APPLICATION_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: `Unknown status "${status}"` }, { status: 400 })
  }

  let query = getSupabase()
    .from('job_applications')
    .select(APPLICATION_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(500)

  if (role === 'either') query = query.eq('role_interest', 'either')
  else if (role) query = query.in('role_interest', [role, 'either'])
  if (weekend) query = query.eq('weekend_availability', weekend)
  if (car) query = query.eq('has_car', car === 'yes')
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) {
    console.error('admin applications read failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as ApplicationRow[]
  return NextResponse.json({
    applications: rows,
    stats: {
      total: rows.length,
      new: rows.filter(r => r.status === 'new').length,
      interviewing: rows.filter(r => r.status === 'interviewing').length,
      hired: rows.filter(r => r.status === 'hired').length,
    },
  })
}
