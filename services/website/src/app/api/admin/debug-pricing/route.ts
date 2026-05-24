import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('pricing_items')
    .select('id, category, name, price_cents, price_label, is_popular, is_active, sort_order')
    .ilike('name', '%photo%')
  return NextResponse.json({ data, error: error?.message })
}
