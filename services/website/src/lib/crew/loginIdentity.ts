/**
 * Who is asking to sign in: an email address or a phone number.
 *
 * Both crew login routes take `{ email }` or `{ phone }` and need the same two
 * answers — what was typed, and which crew member (if any) it names — so the
 * parsing and the lookup live here once (rule 11). A phone is compared by
 * `normalizePhoneKey` in JS, never matched raw (AGENTS.md §11); an email goes
 * through `findCrewMembersByEmail`.
 */

import type { getSupabase } from '@/lib/supabase'
import { findCrewMembersByEmail, isPlausibleEmailAddress, normalizePhoneKey } from '@/lib/contactLookup'
import { crewMembersByPhone } from '@/lib/crew/db'

type Supa = ReturnType<typeof getSupabase>

export type LoginIdentity =
  | { kind: 'email'; email: string }
  | { kind: 'phone'; phone: string; key: string }

export type ParsedIdentity = { ok: true; identity: LoginIdentity } | { ok: false; error: string }

export function parseLoginIdentity(body: unknown): ParsedIdentity {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (typeof b.phone === 'string' && b.phone.trim()) {
    const key = normalizePhoneKey(b.phone)
    if (!key || !/^[2-9]\d{9}$/.test(key)) return { ok: false, error: 'Enter your 10-digit mobile number.' }
    return { ok: true, identity: { kind: 'phone', phone: `+1${key}`, key } }
  }
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
  if (!isPlausibleEmailAddress(email)) return { ok: false, error: 'Enter your mobile number or email address.' }
  return { ok: true, identity: { kind: 'email', email } }
}

export interface LoginMember { id: string; email: string | null; phone: string | null; status: string; is_owner: boolean; is_test: boolean }

export type LoginLookup =
  | { kind: 'found'; member: LoginMember }
  | { kind: 'absent' }
  | { kind: 'unavailable'; error: string }

export async function findLoginMember(sb: Supa, id: LoginIdentity): Promise<LoginLookup> {
  if (id.kind === 'email') {
    const r = await findCrewMembersByEmail(sb, id.email, 'id, email, phone, status, is_owner, is_test')
    if (r.kind === 'unavailable') return r
    return r.kind === 'found' ? { kind: 'found', member: r.primary as unknown as LoginMember } : { kind: 'absent' }
  }
  const r = await crewMembersByPhone(sb, id.phone)
  if (r.kind !== 'ok') return { kind: 'unavailable', error: r.error }
  const m = r.data[0]
  return m ? { kind: 'found', member: m } : { kind: 'absent' }
}
