import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('party_themes')
    .select('id, name, slug, price_cents, tag, description, extended_description, images, sort_order')
    .eq('is_active', true)
    .order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ themes: data || [] })
}
