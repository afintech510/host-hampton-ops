/**
 * Confirming the email address a crew member types during onboarding.
 *
 * The same shape as the sign-in code and the same proven table
 * (`crew_login_codes`), told apart by `purpose = 'email_confirm'` and keyed to
 * the ADDRESS being confirmed (`target_email`, and the address is inside the
 * hash scope), so:
 *
 *   - a login code can never confirm an email and the reverse;
 *   - a code requested for one address cannot confirm another;
 *   - each guess is CLAIMED (one conditional UPDATE that increments and enforces
 *     the five-guess budget) before the comparison, so parallel guesses cannot
 *     share an attempt — see `/api/crew/auth/verify`.
 *
 * Only after a correct code does the address land on `crew_members.email`,
 * which is also what turns on email sign-in. An address another crew member
 * already holds is refused (the unique `email_key`).
 */

import type { getSupabase } from '@/lib/supabase'
import { generateEmailLoginCode, getEmailCodeMaxAttempts, hashEmailLoginCode, portalSigningSecret, verifyEmailLoginCode } from '@/lib/portalAuth'
import { findCrewMembersByEmail, isPlausibleEmailAddress } from '@/lib/contactLookup'
import { sendEmailConfirmCode } from '@/lib/crew/notify'

type Supa = ReturnType<typeof getSupabase>

const HOUR_MS = 60 * 60 * 1000
const scopeFor = (memberId: string, email: string) => `crew-email:${memberId}:${email}`

export type EmailRequestResult =
  | { kind: 'sent' }
  | { kind: 'invalid' }
  | { kind: 'taken' }
  | { kind: 'rate_limited' }
  | { kind: 'failed'; error: string }

export async function requestEmailConfirm(sb: Supa, memberId: string, rawEmail: unknown): Promise<EmailRequestResult> {
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : ''
  if (!isPlausibleEmailAddress(email)) return { kind: 'invalid' }

  const existing = await findCrewMembersByEmail(sb, email, 'id, email')
  if (existing.kind === 'unavailable') return { kind: 'failed', error: existing.error }
  if (existing.kind === 'found' && existing.members.some(m => (m as unknown as { id: string }).id !== memberId)) return { kind: 'taken' }

  const { count, error: countErr } = await sb.from('crew_login_codes')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', memberId).eq('purpose', 'email_confirm')
    .gte('created_at', new Date(Date.now() - HOUR_MS).toISOString())
  if (countErr) return { kind: 'failed', error: countErr.message }
  if ((count ?? 0) >= 3) return { kind: 'rate_limited' }

  const secret = portalSigningSecret()
  const { code } = generateEmailLoginCode()
  const { error: insErr } = await sb.from('crew_login_codes').insert({
    member_id: memberId, purpose: 'email_confirm', target_email: email,
    code_hash: hashEmailLoginCode(code, scopeFor(memberId, email), secret),
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  }).select('id').maybeSingle()
  if (insErr) return { kind: 'failed', error: insErr.message }

  if (!(await sendEmailConfirmCode(email, code))) {
    const { error } = await sb.from('crew_login_codes').update({ consumed_at: new Date().toISOString() })
      .eq('member_id', memberId).eq('purpose', 'email_confirm').is('consumed_at', null)
    if (error) console.error('crew/emailConfirm: could not retire the unsent code:', error.message)
    return { kind: 'failed', error: 'the code email did not send' }
  }
  return { kind: 'sent' }
}

export type EmailVerifyResult =
  | { kind: 'confirmed'; email: string }
  | { kind: 'wrong'; triesLeft: number }
  | { kind: 'expired' }
  | { kind: 'locked' }
  | { kind: 'busy' }
  | { kind: 'taken' }
  | { kind: 'failed'; error: string }

export async function verifyEmailConfirm(sb: Supa, memberId: string, rawCode: unknown): Promise<EmailVerifyResult> {
  const code = typeof rawCode === 'string' ? rawCode.trim() : ''
  if (!/^\d{6}$/.test(code)) return { kind: 'wrong', triesLeft: 0 }

  const max = getEmailCodeMaxAttempts()
  const { data: row, error: readErr } = await sb.from('crew_login_codes')
    .select('id, code_hash, attempts, target_email')
    .eq('member_id', memberId).eq('purpose', 'email_confirm')
    .is('consumed_at', null).gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (readErr) return { kind: 'failed', error: readErr.message }
  if (!row || !row.target_email) return { kind: 'expired' }

  // The claim comes BEFORE the comparison.
  const { data: claimed, error: claimErr } = await sb.from('crew_login_codes')
    .update({ attempts: row.attempts + 1 })
    .eq('id', row.id).eq('attempts', row.attempts).lt('attempts', max)
    .select('id, attempts').maybeSingle()
  if (claimErr) return { kind: 'failed', error: claimErr.message }
  if (!claimed) {
    const { data: now } = await sb.from('crew_login_codes').select('attempts').eq('id', row.id).maybeSingle()
    if ((now?.attempts ?? max) >= max) {
      await sb.from('crew_login_codes').update({ consumed_at: new Date().toISOString() }).eq('id', row.id).select('id')
      return { kind: 'locked' }
    }
    return { kind: 'busy' }
  }

  if (!verifyEmailLoginCode(code, scopeFor(memberId, row.target_email), row.code_hash, portalSigningSecret())) {
    return { kind: 'wrong', triesLeft: Math.max(0, max - claimed.attempts) }
  }

  const { data: consumed, error: consumeErr } = await sb.from('crew_login_codes')
    .update({ consumed_at: new Date().toISOString() }).eq('id', row.id).is('consumed_at', null).select('id').maybeSingle()
  if (consumeErr || !consumed) return { kind: 'failed', error: consumeErr?.message ?? 'could not mark the code used' }

  const { data: updated, error: upErr } = await sb.from('crew_members')
    .update({ email: row.target_email, email_opt_in: true, updated_by: 'self' }).eq('id', memberId).select('id')
  if (upErr) {
    if ((upErr as { code?: string }).code === '23505') return { kind: 'taken' }
    return { kind: 'failed', error: upErr.message }
  }
  if ((updated ?? []).length === 0) return { kind: 'failed', error: 'member not found' }
  return { kind: 'confirmed', email: row.target_email }
}
