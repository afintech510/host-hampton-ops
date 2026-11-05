import { createHash } from 'crypto'
import type { getSupabase } from '@/lib/supabase'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { optedOutReason } from '@/lib/sequences/processor'
import { requestHasConsent } from '@/lib/consent'
import { cookieValue, ipOf, metaGraphVersion, META_CAPI_TIMEOUT_MS, type MetaRequestLike } from '@/lib/evites/analytics'

/**
 * Meta Conversions API for the booking funnel: `Lead` / `Contact` from the
 * inquiry forms and `Purchase` when a deposit lands.
 *
 * WHY A SERVER COPY. The browser Pixel misses everyone with an ad blocker and
 * most iOS visitors, and a deposit paid in-page (the planner and studio-rental
 * Payment Element) fires no browser event at all. The server knows the money
 * landed, so it tells Meta, with the SAME `event_id` the browser used where
 * there is a browser event, so Meta counts one conversion and not two.
 *
 * WHAT IT WILL NOT DO
 *   * Send anything unless `META_CAPI_ENABLED` is exactly `true` AND there is an
 *     access token AND a pixel id. Off is the default and is silent.
 *   * Report anyone who has not accepted the cookie banner (`hh_consent=granted`, no
 *     Global Privacy Control): the same choice that keeps the browser Pixel quiet
 *     keeps the server copy quiet. A deposit is reported only if the booking's
 *     first touch recorded `ad_consent: 'granted'`.
 *   * Send an email or phone number for anyone who has not opted in to marketing
 *     (`optedOutReason` AND `email_opt_in === true`). Those events still go —
 *     with the click/browser ids, IP and user agent the Pixel already sees — but
 *     carry no personal identifier.
 *   * Send an identifier unhashed. Email and phone are normalised and SHA-256'd
 *     the way Meta documents; nothing else about the customer (no name, no child,
 *     no booking ref, no party details) is ever sent.
 *   * Throw, reject or take long. 2 s timeout; every failure is a logged status
 *     code, never the request body (which holds the token).
 *
 * It is a REPORTER. It reads (the booking and contact, for the Purchase) and
 * calls Meta; it writes nothing and never changes the answer a customer gets.
 */

type Supa = ReturnType<typeof getSupabase>

export type MetaSendOutcome = 'sent' | 'skipped' | 'failed'

export function metaCapiEnabled(): boolean {
  return (process.env.META_CAPI_ENABLED ?? '').trim() === 'true'
}

/** The pixel id and token, or null when sending is off or not configured. */
export function metaCapiConfig(): { pixelId: string; token: string; testEventCode: string | null } | null {
  if (!metaCapiEnabled()) return null
  const token = (process.env.META_CAPI_ACCESS_TOKEN ?? '').trim()
  const pixelId = (process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '').trim()
  if (!token || !/^\d{5,20}$/.test(pixelId)) return null
  const code = (process.env.META_CAPI_TEST_EVENT_CODE ?? '').trim()
  return { pixelId, token, testEventCode: /^[A-Za-z0-9_-]{3,40}$/.test(code) ? code : null }
}

/* ── hashing, the way Meta documents it ───────────────────────────────── */

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

/** Lower-cased, trimmed. */
export function hashEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase()
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? sha256(e) : null
}

/** Digits only with the country code (a US 10-digit number gets `1`). No plus sign. */
export function hashPhone(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '')
  const full = d.length === 10 ? `1${d}` : d.length === 11 && d.startsWith('1') ? d : d.length >= 11 && d.length <= 15 ? d : ''
  return full ? sha256(full) : null
}

export interface MetaPerson {
  email?: string | null
  phone?: string | null
}

export interface MetaClient {
  fbp?: string | null
  fbc?: string | null
  ip?: string | null
  userAgent?: string | null
}

/**
 * Meta's `user_data`. `person` is honoured ONLY when `consented` is true; with it
 * false the object carries the browser/click ids alone.
 */
