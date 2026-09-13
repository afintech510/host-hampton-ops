import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { contactSearchFilter } from '@/lib/contactLookup'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const { searchParams } = req.nextUrl
  const status = searchParams.get('status')
  const optIn = searchParams.get('opt_in') // 'email' | 'sms'
  const search = searchParams.get('search')?.toLowerCase()
  const limit = parseInt(searchParams.get('limit') || '50', 10)
  const offset = parseInt(searchParams.get('offset') || '0', 10)

  let query = supabase
    .from('contacts')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)
  if (optIn === 'email') query = query.eq('email_opt_in', true)
  if (optIn === 'sms') query = query.eq('sms_opt_in', true)
  if (search) {
    // `.or()` takes a RAW PostgREST filter expression (AGENTS.md §11), so the
    // search box used to be able to rewrite its own filter: a comma starts a
    // new disjunct and a `)` closes the group. It is admin-only, which bounds
    // the damage but does not make it correct — and `%`/`_` in a search term
    // were silently wildcards either way. The term is escaped for both.
    query = query.or(contactSearchFilter(search))
  }

  const { data: contacts, count, error } = await query

  if (error) {
    console.error('admin:contacts error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const [{ count: emailOptInCount }, { count: smsOptInCount }] = await Promise.all([
    supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('email_opt_in', true),
    supabase.from('contacts').select('*', { count: 'exact', head: true }).eq('sms_opt_in', true),
  ])

  return NextResponse.json({
    contacts: contacts || [],
    total: count || 0,
    emailOptInCount: emailOptInCount || 0,
    smsOptInCount: smsOptInCount || 0,
  })
}
