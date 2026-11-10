import { NextResponse } from 'next/server'
import { clearCrewViewCookieHeader } from '@/lib/crew/auth'

export const dynamic = 'force-dynamic'

/** Ends a view-as preview: clears the caller's own `hh_crew_view` cookie. Reads and writes nothing else. */
export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.headers.set('Set-Cookie', clearCrewViewCookieHeader())
  return res
}
