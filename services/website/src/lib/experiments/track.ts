/**
 * Tracked links — the first outcome signal this database has ever had.
 *
 * ── What was measured before this was written ───────────────────────────────
 *
 * Production, 2026-09-12: seven campaigns recorded `sent` to **2,160
 * recipients** with `opened = 0`, `clicked = 0`, `bounced = 0`.
 * `contact_interactions` holds 142 rows and has never once held an
 * `email_opened`, `email_clicked` or `email_sent`. `analytics_events` holds 0
 * rows and has zero references anywhere in the repo. There is no Resend webhook
 * route. So "INTEL tracks performance" had nothing to track, and an A/B test
 * built on top of that would have been picking winners out of noise.
 *
 * ── A click, and deliberately not an open ───────────────────────────────────
 *
 * No pixel. Apple Mail Privacy Protection pre-fetches every tracking image for
 * every recipient on Apple Mail, so an "open" is registered whether or not a
 * human ever saw the message. That number looks like evidence and is not one,
 * and this pipeline's whole output is "what we learned" — so it is not
 * collected at all. Hard-won rule 15: an input the pipeline cannot interpret is
 * DROPPED, never guessed at.
 *
 * ── The token, and no new secret ────────────────────────────────────────────
 *
 * An HMAC over `assignmentId|destination` on `PORTAL_LINK_SIGNING_SECRET`, the
 * same secret `lib/unsubscribeLink.ts` and `lib/portalAuth.ts` use (AGENTS.md
 * §7). The destination is IN the signed payload, not looked up — a redirect
 * whose target comes out of a request is an open redirect, and an open redirect
 * on `www.hosthampton.com` is a phishing gift wrapped in our own domain.
 *
 * Screened AGAIN at redirect time with `safeSiteLink`, because the signature
 * proves we minted the link and not that the destination is still one we want
 * to send people to. `safeSiteLink` PARSES with `new URL` rather than
 * prefix-matching — content-pipeline.md §11.1 is one backslash making
 * `/\evil.example.com/x` site-relative to a screen and another origin to every
 * browser, and §11.3 of the Phase 4 review is the same field through a second
 * door.
 *
 * ── The link this must NEVER rewrite ───────────────────────────────────────
 *
 * The unsubscribe URL. It is on our own host, so a naive "rewrite our links"
 * pass would wrap it — and then (a) the RFC 8058 one-click POST endpoint would
 * become a GET redirect, which `/unsubscribe` deliberately does not act on, and
 * (b) a person's ability to opt out would depend on an `variant_assignments`
 * row still existing. An unsubscribe link has to work for years and must depend
 * on nothing. `EXCLUDED_PATHS` is that rule, and a test pins it.
 */

import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import crypto from 'crypto'
import { safeSiteLink } from '@/lib/content/contentSafety'

function signingSecret(): string | null {
  return process.env.PORTAL_LINK_SIGNING_SECRET || null
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unb64url(s: string): Buffer | null {
  try {
    return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  } catch {
    return null
  }
}

function mac(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`track:${payload}`).digest('hex')
}

/**
 * Paths a tracked link may never wrap. See the note above — the opt-out path is
 * the load-bearing one, and the portal/plan paths are excluded because those
 * links are already signed and already single-purpose.
 */
export const EXCLUDED_PATHS: readonly string[] = ['/unsubscribe', '/api/unsubscribe', '/portal', '/plan', '/review', '/checkin', '/r/']

export function isExcludedFromTracking(url: string): boolean {
  let path: string
  try {
    // Parse rather than prefix-match, for the reason `safeSiteLink` does.
    path = new URL(url, 'https://www.hosthampton.com').pathname
  } catch {
    return true // cannot tell → do not wrap it
  }
  /**
   * Lower-cased before comparing.
   *
   * Measured 2026-09-12: `/UNSUBSCRIBE?t=…` and `/API/unsubscribe` passed
   * `safeSiteLink` and were NOT excluded, so a body carrying either would have
   * had its opt-out link wrapped. Next's route matching is case-sensitive, so
   * both already answer 404 in production and no live opt-out was defeated —
   * `buildUnsubscribeUrl` emits lower case and is passed to
   * `rewriteTrackedLinks` explicitly as well. But "the exclusion list happens to
   * be safe because the bypass leads to a 404" is not a rule, it is a
   * coincidence, and this list is the rule.
   */
  const lower = path.toLowerCase()
  return EXCLUDED_PATHS.some(p => lower === p || lower.startsWith(p.endsWith('/') ? p : `${p}/`))
}

/**
 * Trailing characters that belong to the SENTENCE, not to the URL.
 *
 * The plain-text pass matches a bare URL with `[^\s<>"')\]]+`, which correctly
 * stops at a closing bracket and does NOT stop at a full stop or a comma. So
 * `Pick a date here: https://www.hosthampton.com/book.` minted a token for
 * `/book.` — and `/book.` is a **404 in production** (measured). The recipient
 * of the plain-text part got a tracked link to a dead page, and
 * `See …/book, then call.` lost its comma into the URL as well.
 *
 * That matters here more than it would elsewhere, because the variant screen
 * requires the model to write plain paragraphs and the prompt tells it to
 * include the URL in full — "…here: <url>." is the most natural sentence it
 * could produce. The module comment above claimed "there is no failure mode here
 * in which a recipient gets a broken link"; this is what makes that true.
 */
