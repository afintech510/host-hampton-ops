import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import { adminSessionSecret } from '@/lib/adminAuth'

/**
 * A write the Manager assistant has PROPOSED and a human has not yet confirmed.
 *
 * The model never performs a write. Its write tools return one of these, the
 * chat UI shows it as a card with a Confirm button, and only that click —
 * an authenticated admin request to `/api/admin/assistant/confirm` — carries
 * it out. So "the assistant created a party" always means "a named admin
 * pressed Confirm on a card that said exactly what would happen".
 *
 * The token is the proposal itself, HMAC-signed: the confirm route does not
 * have to trust anything the browser sends except a token it minted. It is:
 *
 *   * bound to the ACTOR who asked (another admin's session cannot confirm it),
 *   * short-lived (30 minutes — a stale card is re-asked, not replayed), and
 *   * single-use within this container (`markUsed`), so a double-click or a
 *     retried request cannot send a client the same links twice.
 */

export type ProposalKind = 'create_party' | 'send_client_links' | 'create_pay_link'

export interface Proposal {
  /** Random id; also the single-use key. */
  id: string
  kind: ProposalKind
  /** The exact input the confirm route will replay. Already screened. */
  input: Record<string, unknown>
  /** One-line title for the card. */
  title: string
  /** What will happen, as the manager reads it on the card. */
  details: string[]
  /** `admin:<email>` or `ADMIN` — see adminActorId(). */
  actor: string
  /** Epoch ms. */
  expiresAt: number
}

export const PROPOSAL_TTL_MS = 30 * 60 * 1000

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function sign(payload: string, secret: string): string {
  return b64url(createHmac('sha256', `assistant-proposal:${secret}`).update(payload).digest())
}

export function mintProposal(
  p: Omit<Proposal, 'id' | 'expiresAt'>,
  opts: { now?: number; secret?: string } = {},
): { proposal: Proposal; token: string } {
  const proposal: Proposal = {
    ...p,
    id: randomUUID(),
    expiresAt: (opts.now ?? Date.now()) + PROPOSAL_TTL_MS,
  }
  const payload = b64url(Buffer.from(JSON.stringify(proposal), 'utf8'))
  const token = `${payload}.${sign(payload, opts.secret ?? adminSessionSecret())}`
  return { proposal, token }
}

export type VerifyResult =
  | { ok: true; proposal: Proposal }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_actor' | 'already_used' }

export function verifyProposal(
  token: unknown,
  actor: string,
  opts: { now?: number; secret?: string } = {},
): VerifyResult {
  if (typeof token !== 'string' || token.length > 20_000) return { ok: false, reason: 'malformed' }
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return { ok: false, reason: 'malformed' }
  const payload = token.slice(0, dot)
  const given = token.slice(dot + 1)
  const expected = sign(payload, opts.secret ?? adminSessionSecret())
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' }

  let proposal: Proposal
  try {
    proposal = JSON.parse(fromB64url(payload).toString('utf8')) as Proposal
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!proposal || typeof proposal.id !== 'string' || typeof proposal.expiresAt !== 'number') {
    return { ok: false, reason: 'malformed' }
  }
  if ((opts.now ?? Date.now()) > proposal.expiresAt) return { ok: false, reason: 'expired' }
  if (proposal.actor !== actor) return { ok: false, reason: 'wrong_actor' }
  if (usedIds().has(proposal.id)) return { ok: false, reason: 'already_used' }
  return { ok: true, proposal }
}

/*
 * Single-use store. In-memory, one container — the same deliberate trade the
 * rate limiter makes (lib/rateLimit.ts): it resets on deploy, and a token
 * outlives a deploy by at most PROPOSAL_TTL_MS. Entries are evicted once their
 * proposal could no longer verify anyway, so it cannot grow without bound.
 */
type UsedStore = Map<string, number>
const g = globalThis as unknown as { __hhAssistantUsed?: UsedStore }
function usedIds(): UsedStore {
  if (!g.__hhAssistantUsed) g.__hhAssistantUsed = new Map()
  return g.__hhAssistantUsed
}

/** Claim a proposal. Returns false if it was already claimed (a double-click). */
export function markUsed(p: Pick<Proposal, 'id' | 'expiresAt'>, now = Date.now()): boolean {
  const store = usedIds()
  store.forEach((exp, id) => {
    if (exp < now) store.delete(id)
  })
  if (store.has(p.id)) return false
  store.set(p.id, p.expiresAt)
  return true
}

/** Release a claim when the action was refused before anything happened, so it can be retried. */
export function releaseUsed(id: string): void {
  usedIds().delete(id)
}
