/**
 * The owner's daily RSVP digest (asked for by Adam, 2026-10-18).
 *
 *   buildRsvpDigest(supabase, now)  ->  ok { parties, subject, html } | unavailable { reason }
 *   sendRsvpDigest(supabase, now)   ->  what happened, for the cron route to report
 *
 * Every upcoming party with a LIVE invitation, soonest first: who is coming, how
 * many kids and adults, who said no, allergies, and which RSVPs arrived or
 * changed in the last 24 hours — with a link that signs straight into that
 * host's own RSVP page (`/my-booking/invitation`), which is the page the host
 * sees. Those links are minted with a 48-hour life so a daily email does not
 * leave hundreds of live 30-day tokens behind.
 *
 * Owner-only. It goes to `ownerEmail()` through Resend and nowhere else; it is
 * not an evite send (no guest or host receives it), so it does not go through
 * the claimed `evite_sends` path.
 *
 * Three outcomes, never an empty answer: a failed read is `unavailable` and the
 * route answers 503, because "could not read the RSVPs" must not arrive in the
 * inbox looking like "nobody has RSVP'd".
 */

import { Resend } from 'resend'
import type { getSupabase } from '@/lib/supabase'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { ownerEmail } from '@/lib/ownerNotify'
import { escapeHtml } from '@/lib/escapeHtml'
import { mailHref } from '@/lib/emailSafety'
import { etDateString, etToUtc } from '@/lib/partyTime'
import { mintPortalLink } from '@/lib/portalLinkMint'

type Supa = ReturnType<typeof getSupabase>

/** How long a digest's sign-in link stays good. */
export const DIGEST_LINK_TTL_HOURS = 48
/** "New" and "changed" mean within this window before the digest runs. */
const RECENT_MS = 24 * 3_600_000
/** A booking in one of these has no party to RSVP to. */
const DEAD_STATUSES = new Set(['cancelled', 'lost'])

export type DigestRsvp = {
  status: 'yes' | 'no'
  parent_name: string
  children: unknown
  adult_count: number | null
  has_allergy: boolean | null
  allergy_note: string | null
  created_at: string
  updated_at: string
}

export type DigestParty = {
  bookingId: string
  bookingRef: string
  hostName: string | null
  childName: string | null
  packageType: string | null
  partyDate: string
  partyTime: string | null
  rsvpDeadline: string | null
  publicUrl: string
  hostUrl: string | null
  rsvps: DigestRsvp[]
}

type EviteRow = { id: string; booking_id: string; slug: string; rsvp_deadline: string | null }
type BookingRow = {
  id: string; booking_ref: string | null; status: string | null; party_date: string | null; party_time: string | null
  package_type: string | null; child_name: string | null; contact_name: string | null
}

export type DigestRead = { kind: 'ok'; parties: DigestParty[] } | { kind: 'unavailable'; reason: string }

export async function loadRsvpDigest(supabase: Supa, now: Date): Promise<DigestRead> {
  const today = etDateString(now)

  const ev = await supabase
    .from('evites')
    .select('id, booking_id, slug, rsvp_deadline')
    .not('went_live_at', 'is', null)
    .is('archived_at', null)
  if (ev.error) return { kind: 'unavailable', reason: `evites read failed: ${ev.error.message}` }
  const evites = (ev.data ?? []) as unknown as EviteRow[]
  if (evites.length === 0) return { kind: 'ok', parties: [] }

  const bk = await supabase
    .from('bookings')
    .select('id, booking_ref, status, party_date, party_time, package_type, child_name, contact_name')
    .in('id', evites.map(e => e.booking_id))
    .gte('party_date', today)
  if (bk.error) return { kind: 'unavailable', reason: `bookings read failed: ${bk.error.message}` }
  const bookings = new Map<string, BookingRow>()
  for (const b of (bk.data ?? []) as unknown as BookingRow[]) {
    if (b.booking_ref && b.party_date && !DEAD_STATUSES.has(b.status ?? '')) bookings.set(b.id, b)
  }

  const live = evites.filter(e => bookings.has(e.booking_id))
  if (live.length === 0) return { kind: 'ok', parties: [] }

  const rs = await supabase
    .from('evite_rsvps')
    .select('evite_id, status, parent_name, children, adult_count, has_allergy, allergy_note, created_at, updated_at')
    .in('evite_id', live.map(e => e.id))
  if (rs.error) return { kind: 'unavailable', reason: `evite_rsvps read failed: ${rs.error.message}` }
  const byEvite = new Map<string, DigestRsvp[]>()
  for (const r of (rs.data ?? []) as unknown as Array<DigestRsvp & { evite_id: string }>) {
    const list = byEvite.get(r.evite_id) ?? []
    list.push(r)
    byEvite.set(r.evite_id, list)
  }

  const parties: DigestParty[] = live.map(e => {
    const b = bookings.get(e.booking_id)!
    return {
      bookingId: b.id,
      bookingRef: b.booking_ref!,
      hostName: b.contact_name?.trim() || null,
      childName: b.child_name?.trim() || null,
      packageType: b.package_type,
      partyDate: b.party_date!,
      partyTime: b.party_time,
      rsvpDeadline: e.rsvp_deadline,
      publicUrl: `${CANONICAL_ORIGIN}/i/${e.slug}`,
      hostUrl: null,
      rsvps: (byEvite.get(e.id) ?? []).sort((a, z) => z.updated_at.localeCompare(a.updated_at)),
    }
  })
  parties.sort((a, z) => a.partyDate.localeCompare(z.partyDate) || (a.partyTime ?? '').localeCompare(z.partyTime ?? ''))
  return { kind: 'ok', parties }
}

