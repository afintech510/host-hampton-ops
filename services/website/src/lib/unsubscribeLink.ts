/**
 * Unsubscribe tokens for automated email.
 *
 * Phase 3B built a sequencer that sends marketing email to real customers and
 * gave it **no unsubscribe link of any kind** — `step.body_html` goes to Resend
 * verbatim. That is a CAN-SPAM problem before it is an engineering one, and it
 * is also why the opt-out state the sequencer checks could only ever be updated
 * from somewhere else (a Brevo campaign, an admin edit). A person can now stop a
 * sequence from the sequence email itself.
 *
 * The token is an HMAC over the lowercased address — no expiry, deliberately.
 * An unsubscribe link in a two-year-old email must still work; a "this link has
 * expired" page on an opt-out is the kind of thing that produces a spam report
 * instead.
 *
 * Reuses `PORTAL_LINK_SIGNING_SECRET` (AGENTS.md §7) rather than minting a new
 * secret. Rotating it invalidates outstanding unsubscribe links, so don't.
 */

import crypto from 'crypto'

function signingSecret(): string | null {
  return process.env.PORTAL_LINK_SIGNING_SECRET || null
}

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unb64url(s: string): string | null {
  try {
    const padded = s.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(padded, 'base64').toString('utf8')
  } catch {
    return null
  }
}

function mac(email: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`unsub:${email}`).digest('hex')
}

/**
 * Mint a token for an address. Returns null when no signing secret is
 * configured — the caller must then decline to send, because an email with a
 * dead unsubscribe link is worse than an email that was not sent.
 */
export function generateUnsubscribeToken(email: string): string | null {
  const secret = signingSecret()
  if (!secret) return null
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) return null
  return `${b64url(normalized)}.${mac(normalized, secret)}`
}

/**
 * Recover the address a token names, or null if it is forged, malformed or
 * unverifiable. Constant-time compare; a length mismatch is "not a token", not
 * a 500.
 */
export function verifyUnsubscribeToken(token: string | null | undefined): string | null {
  const secret = signingSecret()
  if (!secret) return null

  const raw = String(token || '')
  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return null

  const email = unb64url(raw.slice(0, dot))
  const sig = raw.slice(dot + 1)
  if (!email || !sig) return null
  // The token is the authority on the address, so it must round-trip to exactly
  // what was signed — otherwise `Foo@Bar.com` and `foo@bar.com` are two tokens
  // for one person and only one of them matches a `contacts.email` row.
  if (email !== email.toLowerCase()) return null

  const expected = mac(email, secret)
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  } catch {
    return null
  }
  return email
}

export function siteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.hosthampton.com').replace(/\/+$/, '')
}

/** The human-facing confirmation page. GET on this NEVER unsubscribes. */
export function buildUnsubscribeUrl(token: string): string {
  return `${siteBaseUrl()}/unsubscribe?t=${encodeURIComponent(token)}`
}

/** The RFC 8058 one-click endpoint. POST only. */
export function buildOneClickUrl(token: string): string {
  return `${siteBaseUrl()}/api/unsubscribe?t=${encodeURIComponent(token)}`
}

/**
 * The headers every automated marketing email must carry. `List-Unsubscribe-Post`
 * is what makes Gmail and Apple Mail show a native "Unsubscribe" button instead
 * of a spam report.
 */
export function unsubscribeHeaders(token: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${buildOneClickUrl(token)}>, <${buildUnsubscribeUrl(token)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}
