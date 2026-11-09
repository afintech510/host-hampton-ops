/**
 * The crew time clock (migration 094). Server code only.
 *
 * Who has one: a row in `crew_time_clock_members` (Lexi at launch). Everyone else gets 404 from
 * the API and no card in the app.
 *
 * What a punch records: the SERVER's time, the coordinates the phone offered, how far that is from
 * the studio, and whether the request came from the studio's internet connection. None of those
 * refuses a punch: denied location, a far-away spot or another network are FLAGS for the admin.
 *
 * "On the studio Wi-Fi": a web page cannot read the Wi-Fi name. What the server can see is the
 * public address the request arrived from; on the studio Wi-Fi that is the studio's address, on
 * cell data it is not. `studio_ips` holds that address. Empty list = unknown, never "no".
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

export const TIME_NOTICE_VERSION = 'v1'
export const TIME_ZONE = 'America/New_York'

export type LocationStatus = 'ok' | 'denied' | 'unavailable'

export interface PunchRow {
  id: string
  member_id: string
  punched_in_at: string
  punched_out_at: string | null
  in_lat: number | null
  in_lng: number | null
  in_accuracy_m: number | null
  in_location_status: LocationStatus
  in_distance_m: number | null
  in_ip: string | null
  in_on_studio_network: boolean | null
  out_lat: number | null
  out_lng: number | null
  out_accuracy_m: number | null
  out_location_status: LocationStatus | null
  out_distance_m: number | null
  out_ip: string | null
  out_on_studio_network: boolean | null
  edited_by: string | null
  edited_at: string | null
  admin_note: string | null
}

export interface TimeConfig {
  studio_ips: string[]
  studio_lat: number
  studio_lng: number
  radius_m: number
}

/** The coordinates a punch carried, after screening. */
export interface Fix {
  status: LocationStatus
  lat: number | null
  lng: number | null
  accuracyM: number | null
}

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLng = rad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))))
}

/** Screen what the browser sent. Anything that is not a plausible coordinate pair reads as "unavailable". */
export function screenFix(body: Record<string, unknown>): Fix {
  const status = body.locationStatus
  if (status === 'denied') return { status: 'denied', lat: null, lng: null, accuracyM: null }
  const lat = body.lat
  const lng = body.lng
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)
    || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { status: 'unavailable', lat: null, lng: null, accuracyM: null }
  }
  const acc = typeof body.accuracy === 'number' && Number.isFinite(body.accuracy) && body.accuracy >= 0 ? Math.round(body.accuracy) : null
  return { status: 'ok', lat, lng, accuracyM: acc }
}

/** The address the request came from (Cloudflare's header, then the proxy's). Null when neither is an address. */
export function requestIp(req: NextRequest): string | null {
  for (const name of ['cf-connecting-ip', 'x-real-ip']) {
    const v = req.headers.get(name)?.trim()
    if (v && /^[0-9a-fA-F:.]{3,45}$/.test(v)) return v
  }
  return null
}

/** true / false, or null when we cannot say (no address, or the studio's address is not recorded yet). */
export function onStudioNetwork(ip: string | null, cfg: TimeConfig): boolean | null {
  if (!ip || cfg.studio_ips.length === 0) return null
  return cfg.studio_ips.includes(ip)
}

export function distanceFromStudio(fix: Fix, cfg: TimeConfig): number | null {
  if (fix.status !== 'ok' || fix.lat == null || fix.lng == null) return null
  return haversineM(fix.lat, fix.lng, cfg.studio_lat, cfg.studio_lng)
}

