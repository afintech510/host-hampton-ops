/**
 * The troop family board — /troop2514 (migration 074).
 *
 * Allie's Girl Scouts troop: announcements, the meeting schedule, snack sign-ups
 * and three private forms to the leaders. Unlisted and noindex; nothing on the
 * Host Hampton site links to it. Leaders manage it from the page's Leaders tab
 * (lib/troopAuth.ts).
 *
 * Everything a route needs to decide lives here: which troops exist, how every
 * field a stranger can type is screened, and what the PUBLIC board may show. The
 * routes stay thin so the screens are one definition, not one per handler.
 */

import { etDateString } from './partyTime'

export interface TroopConfig {
  number: string
  /** Shown in the page header and the leaders' emails. */
  name: string
  /** Default welcome line until a leader saves their own. */
  welcome: string
}

export const TROOPS: Record<string, TroopConfig> = {
  '2514': {
    number: '2514',
    name: 'Girl Scouts Troop 2514',
    welcome: 'Welcome, families! Troop news, meetings, snack sign-ups and a quick way to reach our leaders.',
  },
}

export function troopConfig(troop: string | null | undefined): TroopConfig | null {
  return troop && Object.prototype.hasOwnProperty.call(TROOPS, troop) ? TROOPS[troop] : null
}

/* ── Rows ─────────────────────────────────────────────────────────────────── */

export interface TroopPost {
  id: string
  title: string
  body: string
  post_date: string
  pinned: boolean
}

export interface TroopScheduleItem {
  id: string
  title: string
  kind: 'meeting' | 'event'
  event_date: string
  /** NULL = time not known yet; the page shows "Time TBA" (migration 075). */
  start_time: string | null
  end_time: string | null
  location: string | null
  notes: string | null
  needs_snack: boolean
}

export interface TroopSnackClaim {
  schedule_id: string
  parent_name: string
  scout_name: string
  item: string
}

export interface TroopInboxItem {
  id: string
  kind: 'absence' | 'idea' | 'message'
  scout_name: string | null
  parent_name: string | null
  email: string | null
  reply_to: string | null
  missed_date: string | null
  idea_kind: string | null
  body: string | null
  anonymous: boolean
  done: boolean
  created_at: string
}

export interface TroopSettings {
  welcome: string | null
  leader_names: string[]
  leader_emails: string[]
}

export const POST_COLUMNS = 'id, title, body, post_date, pinned'
export const SCHEDULE_COLUMNS = 'id, title, kind, event_date, start_time, end_time, location, notes, needs_snack'
export const SNACK_COLUMNS = 'schedule_id, parent_name, scout_name, item'
export const INBOX_COLUMNS =
  'id, kind, scout_name, parent_name, email, reply_to, missed_date, idea_kind, body, anonymous, done, created_at'
export const FAMILY_COLUMNS = 'id, parent_name, scout_name, email, phone, consented_at'

/** A family who opted in to updates (migration 076). Leaders only. */
export interface TroopFamily {
  id: string
  parent_name: string
  scout_name: string | null
  email: string
  phone: string | null
  consented_at: string
}

/**
 * The exact sentence a parent agrees to on the "Get updates" tab, stored on
 * their row. The form imports this too, so what they read is what is recorded.
 */
export function familyConsentText(troopName: string, withPhone: boolean): string {
  return `Yes, send me ${troopName} updates and announcements by email${withPhone ? ' and text message' : ''}.`
}

/**
 * What the PUBLIC board shows of a snack claim: who is bringing what. Never the
 * scout's name — this page is reachable by anyone holding the link, and the
 * child's name is for the leaders.
 */
export interface PublicSnack {
  parent_name: string
  item: string
}
export function publicSnack(c: TroopSnackClaim): PublicSnack {
  return { parent_name: c.parent_name, item: c.item }
}

/** Today in Eastern time. The box is UTC; a 9pm meeting is not "past" at 8pm ET. */
export function troopToday(now: Date = new Date()): string {
  return etDateString(now)
}