export function buildUserData(client: MetaClient, person: MetaPerson | null, consented: boolean): Record<string, unknown> {
  const u: Record<string, unknown> = {}
  if (client.userAgent) u.client_user_agent = client.userAgent.slice(0, 500)
  if (client.ip) u.client_ip_address = client.ip
  if (client.fbp) u.fbp = client.fbp
  if (client.fbc) u.fbc = client.fbc
  if (consented && person) {
    const em = hashEmail(person.email)
    const ph = hashPhone(person.phone)
    if (em) u.em = [em]
    if (ph) u.ph = [ph]
  }
  return u
}

/** Opted in to marketing, by the same function the senders use PLUS an explicit yes. */
export function marketingConsent(contact: { email_opt_in?: boolean | null; status?: string | null } | null | undefined): boolean {
  if (!contact) return false
  return contact.email_opt_in === true && optedOutReason(contact, 'email') === null
}

/** What the request itself tells us about the visitor's browser. */
export function clientFromRequest(req: MetaRequestLike, attribution?: { fbp?: string; fbc?: string }): MetaClient {
  const cookie = req.headers.get('cookie')
  return {
    fbp: cookieValue(cookie, '_fbp') ?? attribution?.fbp ?? null,
    fbc: cookieValue(cookie, '_fbc') ?? attribution?.fbc ?? null,
    ip: ipOf(req.headers.get('cf-connecting-ip')) ?? ipOf(req.headers.get('x-real-ip')),
    userAgent: (req.headers.get('user-agent') ?? '').trim() || null,
  }
}

/** An event id the browser can have minted: a short opaque token, nothing else. */
export function screenMetaEventId(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Za-z0-9._-]{8,80}$/.test(raw) ? raw : null
}

export interface MetaEventInput {
  name: 'Lead' | 'Contact' | 'Purchase'
  eventId: string
  /** Epoch seconds. */
  time?: number
  sourceUrl?: string
  userData: Record<string, unknown>
  value?: { cents: number; currency?: string }
  contentName?: string
}

export function metaEventBody(input: MetaEventInput, cfg: { token: string; testEventCode: string | null }, now: Date = new Date()) {
  const custom: Record<string, unknown> = {}
  if (input.value) {
    custom.value = Math.round(input.value.cents) / 100
    custom.currency = input.value.currency ?? 'USD'
  }
  if (input.contentName) custom.content_name = input.contentName
  return {
    data: [
      {
        event_name: input.name,
        event_time: input.time ?? Math.floor(now.getTime() / 1000),
        event_id: input.eventId,
        action_source: 'website',
        event_source_url: input.sourceUrl ?? CANONICAL_ORIGIN,
        user_data: input.userData,
        ...(Object.keys(custom).length ? { custom_data: custom } : {}),
      },
    ],
    access_token: cfg.token,
    ...(cfg.testEventCode ? { test_event_code: cfg.testEventCode } : {}),
  }
}