/** Reasons a punch deserves a look. Empty = nothing to see. Shared by the admin list and tests. */
export function punchFlags(p: PunchRow, cfg: Pick<TimeConfig, 'radius_m'>): string[] {
  const out: string[] = []
  const side = (label: string, status: LocationStatus | null, dist: number | null, net: boolean | null) => {
    if (status === null) return
    if (status === 'denied') out.push(`${label}: location denied`)
    else if (status === 'unavailable') out.push(`${label}: no location`)
    else if (dist !== null && dist > cfg.radius_m) out.push(`${label}: ${dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${dist} m`} from the studio`)
    if (net === false) out.push(`${label}: not on the studio network`)
  }
  side('In', p.in_location_status, p.in_distance_m, p.in_on_studio_network)
  side('Out', p.out_location_status, p.out_distance_m, p.out_on_studio_network)
  if (!p.punched_out_at) out.push('Still clocked in')
  if (p.edited_at) out.push('Edited by admin')
  return out
}

export function minutesWorked(p: Pick<PunchRow, 'punched_in_at' | 'punched_out_at'>, now = new Date()): number {
  const end = p.punched_out_at ? new Date(p.punched_out_at).getTime() : now.getTime()
  return Math.max(0, Math.round((end - new Date(p.punched_in_at).getTime()) / 60000))
}

export function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${String(m).padStart(2, '0')}m`
}

/** The Eastern calendar day of an instant, "YYYY-MM-DD". */
export function etDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

/** The Monday (Eastern) of the week an instant falls in, "YYYY-MM-DD". */
export function etWeekStart(iso: string): string {
  const day = etDay(iso)
  const d = new Date(`${day}T12:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

// ── database ────────────────────────────────────────────────────────────────

type Result<T> = { kind: 'ok'; data: T } | { kind: 'error'; error: string }

export async function loadTimeConfig(sb: SupabaseClient): Promise<Result<TimeConfig>> {
  const { data, error } = await sb.from('crew_time_config').select('studio_ips, studio_lat, studio_lng, radius_m').eq('id', 1).maybeSingle()
  if (error) return { kind: 'error', error: error.message }
  if (!data) return { kind: 'error', error: 'crew_time_config has no row' }
  return { kind: 'ok', data: data as TimeConfig }
}

export interface ClockMember { enabled: boolean; noticeAccepted: boolean }

/** null = this member has no time clock. */
export async function loadClockMember(sb: SupabaseClient, memberId: string): Promise<Result<ClockMember | null>> {
  const { data, error } = await sb.from('crew_time_clock_members')
    .select('enabled, notice_version, notice_accepted_at').eq('member_id', memberId).maybeSingle()
  if (error) return { kind: 'error', error: error.message }
  if (!data || !data.enabled) return { kind: 'ok', data: null }
  return { kind: 'ok', data: { enabled: true, noticeAccepted: !!data.notice_accepted_at && data.notice_version === TIME_NOTICE_VERSION } }
}

export async function listPunches(sb: SupabaseClient, memberId: string, limit = 400): Promise<Result<PunchRow[]>> {
  const { data, error } = await sb.from('crew_time_punches').select('*').eq('member_id', memberId)
    .order('punched_in_at', { ascending: false }).limit(limit)
  if (error) return { kind: 'error', error: error.message }
  return { kind: 'ok', data: (data ?? []) as PunchRow[] }
}

export async function acceptNotice(sb: SupabaseClient, memberId: string): Promise<Result<true>> {
  const { error } = await sb.from('crew_time_clock_members')
    .update({ notice_version: TIME_NOTICE_VERSION, notice_accepted_at: new Date().toISOString() }).eq('member_id', memberId)
  return error ? { kind: 'error', error: error.message } : { kind: 'ok', data: true }
}

export type PunchOutcome =
  | { kind: 'ok'; punch: PunchRow }
  | { kind: 'already'; message: string }
  | { kind: 'error'; error: string }

/** Punch in. The unique partial index is the guard against a double tap: 23505 = already clocked in. */
export async function punchIn(sb: SupabaseClient, memberId: string, fix: Fix, ip: string | null, cfg: TimeConfig): Promise<PunchOutcome> {
  const { data, error } = await sb.from('crew_time_punches').insert({
    member_id: memberId,
    punched_in_at: new Date().toISOString(),
    in_lat: fix.lat, in_lng: fix.lng, in_accuracy_m: fix.accuracyM,
    in_location_status: fix.status,
    in_distance_m: distanceFromStudio(fix, cfg),
    in_ip: ip,
    in_on_studio_network: onStudioNetwork(ip, cfg),
  }).select('*').single()
  if (error) {
    if ((error as { code?: string }).code === '23505') return { kind: 'already', message: "You're already punched in." }
    return { kind: 'error', error: error.message }
  }
  return { kind: 'ok', punch: data as PunchRow }
}

/** Punch out: one conditional UPDATE on the open shift, so a double tap closes it once. */
export async function punchOut(sb: SupabaseClient, memberId: string, fix: Fix, ip: string | null, cfg: TimeConfig): Promise<PunchOutcome> {
  const { data, error } = await sb.from('crew_time_punches').update({
    punched_out_at: new Date().toISOString(),
    out_lat: fix.lat, out_lng: fix.lng, out_accuracy_m: fix.accuracyM,
    out_location_status: fix.status,
    out_distance_m: distanceFromStudio(fix, cfg),
    out_ip: ip,
    out_on_studio_network: onStudioNetwork(ip, cfg),
  }).eq('member_id', memberId).is('punched_out_at', null).select('*').maybeSingle()
  if (error) return { kind: 'error', error: error.message }
  if (!data) return { kind: 'already', message: "You're not punched in." }
  return { kind: 'ok', punch: data as PunchRow }
}
