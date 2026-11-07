import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { findQuoLink } from '@/lib/quo'
import { gmailComposeUrl } from '@/lib/gmailCompose'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/admin/crew-app/contact-link?booking=<id>&kind=quo|gmail
 *
 * Where to reach the client behind a booking, for the Leads and Bookings tiles:
 *   quo    the conversation with their phone number in Quo (or the Quo inbox when there is
 *          none yet), to type a text in Quo's own app;
 *   gmail  a new Gmail compose window addressed to them, from the studio mailbox.
 *
 * The number and the address are read from the booking here, never taken from the request,
 * so this cannot be pointed at an arbitrary number. It only builds a link: nothing is sent,
 * created or changed in Quo or Gmail. Admin only.
 */
export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const id = req.nextUrl.searchParams.get('booking') ?? ''
  const kind = req.nextUrl.searchParams.get('kind')
  if (!UUID.test(id) || (kind !== 'quo' && kind !== 'gmail')) return NextResponse.json({ error: 'Unknown request.' }, { status: 400 })

  const { data, error } = await getSupabase().from('bookings').select('contact_phone, contact_email').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: 'Could not read the booking.' }, { status: 503 })
  if (!data) return NextResponse.json({ error: 'Unknown booking.' }, { status: 404 })
  const b = data as { contact_phone: string | null; contact_email: string | null }

  if (kind === 'gmail') {
    const url = b.contact_email ? gmailComposeUrl(b.contact_email) : null
    if (!url) return NextResponse.json({ error: 'No email address on this booking.' }, { status: 422 })
    return NextResponse.json({ url })
  }

  if (!b.contact_phone) return NextResponse.json({ error: 'No phone number on this booking.' }, { status: 422 })
  const link = await findQuoLink(b.contact_phone)
  if (link.kind === 'thread') return NextResponse.json({ url: link.url, note: 'Opening your conversation in Quo.' })
  if (link.kind === 'inbox') return NextResponse.json({ url: link.url, note: 'No conversation with this number yet: opening the Quo inbox, where you can start one.' })
  if (link.kind === 'unconfigured') return NextResponse.json({ error: 'Quo is not set up on this site.' }, { status: 503 })
  return NextResponse.json({ error: link.reason }, { status: 502 })
}