/** Never throws, never rejects. Logs a status, never a body. */
export async function sendMetaEvent(input: MetaEventInput): Promise<MetaSendOutcome> {
  const cfg = metaCapiConfig()
  if (!cfg) return 'skipped'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), META_CAPI_TIMEOUT_MS)
  try {
    const res = await fetch(`https://graph.facebook.com/${metaGraphVersion()}/${cfg.pixelId}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(metaEventBody(input, cfg)),
      signal: controller.signal,
    })
    if (!res.ok) {
      console.error(`metaCapi: ${input.name} answered ${res.status}`)
      return 'failed'
    }
    return 'sent'
  } catch (e) {
    console.error(`metaCapi: ${input.name} ${e instanceof Error && e.name === 'AbortError' ? 'timed out' : 'failed'}`)
    return 'failed'
  } finally {
    clearTimeout(timer)
  }
}

/* ── the two reporters ────────────────────────────────────────────────── */

/**
 * An inquiry form was submitted. `eventId` is the id the browser minted
 * (`attribution.meta_event_id`); without one there is no browser twin to match,
 * so a fresh id is used and Meta simply counts the server event.
 *
 * `consented` is the form's own marketing checkbox — the person said yes in this
 * very request, which is the only consent a brand-new lead has.
 */
export async function reportLeadToMeta(
  req: MetaRequestLike & { url?: string },
  args: {
    body: unknown
    name: 'Lead' | 'Contact'
    email?: unknown
    phone?: unknown
    consented: boolean
    contentName?: string
  },
): Promise<MetaSendOutcome> {
  try {
    if (!metaCapiConfig()) return 'skipped'
    // The visitor's own cookie choice, read from this very request.
    if (!requestHasConsent(req.headers)) return 'skipped'
    const att = args.body && typeof args.body === 'object' ? ((args.body as { attribution?: unknown }).attribution as Record<string, unknown> | undefined) : undefined
    const eventId = screenMetaEventId(att?.meta_event_id) ?? `srv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const fbp = typeof att?.fbp === 'string' && /^[A-Za-z0-9._-]{1,200}$/.test(att.fbp) ? att.fbp : undefined
    const fbc = typeof att?.fbc === 'string' && /^[A-Za-z0-9._-]{1,200}$/.test(att.fbc) ? att.fbc : undefined
    return await sendMetaEvent({
      name: args.name,
      eventId,
      sourceUrl: CANONICAL_ORIGIN,
      contentName: args.contentName,
      userData: buildUserData(
        clientFromRequest(req, { fbp, fbc }),
        { email: typeof args.email === 'string' ? args.email : null, phone: typeof args.phone === 'string' ? args.phone : null },
        args.consented === true,
      ),
    })
  } catch {
    return 'failed'
  }
}

/**
 * A deposit landed. Called by the Stripe webhook ONLY on the first processing of
 * a payment (the same `…FirstTime` marker that gates the confirmation email), so
 * a Stripe redelivery cannot report it twice; `eventId` is the PaymentIntent or
 * Checkout Session id, which is also the `order_id` the browser Pixel sends on
 * the success page, so Meta dedupes the pair.
 *
 * The ad click and browser ids come from the booking's stored first touch
 * (`bookings.attribution`); consent is read NOW from the contact.
 */
export async function reportPurchaseToMeta(
  supabase: Supa,
  args: { bookingId: string; eventId: string; valueCents: number },
): Promise<MetaSendOutcome> {
  try {
    if (!metaCapiConfig()) return 'skipped'
    if (!Number.isFinite(args.valueCents) || args.valueCents <= 0) return 'skipped'
    const eventId = screenMetaEventId(args.eventId)
    if (!eventId) return 'skipped'

    const { data: b, error } = await supabase
      .from('bookings')
      .select('contact_id, contact_email, contact_phone, attribution')
      .eq('id', args.bookingId)
      .maybeSingle()
    if (error || !b) return 'skipped'
    const booking = b as { contact_id: string | null; contact_email: string | null; contact_phone: string | null; attribution: Record<string, unknown> | null }

    let consented = false
    if (booking.contact_id) {
      const c = await supabase.from('contacts').select('email_opt_in, status').eq('id', booking.contact_id).maybeSingle()
      if (!c.error) consented = marketingConsent(c.data as { email_opt_in: boolean | null; status: string | null } | null)
    }
    const att = booking.attribution ?? {}
    // The cookie choice the visitor had when they submitted their form.
    if (att.ad_consent !== 'granted') return 'skipped'
    const pick = (k: string) => (typeof att[k] === 'string' && /^[A-Za-z0-9._-]{1,200}$/.test(att[k] as string) ? (att[k] as string) : null)
    return await sendMetaEvent({
      name: 'Purchase',
      eventId,
      sourceUrl: CANONICAL_ORIGIN,
      value: { cents: args.valueCents },
      contentName: 'Booking Deposit',
      // No request here (a webhook): the browser id and click id stored at first
      // touch are the match keys, plus the hashed contact for the opted-in.
      userData: buildUserData({ fbp: pick('fbp'), fbc: pick('fbc') }, { email: booking.contact_email, phone: booking.contact_phone }, consented),
    })
  } catch {
    return 'failed'
  }
}
