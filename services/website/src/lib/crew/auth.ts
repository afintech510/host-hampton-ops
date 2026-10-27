/**
 * Crew sessions (spec §5). Server code only.
 *
 * The session is the `hh_crew` cookie, `<memberId>:<issuedAtMs>:<sig>`, signed
 * with `portalSigningSecret()` — the same shape as `hh_admin`, `hh_portal` and
 * `hh_portal_email`, so the expiry is INSIDE the signature and a copied value
 * stops working on its own after 30 days. There is no Supabase Auth here.
 *
 * Two doors hand one out: the 6-digit email code (`/api/crew/auth/verify`) and,
 * only while CREW_TEST_LOGIN is on, the test picker (`/api/crew/auth/test-login`).
 * Both set exactly the same cookie, and neither cookie is trusted on its own:
 * every request re-reads the member and asks `crewMemberMayEnter`, so pausing
 * someone, removing them, or switching test mode off takes effect on their next
 * click rather than at the end of a 30-day cookie.
 */

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSupabase } from '@/lib/supabase'
import { portalSigningSecret } from '@/lib/portalAuth'
import { getMember, type CrewMemberRow } from '@/lib/crew/db'
import { crewAppOpen, crewMemberMayEnter } from '@/lib/crew/settings'

export const CREW_COOKIE = 'hh_crew'
const MAX_AGE_S = 30 * 24 * 60 * 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

function sign(memberId: string, issuedAtMs: number, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`crew:${memberId}:${issuedAtMs}`).digest('hex')
}

export function buildCrewCookieValue(memberId: string, secret: string, issuedAtMs = Date.now()): string {
  return `${memberId}:${issuedAtMs}:${sign(memberId, issuedAtMs, secret)}`
}

export function setCrewCookieHeader(memberId: string, secret: string, isInsecure = false): string {
  const secure = isInsecure ? '' : '; Secure'
  return `${CREW_COOKIE}=${buildCrewCookieValue(memberId, secret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}`
}

export function clearCrewCookieHeader(): string {
  return `${CREW_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`
}

/** The member id a cookie VALUE names, or null. Signature, shape and both ends of the age are checked. */
export function memberIdFromCookieValue(value: string | null | undefined, secret: string, now = Date.now()): string | null {
  if (!value) return null
  const parts = value.split(':')
  if (parts.length !== 3) return null
  const [memberId, issuedRaw, sig] = parts
  const issuedAtMs = Number(issuedRaw)
  if (!isUuid(memberId) || !/^\d+$/.test(issuedRaw) || !Number.isFinite(issuedAtMs)) return null
  const expected = sign(memberId, issuedAtMs, secret)
  let same = false
  try {
    same = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  } catch {
    return null // length mismatch: not this signature
  }
  if (!same) return null
  if (issuedAtMs > now + 60_000) return null
  if (now - issuedAtMs > MAX_AGE_S * 1000) return null
  return memberId
}

function cookieFromHeader(header: string | null): string | null {
  if (!header) return null
  const found = header.split(';').map(c => c.trim()).find(c => c.startsWith(`${CREW_COOKIE}=`))
  return found ? found.slice(CREW_COOKIE.length + 1) : null
}

export type CrewSession =
  | { kind: 'ok'; member: CrewMemberRow }
  /** No cookie, a bad cookie, or a member who may not enter (paused, removed, owner, real member in test mode). */
  | { kind: 'none' }
  /** The member could not be READ. Not "signed out": that would bounce a real person to the login page on a blip. */
  | { kind: 'unavailable'; error: string }

async function sessionFor(value: string | null): Promise<CrewSession> {
  if (!crewAppOpen()) return { kind: 'none' }
  const memberId = memberIdFromCookieValue(value, portalSigningSecret())
  if (!memberId) return { kind: 'none' }
  const read = await getMember(getSupabase(), memberId)
  if (read.kind !== 'ok') return { kind: 'unavailable', error: read.error }
  const m = read.data
  if (!m || !crewMemberMayEnter(m)) return { kind: 'none' }
  return { kind: 'ok', member: m }
}

export type CrewGate = { ok: true; member: CrewMemberRow } | { ok: false; response: NextResponse }

/**
 * The gate every `/api/crew/*` route except the logins stands behind.
 *
 *   app closed (neither switch on) → 404, so the surface does not exist;
 *   no session / not allowed       → 401;
 *   member unreadable              → 503.
 */
export async function requireCrewMember(req: NextRequest): Promise<CrewGate> {
  if (!crewAppOpen()) return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  const s = await sessionFor(cookieFromHeader(req.headers.get('cookie')))
  if (s.kind === 'ok') return { ok: true, member: s.member }
  if (s.kind === 'unavailable') {
    console.error('crew: member read failed:', s.error)
    return { ok: false, response: NextResponse.json({ error: 'Try again in a moment.' }, { status: 503 }) }
  }
  return { ok: false, response: NextResponse.json({ error: 'Please sign in again.' }, { status: 401 }) }
}

/** The server-component twin of `requireCrewMember`, over `cookies()`. The page decides 404 / redirect / error. */
export async function currentCrewMember(): Promise<CrewSession> {
  return sessionFor(cookies().get(CREW_COOKIE)?.value ?? null)
}
