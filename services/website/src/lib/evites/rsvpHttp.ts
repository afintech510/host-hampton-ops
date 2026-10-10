/**
 * The HTTP-shaped pieces the three RSVP entry points share (spec §7.5):
 * `POST/PATCH /api/i/[slug]/rsvp` and `GET /i/[slug]/rsvp/[token]`.
 *
 * Kept out of the route files because a Next `route.ts` may export nothing but
 * its handlers and config.
 */

import net from 'net'
import type { NextRequest, NextResponse } from 'next/server'
import { isLocalRequest, screenRequestHost } from '@/lib/publicOrigin'
import { cookieName } from '@/lib/evites/rsvpToken'
import type { OwnRsvp } from '@/lib/evites/rsvpView'

/** Spec §7.5 gate 6: more than `max(40, 3 x guest_count_approx + 10)` RSVPs and the list is full. */
export const RSVP_CAP_FLOOR = 40

export function rsvpCap(guestCap: number | null): number {
  return Math.max(RSVP_CAP_FLOOR, 3 * (guestCap ?? 0) + 10)
}

/**
 * `evite_reminder_email_recent(email) >= this` and the RSVP is stored WITHOUT the reminder address (spec §7.5, §13).
 * The count is of RSVPs whose `reminder_set_at` is in the last 24 hours: a PATCH that sets the address counts too (v1.2).
 */
export const REMINDER_EMAIL_DAILY_CAP = 3

/** At most this many RSVPs on ONE invitation may hold the same reminder address (`evite_reminder_email_on_evite`, v1.2). */
export const REMINDER_EMAIL_PER_EVITE_CAP = 3

/** A request body bigger than this is not an RSVP. */
export const RSVP_BODY_MAX_CHARS = 20_000

/**
 * CSRF's second lock (SameSite=Lax is the first): a state-changing call must name
 * an Origin that is one of ours. A missing, malformed or foreign Origin is refused:
 * every browser sends Origin on a cross-origin POST/PATCH, and on a same-origin
 * `fetch` POST/PATCH too, so a missing one is a script, not a guest.
 */
export function originAllowed(req: Pick<NextRequest, 'headers'>): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  let u: URL
  try {
    u = new URL(origin)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  return screenRequestHost(u.host) !== null
}

/**
 * The client address for `evite_rsvps.consent_ip` (an `inet` column): the Cloudflare
 * header, then `X-Real-IP`, and only if it parses as an address. NOT a trusted
 * identity (the header is forgeable direct to the origin, AGENTS.md §11); it is
 * consent evidence, and a value that is not an address would make the INSERT fail,
 * so anything unusable is null.
 */
export function consentIp(req: Pick<NextRequest, 'headers'>): string | null {
  for (const name of ['cf-connecting-ip', 'x-real-ip']) {
    const v = (req.headers.get(name) ?? '').trim()
    if (v !== '' && v.length <= 45 && !v.includes('%') && net.isIP(v) !== 0) return v
  }
  return null
}

/** Cookie lifetime in whole seconds, never zero or negative. */
export function maxAgeSeconds(expEpochSec: number, now: Date): number {
  return Math.max(60, expEpochSec - Math.floor(now.getTime() / 1000))
}

/**
 * Set the per-invitation RSVP cookie: `hh_rsvp_<id8>`, HttpOnly, SameSite=Lax,
 * `Path=/` (so both `/i/<slug>` and `/api/i/<slug>/rsvp` receive it), Max-Age to
 * the token's own expiry. Secure unless the request is served from a development host.
 */
export function setRsvpCookie(res: NextResponse, req: Pick<NextRequest, 'headers'>, eviteId: string, token: string, expEpochSec: number, now: Date): void {
  res.cookies.set({
    name: cookieName(eviteId),
    value: token,
    httpOnly: true,
    secure: !isLocalRequest(req),
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds(expEpochSec, now),
  })
}

/**
 * The 200 a bot that filled the hidden `website` field is given: the shape of a
 * real answer, built from nothing the database knows, with no cookie and no write.
 * A bot that reads the answer sees success and moves on.
 */
export function honeypotRsvp(body: unknown, now: Date): OwnRsvp {
  const o = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const clip = (v: unknown, n: number) => (typeof v === 'string' ? Array.from(v.trim()).slice(0, n).join('') : '')
  const iso = now.toISOString()
  return {
    status: o.status === 'no' ? 'no' : 'yes',
    revision: 1,
    parent_name: clip(o.parentName, 60) || 'Guest',
    children: [],
    adult_count: 0,
    has_allergy: null,
    allergy_note: null,
    note_to_honoree: null,
    reminder_email: null,
    reminder_phone_e164: null,
    reminder_opt_out_at: null,
    club_email: null,
    club_opt_in_at: null,
    club_opted_out_at: null,
    birthday_month: null,
    created_at: iso,
    updated_at: iso,
  }
}
