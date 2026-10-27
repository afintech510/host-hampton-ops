import { NextResponse } from 'next/server'
import { clearCrewCookieHeader } from '@/lib/crew/auth'

export const dynamic = 'force-dynamic'

/** Sign out: clears the caller's own `hh_crew` cookie. Reads and writes nothing. */
export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.headers.set('Set-Cookie', clearCrewCookieHeader())
  return res
}