const TRAILING_PUNCTUATION = /[.,;:!?'"’”)\]}>]+$/


/**
 * Mint a tracking token. Returns null when there is no signing secret or the
 * destination is not one of ours — the caller then leaves the original link
 * alone, which is the safe direction (an untracked click beats a dead link).
 */
export function mintTrackToken(assignmentId: string, destination: string): string | null {
  const secret = signingSecret()
  if (!secret) return null
  const safe = safeSiteLink(destination)
  if (!safe) return null
  const payload = `${assignmentId}|${safe}`
  return `${b64url(Buffer.from(payload, 'utf8'))}.${mac(payload, secret)}`
}

export type TrackToken =
  | { ok: true; assignmentId: string; destination: string }
  | { ok: false; reason: string }

/**
 * Recover what a token names. Constant-time compare; a malformed token is "not
 * a token", never a 500.
 *
 * The destination is re-screened here as well as at mint time, so a link minted
 * before `ALLOWED_IMAGE_HOSTS`/`SITE_ORIGIN` changed cannot outlive the rule
 * (rule 8: a signature is not evidence the payload is still acceptable).
 */
export function verifyTrackToken(token: string | null | undefined): TrackToken {
  const secret = signingSecret()
  if (!secret) return { ok: false, reason: 'PORTAL_LINK_SIGNING_SECRET is not configured' }

  const raw = String(token || '')
  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return { ok: false, reason: 'malformed token' }

  const payloadBuf = unb64url(raw.slice(0, dot))
  const sig = raw.slice(dot + 1)
  if (!payloadBuf || !sig) return { ok: false, reason: 'malformed token' }
  const payload = payloadBuf.toString('utf8')

  const expected = mac(payload, secret)
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return { ok: false, reason: 'bad signature' }
    }
  } catch {
    return { ok: false, reason: 'bad signature' }
  }

  const bar = payload.indexOf('|')
  if (bar <= 0) return { ok: false, reason: 'malformed payload' }
  const assignmentId = payload.slice(0, bar)
  const destination = payload.slice(bar + 1)

  const safe = safeSiteLink(destination)
  if (!safe) return { ok: false, reason: 'destination is no longer an allowed Host Hampton URL' }

  return { ok: true, assignmentId, destination: safe }
}

export function siteBaseUrl(): string {
  return CANONICAL_ORIGIN
}

export function buildTrackUrl(token: string): string {
  return `${siteBaseUrl()}/r/${encodeURIComponent(token)}`
}

export interface RewriteResult {
  html: string
  text: string
  /** How many links were wrapped. 0 is a legitimate outcome and is reported. */
  rewritten: number
  /** Links left alone, with why. Rule 10: a pass that skipped something says so. */
  skipped: { url: string; reason: string }[]
}

/**
 * Wrap every trackable Host Hampton link in the rendered mail.
 *
 * Operates on the FINAL rendered output, after `renderStepEmail` has put the
 * unsubscribe URL in — which is exactly why `EXCLUDED_PATHS` has to be right,
 * and why this function is given the unsubscribe URL separately as a belt to
 * the braces.
 *
 * A link that cannot be wrapped is LEFT AS IT WAS. There is no failure mode
 * here in which a recipient gets a broken link: the worst case is an untracked
 * click, which costs a data point.
 */
export function rewriteTrackedLinks(args: {
  html: string
  text?: string
  assignmentId: string
  unsubscribeUrl?: string | null
}): RewriteResult {
  const skipped: { url: string; reason: string }[] = []
  let rewritten = 0
  const unsub = args.unsubscribeUrl ? String(args.unsubscribeUrl) : null

  const wrap = (url: string): string | null => {
    if (unsub && url === unsub) {
      skipped.push({ url, reason: 'unsubscribe link — never tracked' })
      return null
    }
    if (isExcludedFromTracking(url)) {
      skipped.push({ url, reason: 'excluded path' })
      return null
    }
    const token = mintTrackToken(args.assignmentId, url)
    if (!token) {
      skipped.push({ url, reason: 'not a Host Hampton URL, or no signing secret' })
      return null
    }
    rewritten++
    return buildTrackUrl(token)
  }

  // href="..." and href='...' only. A bare URL in HTML body text is not a link
  // a recipient clicks; rewriting it would change visible copy a human approved.
  const html = String(args.html ?? '').replace(
    /(\shref\s*=\s*)(["'])([^"']+)\2/gi,
    (whole, lead: string, quote: string, url: string) => {
      const next = wrap(url)
      return next ? `${lead}${quote}${next}${quote}` : whole
    }
  )

  // The text part: bare URLs, since that is the only form they take there.
  // Sentence punctuation is split off the end and PUT BACK — it is not part of
  // the URL, and signing it into the token produced a tracked link to a 404.
  const text = String(args.text ?? '').replace(/(?:https?:)\/\/[^\s<>"')\]]+/gi, match => {
    const tail = TRAILING_PUNCTUATION.exec(match)?.[0] ?? ''
    const url = tail ? match.slice(0, match.length - tail.length) : match
    if (!url) return match
    return `${wrap(url) ?? url}${tail}`
  })

  return { html, text, rewritten, skipped }
}
