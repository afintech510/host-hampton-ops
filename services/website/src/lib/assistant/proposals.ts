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
 *   * single-use, DURABLY: `claimProposal` (./usedProposals.ts) inserts the id
 *     into a table whose primary key is the claim, so a double-click, a retried
 *     request or a container restart cannot send a client the same links twice.
 *     This file stays pure on purpose — it never touches a table.
 */

export type ProposalKind =
  | 'create_party'
  | 'send_client_links'
  | 'create_pay_link'
  | 'update_party'
  | 'add_line_item'
  | 'remove_line_item'
  | 'record_payment'
  | 'cancel_party'
  | 'mark_lost'
  | 'send_photos'
  | 'enrol_sequence'
  | 'party_link'
  | 'approve_party'
  | 'reopen_party'

/** A thumbnail shown on a card (photo proposals). Display only — execute.ts never reads it. */
export interface ProposalPhoto {
  id: string
  url: string
  alt: string
}

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
  /** Thumbnails for the card. Display only; the replayed route re-resolves ids through findPhotos. */
  photos?: ProposalPhoto[]
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
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_actor' }

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
  return { ok: true, proposal }
}