function childNames(children: unknown): string[] {
  if (!Array.isArray(children)) return []
  return children
    .map(c => (c && typeof c === 'object' ? String((c as { first_name?: unknown }).first_name ?? '').trim() : ''))
    .filter(Boolean)
}

function kidCount(r: DigestRsvp): number {
  return r.status === 'yes' ? Math.max(1, childNames(r.children).length || (Array.isArray(r.children) ? r.children.length : 0)) : 0
}

function adultLabel(n: number | null): string {
  const a = n ?? 0
  return a >= 2 ? '2+ adults' : a === 1 ? '1 adult' : 'no adults'
}

export function partyTotals(p: DigestParty, now: Date) {
  const since = now.getTime() - RECENT_MS
  const yes = p.rsvps.filter(r => r.status === 'yes')
  return {
    families: yes.length,
    kids: yes.reduce((s, r) => s + kidCount(r), 0),
    adults: yes.reduce((s, r) => s + (r.adult_count ?? 0), 0),
    declined: p.rsvps.filter(r => r.status === 'no').length,
    allergies: yes.filter(r => r.has_allergy).length,
    recent: p.rsvps.filter(r => Date.parse(r.updated_at) >= since).length,
  }
}

/** `YYYY-MM-DD` → "Sun, Oct 18". Noon Eastern, so the calendar day holds. */
function shortDate(d: string): string {
  return etToUtc(d, 12).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' })
}

