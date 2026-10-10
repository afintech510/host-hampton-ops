/**
 * Evite analytics (spec §11).
 *
 *   recordEviteEvent(supabase, eviteId, event)   -> boolean   one `evite_events` row; no PII
 *   sendMetaViewContent(req)                     -> Promise<'sent'|'skipped'|'failed'>
 *
 * Neither THROWS and neither blocks a guest. A failed analytics write is a
 * logged line, never an error page and never a changed HTTP answer.
 *
 * META CONVERSIONS API. The browser Meta Pixel does not load on `/i/` (the URL is
 * the capability to see a child's party), so the one thing Meta is told is a
 * server-side `ViewContent`, on `invite_viewed` only, carrying a CLEANED
 * `event_source_url` (`<origin>/i/invite`, never the slug) and nothing else about
 * the party: no slug, no name, no title, no email, no phone, and no other event
 * type. `user_data` is what Meta asks of website events (`client_user_agent`,
 * `client_ip_address`) plus the `_fbp` / `_fbc` cookies when the visitor has them.
 * NO hashed email (`em`) and no `CompleteRegistration`: A18.
 *
 * No `META_CAPI_ACCESS_TOKEN`, or no pixel id: a no-op. 2 s `AbortController`
 * timeout. The Graph API version comes from `META_GRAPH_VERSION`; the default
 * below is a documented fallback only, because Meta retires versions and a
 * hard-coded one silently stops working (spec §16: "checked against Meta's
 * current list at build time").
 */

import { randomUUID } from 'crypto'
import type { getSupabase } from '@/lib/supabase'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'

type Supa = ReturnType<typeof getSupabase>

/** The seven events `evite_events.event` allows (migration 068 CHECK). */
export const EVITE_EVENT_NAMES = [
  'invite_viewed',
  'share_clicked',
  'rsvp_started',
  'rsvp_completed',
  'club_opted_in',
  'birthday_month_saved',
  'calendar_added',
] as const
export type EviteEventName = (typeof EVITE_EVENT_NAMES)[number]

/** The only two a BROWSER may report (spec §7.1). The other five are written by the server on the action itself. */
export const PUBLIC_BEACON_EVENTS = ['invite_viewed', 'rsvp_started'] as const
export type PublicBeaconEvent = (typeof PUBLIC_BEACON_EVENTS)[number]

export function isPublicBeaconEvent(v: unknown): v is PublicBeaconEvent {
  return typeof v === 'string' && (PUBLIC_BEACON_EVENTS as readonly string[]).includes(v)
}

/**
 * Insert one analytics row. Reads `{error}`; returns whether the row landed.
 * `evite_events` holds no PII by construction: an evite id, an event name, a time.
 */
export async function recordEviteEvent(supabase: Supa, eviteId: string, event: EviteEventName): Promise<boolean> {
  try {
    const { error } = await supabase.from('evite_events').insert({ evite_id: eviteId, event })
    if (error) {
      console.error(`evites/analytics: ${event} not recorded: ${error.message}`)
      return false
    }
    return true
  } catch (e) {
    console.error(`evites/analytics: ${event} not recorded: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}

// ---------------------------------------------------------------- Meta Conversions API

/**
 * Used ONLY when `META_GRAPH_VERSION` is unset or malformed. Documented, not
 * authoritative: set the env var to the version Meta currently lists.
 */
export const META_GRAPH_VERSION_DEFAULT = 'v23.0'
export const META_CAPI_TIMEOUT_MS = 2000

const GRAPH_VERSION = /^v\d{1,2}\.\d{1,2}$/

export function metaGraphVersion(): string {
  const v = (process.env.META_GRAPH_VERSION ?? '').trim()
  return GRAPH_VERSION.test(v) ? v : META_GRAPH_VERSION_DEFAULT
}

/** The cleaned page URL Meta is given. A constant: it must never contain the slug. */
export function metaEventSourceUrl(): string {
  return `${CANONICAL_ORIGIN}/i/invite`
}

export interface MetaRequestLike {
  headers: { get(name: string): string | null }
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
const IPV6ISH = /^[0-9a-f:]{3,45}$/i

function ipOf(raw: string | null): string | null {
  const s = (raw ?? '').trim()
  return s !== '' && s.length <= 45 && (IPV4.test(s) || IPV6ISH.test(s)) ? s : null
}

/** One cookie out of a `Cookie:` header. Meta's own `_fbp` / `_fbc` are `fb.1.<ms>.<digits-or-token>`. */
function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() !== name) continue
    const v = part.slice(eq + 1).trim()
    return /^[A-Za-z0-9._-]{1,200}$/.test(v) ? v : null
  }
  return null
}

/**
 * The JSON body of the Conversions API call. Exported so a test can assert,
 * byte for byte, that it carries no slug, name, title, email or phone.
 */
export function metaViewContentBody(req: MetaRequestLike, token: string, now: Date = new Date()): Record<string, unknown> {
  const cookie = req.headers.get('cookie')
  const user: Record<string, string> = {}
  const ua = (req.headers.get('user-agent') ?? '').trim()
  if (ua) user.client_user_agent = ua.slice(0, 500)
  const ip = ipOf(req.headers.get('cf-connecting-ip')) ?? ipOf(req.headers.get('x-real-ip'))
  if (ip) user.client_ip_address = ip
  const fbp = cookieValue(cookie, '_fbp')
  if (fbp) user.fbp = fbp
  const fbc = cookieValue(cookie, '_fbc')
  if (fbc) user.fbc = fbc
  return {
    data: [
      {
        event_name: 'ViewContent',
        event_time: Math.floor(now.getTime() / 1000),
        event_id: randomUUID(),
        action_source: 'website',
        event_source_url: metaEventSourceUrl(),
        user_data: user,
      },
    ],
    access_token: token,
  }
}

/**
 * Fire-and-forget `ViewContent`. Never throws and never rejects, so the caller can
 * `void` it without an unhandled rejection being possible. Resolves with what
 * happened, for tests and logs.
 */
export async function sendMetaViewContent(req: MetaRequestLike): Promise<'sent' | 'skipped' | 'failed'> {
  const token = (process.env.META_CAPI_ACCESS_TOKEN ?? '').trim()
  const pixelId = (process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '').trim()
  if (!token || !pixelId || !/^\d{5,20}$/.test(pixelId)) return 'skipped'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), META_CAPI_TIMEOUT_MS)
  try {
    const res = await fetch(`https://graph.facebook.com/${metaGraphVersion()}/${pixelId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(metaViewContentBody(req, token)),
      signal: controller.signal,
    })
    if (!res.ok) {
      // Status only: the response body can echo request fields, and the request holds a token.
      console.error(`evites/analytics: Meta ViewContent answered ${res.status}`)
      return 'failed'
    }
    return 'sent'
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    console.error(`evites/analytics: Meta ViewContent ${aborted ? 'timed out' : 'failed'}`)
    return 'failed'
  } finally {
    clearTimeout(timer)
  }
}
