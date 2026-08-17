import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

/**
 * Fetch a website_content row by id for the admin preview modal — ANY
 * status (draft/pending_review/approved/published/archived), unlike the
 * public [...slug] renderer which only ever serves status='published'.
 * Lets an admin see exactly what will go live before approving it.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { data, error } = await getSupabase()
    .from('website_content')
    .select('id, slug, locale, title, meta_description, body_html, featured_image, keywords, page_type, structured, status, updated_at')
    .eq('id', params.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'Failed to fetch content' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ content: data })
}
