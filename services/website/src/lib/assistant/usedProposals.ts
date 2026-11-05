import type { getSupabase } from '@/lib/supabase'
import type { Proposal } from './proposals'

/**
 * The durable single-use store for confirm cards (migration 084,
 * `assistant_used_proposals`).
 *
 * It used to be a Map in the container's memory: a deploy emptied it, and a
 * card minted before the deploy could be confirmed twice inside its 30-minute
 * life — a second "send the links" is a second text to a family, and there is
 * no way to un-send one. Now the claim is a row, and the PRIMARY KEY is the
 * lock: two confirms racing for one card both INSERT, exactly one succeeds, the
 * other gets 23505. That holds across restarts and across containers.
 *
 * Three outcomes, never two. A claim that could not be recorded because the
 * database was unreachable is NOT "unused": the caller must refuse, because
 * executing a send we could not record as claimed is the replayable direction.
 */

type Supa = ReturnType<typeof getSupabase>

export type ClaimOutcome = 'claimed' | 'already_used' | 'unavailable'

const UNIQUE_VIOLATION = '23505'
/** Rows whose card could no longer verify are noise; sweep them a day after expiry. */
const SWEEP_AFTER_MS = 24 * 60 * 60 * 1000

export async function claimProposal(
  sb: Supa,
  p: Pick<Proposal, 'id' | 'kind' | 'actor' | 'expiresAt'>,
  now = Date.now(),
): Promise<ClaimOutcome> {
  const { error } = await sb.from('assistant_used_proposals').insert({
    proposal_id: p.id,
    actor: p.actor,
    kind: p.kind,
    expires_at: new Date(p.expiresAt).toISOString(),
  })
  if (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return 'already_used'
    console.error('assistant: could not record a proposal claim — refusing the confirm:', error.message)
    return 'unavailable'
  }
  // Best-effort housekeeping; a failure here changes nothing about the claim.
  await Promise.resolve(
    sb.from('assistant_used_proposals').delete().lt('expires_at', new Date(now - SWEEP_AFTER_MS).toISOString()),
  ).catch(() => undefined)
  return 'claimed'
}

/**
 * A card the manager replaced with a revised one (a reworded message) is spent
 * on the spot: same table, same primary key, so the old wording can never be
 * confirmed from a stale tab after the new card exists. Best-effort in the one
 * direction that is safe — if the row cannot be written the old card simply
 * stays valid until it expires, exactly as it was before the revision.
 */
export async function supersedeProposal(sb: Supa, id: string, actor: string, now = Date.now()): Promise<ClaimOutcome> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return 'unavailable'
  const { error } = await sb.from('assistant_used_proposals').insert({
    proposal_id: id,
    actor,
    kind: 'superseded',
    expires_at: new Date(now + 30 * 60 * 1000).toISOString(),
  })
  if (!error) return 'claimed'
  // 23505: it was already confirmed or already replaced, so it is spent either way.
  if ((error as { code?: string }).code === UNIQUE_VIOLATION) return 'already_used'
  console.error('assistant: could not retire a replaced card:', error.message)
  return 'unavailable'
}

/**
 * Release a claim when the replayed route refused BEFORE anything happened (a
 * 4xx: quiet hours, nothing owed, missing email) so the manager can fix the
 * cause and confirm the same card again. Returns false if the release itself
 * failed — the card then stays spent and the manager asks again, which is safe.
 */
export async function releaseProposal(sb: Supa, id: string): Promise<boolean> {
  const { error } = await sb.from('assistant_used_proposals').delete().eq('proposal_id', id)
  if (error) {
    console.error('assistant: could not release a proposal claim:', error.message)
    return false
  }
  return true
}