/* ── Screens ──────────────────────────────────────────────────────────────── */

type Screened<T> = { ok: true; value: T } | { ok: false; error: string }

/** Trim, collapse to a single line unless `multiline`, bound the length. Empty → ''. */
export function cleanText(raw: unknown, max: number, multiline = false): string {
  if (typeof raw !== 'string') return ''
  let s = raw.replace(/\u0000/g, '')
  s = multiline ? s.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ')
  return s.trim().slice(0, max)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export function isIsoDate(raw: unknown): raw is string {
  if (typeof raw !== 'string' || !DATE_RE.test(raw)) return false
  const d = new Date(`${raw}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
export function cleanTime(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().slice(0, 5)
  return TIME_RE.test(t) ? t : null
}

const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[a-z]{2,}$/i
export function isEmail(raw: string): boolean {
  return raw.length <= 120 && EMAIL_RE.test(raw)
}

export const IDEA_KINDS = ['Activity idea', 'Trip idea', 'Badge idea', 'General feedback'] as const

export type InboxEntry =
  | { kind: 'absence'; scout_name: string; parent_name: string; missed_date: string; body: string | null; email: string | null }
  | { kind: 'idea'; idea_kind: string; body: string; anonymous: boolean; parent_name: string | null }
  | { kind: 'message'; parent_name: string; reply_to: string; body: string }

/** One of the three private family forms. */
export function screenInboxEntry(body: Record<string, unknown>): Screened<InboxEntry> {
  const kind = body.kind
  if (kind === 'absence') {
    const scout = cleanText(body.scout, 40)
    const parent = cleanText(body.parent, 60)
    if (!scout || !parent || !isIsoDate(body.date)) {
      return { ok: false, error: "Please add your scout's name, your name and the date." }
    }
    const email = cleanText(body.email, 120)
    if (email && !isEmail(email)) return { ok: false, error: 'That email address does not look right.' }
    return {
      ok: true,
      value: {
        kind,
        scout_name: scout,
        parent_name: parent,
        missed_date: body.date,
        body: cleanText(body.note, 500, true) || null,
        email: email || null,
      },
    }
  }
  if (kind === 'idea') {
    const text = cleanText(body.text, 1000, true)
    if (!text) return { ok: false, error: 'Please write your idea first.' }
    const ideaKind = (IDEA_KINDS as readonly string[]).includes(String(body.ideaKind)) ? String(body.ideaKind) : IDEA_KINDS[0]
    const anonymous = body.anon === true
    return {
      ok: true,
      value: { kind, idea_kind: ideaKind, body: text, anonymous, parent_name: anonymous ? null : cleanText(body.name, 60) || null },
    }
  }
  if (kind === 'message') {
    const name = cleanText(body.name, 60)
    const reply = cleanText(body.reply, 120)
    const text = cleanText(body.text, 1500, true)
    if (!name || !reply || !text) return { ok: false, error: 'Please add your name, how to reach you, and a message.' }
    return { ok: true, value: { kind, parent_name: name, reply_to: reply, body: text } }
  }
  return { ok: false, error: 'Unknown form.' }
}

export function screenSnackClaim(
  body: Record<string, unknown>,
): Screened<{ schedule_id: string; parent_name: string; scout_name: string; item: string }> {
  const scheduleId = typeof body.scheduleId === 'string' && /^[0-9a-f-]{36}$/i.test(body.scheduleId) ? body.scheduleId : ''
  const parent = cleanText(body.parent, 60)
  const scout = cleanText(body.scout, 40)
  const item = cleanText(body.item, 80)
  if (!scheduleId) return { ok: false, error: 'Pick a date first.' }
  if (!parent || !scout || !item) return { ok: false, error: 'Please fill in all three fields.' }
  return { ok: true, value: { schedule_id: scheduleId, parent_name: parent, scout_name: scout, item } }
}

/** At least ten digits, as typed (leaders text from their own phones). */
export function cleanPhone(raw: unknown): Screened<string | null> {
  const s = cleanText(raw, 30)
  if (!s) return { ok: true, value: null }
  const digits = s.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 11 || !/^[\d\s()+.-]+$/.test(s)) {
    return { ok: false, error: 'That phone number does not look right.' }
  }
  return { ok: true, value: s }
}

export function screenFamilySignup(
  body: Record<string, unknown>,
  troopName: string,
): Screened<{ parent_name: string; scout_name: string | null; email: string; phone: string | null; consent_text: string }> {
  const parent = cleanText(body.name, 60)
  const email = cleanText(body.email, 120)
  if (!parent || !email) return { ok: false, error: 'Please add your name and email.' }
  if (!isEmail(email)) return { ok: false, error: 'That email address does not look right.' }
  const phone = cleanPhone(body.phone)
  if (!phone.ok) return phone
  if (body.consent !== true) return { ok: false, error: 'Please tick the box to say yes to updates.' }
  return {
    ok: true,
    value: {
      parent_name: parent,
      scout_name: cleanText(body.scout, 60) || null,
      email,
      phone: phone.value,
      consent_text: familyConsentText(troopName, !!phone.value),
    },
  }
}

export function screenPost(body: Record<string, unknown>): Screened<Omit<TroopPost, 'id'>> {
  const title = cleanText(body.title, 100)
  const text = cleanText(body.body, 2000, true)
  if (!title || !text) return { ok: false, error: 'An announcement needs a title and a message.' }
  if (!isIsoDate(body.post_date)) return { ok: false, error: 'Pick a date.' }
  return { ok: true, value: { title, body: text, post_date: body.post_date, pinned: body.pinned === true } }
}

export function screenScheduleItem(body: Record<string, unknown>): Screened<Omit<TroopScheduleItem, 'id'>> {
  const title = cleanText(body.title, 80)
  if (!title) return { ok: false, error: 'Give it a title.' }
  if (!isIsoDate(body.event_date)) return { ok: false, error: 'Pick a date.' }
  // A blank start time means "Time TBA"; a filled-in one that does not parse is
  // a mistake, not a TBA.
  const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
  const start = cleanTime(body.start_time)
  if (!start && !blank(body.start_time)) return { ok: false, error: 'That start time does not look right.' }
  const end = cleanTime(body.end_time)
  if (!end && !blank(body.end_time)) return { ok: false, error: 'That end time does not look right.' }
  if (end && !start) return { ok: false, error: 'Add a start time, or clear the end time.' }
  if (end && start && end <= start) return { ok: false, error: 'The end time is before the start time.' }
  return {
    ok: true,
    value: {
      title,
      kind: body.kind === 'event' ? 'event' : 'meeting',
      event_date: body.event_date,
      start_time: start,
      end_time: end,
      location: cleanText(body.location, 100) || null,
      notes: cleanText(body.notes, 200) || null,
      needs_snack: body.needs_snack === true,
    },
  }
}

export function screenSettings(body: Record<string, unknown>): Screened<TroopSettings> {
  const names = (Array.isArray(body.leader_names) ? body.leader_names : [])
    .map(n => cleanText(n, 60))
    .filter(Boolean)
    .slice(0, 8)
  const emails = (Array.isArray(body.leader_emails) ? body.leader_emails : [])
    .map(e => cleanText(e, 120).toLowerCase())
    .filter(Boolean)
  const bad = emails.find(e => !isEmail(e))
  if (bad) return { ok: false, error: `"${bad}" does not look like an email address.` }
  return {
    ok: true,
    value: { welcome: cleanText(body.welcome, 160) || null, leader_names: names, leader_emails: emails.filter((e, i) => emails.indexOf(e) === i).slice(0, 6) },
  }
}

/* ── Display ──────────────────────────────────────────────────────────────── */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "Thursday, Oct 23" for a YYYY-MM-DD, read as a calendar date (no timezone shift). */
export function fmtLongDate(iso: string): string {
  if (!isIsoDate(iso)) return iso
  const d = new Date(`${iso}T12:00:00Z`)
  return `${DOWL[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}`
}
