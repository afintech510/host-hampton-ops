import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('party_themes')
    .select('*')
    .order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ themes: data || [] })
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()
  const body = await req.json()

  if (!body.name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const slug = (body.slug || body.name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  const { data, error } = await supabase
    .from('party_themes')
    .insert({
      name: body.name,
      slug,
      price_cents: body.priceCents || 0,
      tag: body.tag || null,
      description: body.description || '',
      extended_description: body.extendedDescription || '',
      images: body.images || [],
      sort_order: body.sortOrder || 0,
      is_active: body.isActive !== false,
    })
    .select()
    .single()

  if (error) {
    if (error.message.includes('duplicate') || error.message.includes('unique')) {
      return NextResponse.json({ error: 'A theme with this slug already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ theme: data })
}