function timeLabel(t: string | null): string {
  if (!t) return ''
  const m = /^(\d{1,2}):(\d{2})/.exec(t)
  if (!m || /[ap]m/i.test(t)) return t
  const h = Number(m[1])
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`
}

export function digestHtml(parties: DigestParty[], now: Date): { subject: string; html: string } {
  const since = now.getTime() - RECENT_MS
  const recentTotal = parties.reduce((s, p) => s + partyTotals(p, now).recent, 0)
  const subject =
    `RSVP digest — ${recentTotal} new or changed in the last day · ${parties.length} upcoming ${parties.length === 1 ? 'party' : 'parties'}`

  const blocks = parties.map(p => {
    const t = partyTotals(p, now)
    const title = [p.childName ? `${p.childName}'s` : null, p.packageType || 'Party'].filter(Boolean).join(' ')
    const when = [shortDate(p.partyDate), timeLabel(p.partyTime)].filter(Boolean).join(' at ')

    const rows = p.rsvps
      .map(r => {
        const created = Date.parse(r.created_at) >= since
        const changed = !created && Date.parse(r.updated_at) >= since
        const badge = created
          ? ' <span style="background:#e6f4ea;color:#137333;border-radius:4px;padding:0 5px;font-size:11px">NEW</span>'
          : changed
            ? ' <span style="background:#fef7e0;color:#b06000;border-radius:4px;padding:0 5px;font-size:11px">CHANGED</span>'
            : ''
        const kids = childNames(r.children)
        const detail =
          r.status === 'yes'
            ? `Coming — ${kids.length ? escapeHtml(kids.join(', ')) : `${kidCount(r)} kid(s)`} · ${adultLabel(r.adult_count)}` +
              (r.has_allergy ? ` · <strong style="color:#b00020">Allergy:</strong> ${escapeHtml(r.allergy_note || 'yes (no detail)')}` : '')
            : '<span style="color:#888">Not coming</span>'
        return `<li style="margin:3px 0"><strong>${escapeHtml(r.parent_name)}</strong>${badge} — ${detail}</li>`
      })
      .join('')

    return (
      `<div style="border:1px solid #eee;border-radius:10px;padding:14px 16px;margin:0 0 14px">` +
      `<div style="font-size:16px;font-weight:700">${escapeHtml(title)}</div>` +
      `<div style="color:#555;font-size:13px;margin:2px 0 8px">${escapeHtml(when)} · host ${escapeHtml(p.hostName || '—')} · ${escapeHtml(p.bookingRef)}` +
      (p.rsvpDeadline ? ` · RSVP by ${escapeHtml(shortDate(p.rsvpDeadline))}` : '') +
      `</div>` +
      `<div style="font-size:14px;margin:0 0 6px"><strong>${t.families}</strong> ${t.families === 1 ? 'family' : 'families'} coming · ` +
      `<strong>${t.kids}</strong> kids · <strong>${t.adults}</strong> adults · ${t.declined} not coming` +
      (t.allergies ? ` · <strong style="color:#b00020">${t.allergies} with allergies</strong>` : '') +
      (t.recent ? ` · <strong>${t.recent} new/changed today</strong>` : '') +
      `</div>` +
      (rows ? `<ul style="margin:6px 0 8px;padding-left:18px;font-size:13px">${rows}</ul>` : `<div style="color:#888;font-size:13px;margin:0 0 8px">No RSVPs yet.</div>`) +
      `<div style="font-size:13px">` +
      (mailHref(p.hostUrl) ? `<a href="${mailHref(p.hostUrl)}" style="color:#7a3e9d;font-weight:600">Open the host's RSVP page</a> &nbsp;·&nbsp; ` : '') +
      (mailHref(p.publicUrl) ? `<a href="${mailHref(p.publicUrl)}" style="color:#7a3e9d">The invitation</a>` : '') +
      `</div></div>`
    )
  })

  const html =
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#222;max-width:640px">` +
    `<p style="font-size:15px;margin:0 0 14px">Every upcoming party with a live invitation, soonest first. ` +
    `<strong>${recentTotal}</strong> RSVP${recentTotal === 1 ? '' : 's'} arrived or changed in the last 24 hours.</p>` +
    blocks.join('') +
    `<p style="color:#888;font-size:12px">The host links sign you into that host's own portal page and stop working after ${DIGEST_LINK_TTL_HOURS} hours.</p>` +
    `</div>`
  return { subject, html }
}

export type DigestOutcome =
  | { kind: 'sent'; parties: number; recent: number; linksMinted: number; linksFailed: number }
  | { kind: 'nothing'; reason: string }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'failed'; reason: string }

export async function sendRsvpDigest(supabase: Supa, now: Date = new Date()): Promise<DigestOutcome> {
  const read = await loadRsvpDigest(supabase, now)
  if (read.kind === 'unavailable') return read
  if (read.parties.length === 0) return { kind: 'nothing', reason: 'no upcoming party has a live invitation' }

  let linksMinted = 0
  let linksFailed = 0
  for (const p of read.parties) {
    const link = await mintPortalLink(supabase, p.bookingId, p.bookingRef, '/my-booking/invitation', { ttlHours: DIGEST_LINK_TTL_HOURS })
    if (link.ok) {
      p.hostUrl = link.url
      linksMinted++
    } else {
      linksFailed++
    }
  }

  const { subject, html } = digestHtml(read.parties, now)
  if (!process.env.RESEND_API_KEY) return { kind: 'failed', reason: 'RESEND_API_KEY not set' }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
    const res = await resend.emails.send({ from, to: ownerEmail(), subject, html })
    const err = (res as { error?: { message?: string } | null } | undefined)?.error
    if (err) return { kind: 'failed', reason: `Resend refused: ${err.message ?? 'unknown'}` }
  } catch (e) {
    return { kind: 'failed', reason: e instanceof Error ? e.message : String(e) }
  }
  const recent = read.parties.reduce((s, p) => s + partyTotals(p, now).recent, 0)
  return { kind: 'sent', parties: read.parties.length, recent, linksMinted, linksFailed }
}
