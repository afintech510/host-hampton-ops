/**
 * Gmail read/label client for the booking agent's inbox ingestion (plan §3,
 * Phase 3). Raw `fetch` against the REST API, deliberately shaped like
 * lib/googleCalendar.ts rather than pulling in googleapis.
 *
 * THE STANDING RULE, enforced by the grant itself: this token has
 * `gmail.readonly` + `gmail.modify` and NO send scope, so it physically cannot
 * email a customer. Outbound mail is Resend (lib/agent/sendApproved.ts), always.
 * There is no send function in this file and there must never be one.
 *
 * It uses its OWN credentials (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET /
 * GMAIL_REFRESH_TOKEN), never GOOGLE_REFRESH_TOKEN — that grant is calendar-only
 * and powers live availability. Re-consenting it would break booking.
 */

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export function gmailUser(): string {
  return (process.env.GMAIL_USER || 'hosthampton295@gmail.com').toLowerCase()
}

/**
 * Two labels, because "the agent read this" and "the agent acted on this" are
 * different claims and Adam reads them in his own mailbox (2026-09-11).
 *
 *  - SEEN is applied by ingestion to everything it polls, including the
 *    newsletters `autoIgnoreReason()` drops. It means: this message is in
 *    `ingested_messages`, nothing was lost.
 *  - HANDLED is applied by the dispatcher only once a message has actually
 *    produced a draft for a human to review.
 *
 * Before this, one label was stamped on every message the poll touched, so a
 * mailbox full of `HH-Agent/Handled` Abercrombie promos implied the agent had
 * done something about them.
 */
export function handledLabelName(): string {
  return process.env.GMAIL_HANDLED_LABEL || 'HH-Agent/Handled'
}

export function seenLabelName(): string {
  return process.env.GMAIL_SEEN_LABEL || 'HH-Agent/Seen'
}

export function gmailConfigured(): boolean {
  return !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN)
}

/* ── Auth ───────────────────────────────────────────────────────────── */

/**
 * Exchange the refresh token for an access token. Cached for the life of the
 * process minus a minute of slack — a cron run makes several calls and there is
 * no reason to mint a token for each.
 */
let cachedToken: { value: string; expiresAt: number } | null = null

export async function getGmailAccessToken(): Promise<string | null> {
  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) return null

  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    console.error('gmail: token refresh failed', res.status, data?.error_description || data?.error || '')
    return null
  }
  const ttl = Number(data.expires_in) || 3600
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (ttl - 60) * 1000 }
  return cachedToken.value
}

/** Forget the cached access token. Tests and a 401 retry use this. */
export function resetGmailTokenCache(): void {
  cachedToken = null
}

