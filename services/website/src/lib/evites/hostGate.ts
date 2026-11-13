import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { composeHostView, readHostRows, type HostLoaded } from '@/lib/evites/hostView'

/**
 * The gate for the host's guest-list and manual-RSVP routes (`/api/portal/invitation/guests`, `.../rsvps`).
 *
 * The `hh_portal` cookie names the booking (each handler reads it and answers 401 itself, so the portal
 * tripwires can see the gate; `bookingRef` is what that cookie signed); the evite is found ONLY through that booking
 * (`readHostRows`), never through an id in the URL or body. Order: session (401) and rate limit (both in the handler, where the tripwires can see them) ->
 * read (404 `no-invitation` / 503) -> optionally the closed check (409 once the party has happened).
 * Every response is `no-store`.
 */

export const NO_INVITATION = { error: 'no-invitation' } as const

export function hostJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export type HostGate =
  | {
      ok: true
      supabase: ReturnType<typeof getSupabase>
      loaded: HostLoaded
      now: Date
      audience: 'kids' | 'guests'
      guestCap: number | null
    }
  | { ok: false; res: NextResponse }

export async function openHostGate(req: NextRequest, bookingRef: string, route: string, opts: { rejectClosed: boolean }): Promise<HostGate> {
  const supabase = getSupabase()
  const now = new Date()
  const read = await readHostRows(supabase, bookingRef, now)
  if (read.kind === 'none') return { ok: false, res: hostJson(NO_INVITATION, 404) }
  if (read.kind === 'unavailable') {
    console.error(`${route}: ${read.reason}`)
    return { ok: false, res: hostJson({ error: 'Could not load your invitation - try again.' }, 503) }
  }
  if (opts.rejectClosed && read.loaded.state === 'closed') {
    return { ok: false, res: hostJson({ error: 'This party has already happened, so the list can no longer be changed.' }, 409) }
  }
  const facts = composeHostView(read.loaded, process.env.SUPABASE_URL, now).payload.facts
  return { ok: true, supabase, loaded: read.loaded, now, audience: facts.audience === 'guests' ? 'guests' : 'kids', guestCap: facts.guestCap }
}