async function api(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any }> {
  const token = await getGmailAccessToken()
  if (!token) return { ok: false, status: 401, data: { error: 'Gmail is not configured' } }
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

/* ── Message shape ──────────────────────────────────────────────────── */

export interface GmailMessage {
  id: string
  threadId: string
  from: string
  fromEmail: string
  to: string
  subject: string
  /** Plain-text body, quoted replies and signature already stripped. */
  body: string
  /** RFC-2822 Date, ISO. */
  sentAt: string | null
  labelIds: string[]
  /** 'out' when this mailbox sent it — the Phase 6 voice corpus. */
  direction: 'in' | 'out'
}

/** base64url → utf8. Gmail encodes every body part this way. */
export function decodeBase64Url(input: string): string {
  try {
    return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  } catch {
    return ''
  }
}

/** The bare address out of `"Allie" <allie@example.com>`. */
export function addressOf(header: string): string {
  const m = String(header || '').match(/<([^>]+)>/)
  return (m ? m[1] : String(header || '')).trim().toLowerCase()
}

function header(payload: any, name: string): string {
  const h = (payload?.headers ?? []).find((x: any) => String(x?.name).toLowerCase() === name.toLowerCase())
  return h?.value ?? ''
}

/**
 * Walk the MIME tree for a body. text/plain wins; text/html is a fallback with
 * the tags taken out, because plenty of senders ship HTML only.
 */
export function extractBody(payload: any): string {
  const plain: string[] = []
  const html: string[] = []

  const walk = (part: any) => {
    if (!part) return
    const mime = String(part.mimeType || '')
    const data = part.body?.data
    if (data) {
      if (mime === 'text/plain') plain.push(decodeBase64Url(data))
      else if (mime === 'text/html') html.push(decodeBase64Url(data))
    }
    for (const child of part.parts ?? []) walk(child)
  }
  walk(payload)

  if (plain.length) return plain.join('\n')
  if (!html.length) return ''
  return html
    .join('\n')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Trim a reply down to what this person actually wrote.
 *
 * Everything from the first attribution line ("On … wrote:", "-----Original
 * Message-----", Gmail's "From:" block) is the thread history, and a signature
 * after the RFC "-- " delimiter is boilerplate. Both would otherwise dominate
 * the triage prompt and — since an email body is untrusted data — give an
 * injection several more places to hide.
 */
export function stripQuotedReply(text: string): string {
  let body = String(text || '').replace(/\r\n/g, '\n')

  const cutters = [
    /^\s*On .{5,120}\bwrote:\s*$/im,
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^\s*_{10,}\s*$/m,
    /^\s*From:\s.+\nSent:\s.+$/im,
    /^\s*>{1,}.*$/m,
  ]
  for (const re of cutters) {
    const m = body.match(re)
    if (m && m.index !== undefined) body = body.slice(0, m.index)
  }

  // RFC 3676 signature delimiter: a line that is exactly "-- ".
  const sig = body.match(/^-- \s*$/m)
  if (sig && sig.index !== undefined) body = body.slice(0, sig.index)

  return body.replace(/\n{3,}/g, '\n\n').trim()
}

/** Normalise one `users.messages.get` response. */
export function parseMessage(raw: any): GmailMessage {
  const payload = raw?.payload ?? {}
  const from = header(payload, 'From')
  const fromEmail = addressOf(from)
  const dateHeader = header(payload, 'Date')
  const parsedDate = dateHeader ? new Date(dateHeader) : null
  const labelIds: string[] = raw?.labelIds ?? []

  return {
    id: String(raw?.id ?? ''),
    threadId: String(raw?.threadId ?? ''),
    from,
    fromEmail,
    to: header(payload, 'To'),
    subject: header(payload, 'Subject'),
    body: stripQuotedReply(extractBody(payload)),
    sentAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
    labelIds,
    // SENT is authoritative; the from-address check catches messages the label
    // has not caught up with.
    direction: labelIds.includes('SENT') || fromEmail === gmailUser() ? 'out' : 'in',
  }
}

/* ── Reads ──────────────────────────────────────────────────────────── */

export async function getMessage(id: string): Promise<GmailMessage | null> {
  const { ok, status, data } = await api(`/messages/${encodeURIComponent(id)}?format=full`)
  if (!ok) {
    console.error('gmail: messages.get failed', id, status)
    return null
  }
  return parseMessage(data)
}

/** The mailbox's current historyId — the checkpoint a later sync resumes from. */
export async function getProfileHistoryId(): Promise<string | null> {
  const { ok, data } = await api('/profile')
  return ok ? (data?.historyId ? String(data.historyId) : null) : null
}

export interface HistoryResult {
  messageIds: string[]
  historyId: string | null
  /**
   * true when Google no longer has history that far back (404). Gmail keeps
   * roughly a week, so any outage longer than that lands here and the caller
   * must fall back to a query.
   */
  expired: boolean
}

/** New message ids since `startHistoryId`, following `nextPageToken`. */
export async function listHistory(startHistoryId: string, maxPages = 5): Promise<HistoryResult> {
  const ids = new Set<string>()
  let historyId: string | null = null
  let pageToken: string | undefined

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded' })
    if (pageToken) params.set('pageToken', pageToken)
    const { ok, status, data } = await api(`/history?${params}`)

    if (!ok) {
      // 404 = startHistoryId is older than Gmail's retention window.
      if (status === 404) return { messageIds: [], historyId: null, expired: true }
      console.error('gmail: history.list failed', status)
      return { messageIds: Array.from(ids), historyId, expired: false }
    }

    for (const h of data?.history ?? []) {
      for (const added of h?.messagesAdded ?? []) {
        const id = added?.message?.id
        if (id) ids.add(String(id))
      }
    }
    if (data?.historyId) historyId = String(data.historyId)
    pageToken = data?.nextPageToken
    if (!pageToken) break
  }

  return { messageIds: Array.from(ids), historyId, expired: false }
}

/** Message ids matching a Gmail search, e.g. `newer_than:2d`. */
export async function listMessages(q: string, maxResults = 50, pageToken?: string): Promise<{ ids: string[]; nextPageToken: string | null }> {
  const params = new URLSearchParams({ q, maxResults: String(maxResults) })
  if (pageToken) params.set('pageToken', pageToken)
  const { ok, status, data } = await api(`/messages?${params}`)
  if (!ok) {
    console.error('gmail: messages.list failed', status)
    return { ids: [], nextPageToken: null }
  }
  return {
    ids: (data?.messages ?? []).map((m: any) => String(m.id)),
    nextPageToken: data?.nextPageToken ?? null,
  }
}

/* ── Labels (the only writes this token can make) ───────────────────── */

/** Find or create a label by name. Returns its id, or null if unavailable. */
export async function ensureLabel(name: string): Promise<string | null> {
  const { ok, data } = await api('/labels')
  if (!ok) return null

  const found = (data?.labels ?? []).find((l: any) => String(l?.name) === name)
  if (found?.id) return String(found.id)

  const created = await api('/labels', {
    method: 'POST',
    body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
  })
  if (!created.ok) {
    console.error('gmail: labels.create failed', name, created.status)
    return null
  }
  return created.data?.id ? String(created.data.id) : null
}

/** Find or create the "agent acted on this" label. */
export async function ensureHandledLabel(): Promise<string | null> {
  return ensureLabel(handledLabelName())
}

/** Find or create the "agent read this" label. */
export async function ensureSeenLabel(): Promise<string | null> {
  return ensureLabel(seenLabelName())
}

/** Apply a label. Best-effort: a label failure never loses a message. */
export async function applyLabel(messageId: string, labelId: string): Promise<boolean> {
  const { ok, status } = await api(`/messages/${encodeURIComponent(messageId)}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds: [labelId] }),
  })
  if (!ok) console.error('gmail: messages.modify failed', messageId, status)
  return ok
}

/** Apply the handled label to a message, resolving the label id itself. */
export async function markHandled(messageId: string): Promise<boolean> {
  const labelId = await ensureHandledLabel()
  if (!labelId) return false
  return applyLabel(messageId, labelId)
}

export const applyHandledLabel = applyLabel
