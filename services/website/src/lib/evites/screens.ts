/**
 * Input screens for the public RSVP routes (spec §2 `screens.ts`, §7.5).
 *
 * Every function here is PURE and returns either a value or the NAME OF THE
 * FIELD that failed, so a route can answer `400 { error, field }` and the form
 * can put the message next to the right input. Nothing here touches the database.
 *
 * The length caps are the table's CHECKs (migration 068), so a value that passes
 * here cannot be refused by the database for length:
 *
 *   parent_name 1..120      child first_name 1..40 (jsonb, so no CHECK, same cap by choice)
 *   allergy_note <= 300     note_to_honoree <= 500      reminder_email <= 254
 *   children 1..6 (yes) / 0 (no)      adult_count 0..2 ("2" means "2+")
 *   reminder_phone_e164 ~ '^\+1[2-9][0-9]{9}$'      birthday_month 1..12
 *
 * Text is TRIMMED and stripped of control characters, zero-width characters and
 * bidi overrides before anything else: those render as nothing (so a "blank" name
 * is not blank) or reorder the text a host reads. A value over its cap is
 * REFUSED rather than silently cut: the form carries the same `maxLength`, so a
 * human never meets this, and a script gets told.
 *
 * `screenPublicCount` refuses 0 (a ticket quantity is positive), and an RSVP's
 * adult count legitimately is 0, so the 0..N screen lives here and is its own
 * function (spec §2).
 */

import { isPlausibleEmailAddress } from '@/lib/contactLookup'

export const PARENT_NAME_MAX = 120
export const CHILD_NAME_MAX = 40
export const ALLERGY_NOTE_MAX = 300
export const NOTE_TO_HONOREE_MAX = 500
export const EMAIL_MAX = 254
export const MAX_CHILDREN = 6
export const MAX_ADULTS = 2

// C0 controls except TAB/LF/CR (handled per field), DEL + C1, zero-width and bidi marks, line/paragraph separators, BOM.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g

/** A single-line name: control characters gone, whitespace collapsed, trimmed. Null when empty or over `max` characters. */
export function screenName(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.replace(UNSAFE, '').replace(/\s+/g, ' ').trim()
  if (s === '' || Array.from(s).length > max) return null
  return s
}

/**
 * Free text that may span lines (a note): control characters gone, CRLF to LF,
 * runs of blank lines squeezed, trimmed. '' (nothing) is `''`, which callers store
 * as NULL. Null when it is not a string or is over `max` characters.
 */
export function screenNote(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const s = raw
    .replace(UNSAFE, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (Array.from(s).length > max) return null
  return s
}

/** A whole number in 0..max (0 is allowed: `screenPublicCount` refuses it). Null for anything else, including 1.5, '2' and NaN. */
export function screenCountFromZero(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  return value >= 0 && value <= max ? value : null
}

export function screenAdultCount(value: unknown): 0 | 1 | 2 | null {
  const n = screenCountFromZero(value, MAX_ADULTS)
  return n === null ? null : (n as 0 | 1 | 2)
}

export function screenBirthdayMonth(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 12) return null
  return value
}

export interface ScreenedChild {
  first_name: string
}

/** `[{firstName}]` (or `[{first_name}]`) to `[{first_name}]`: 1..6 for a yes, exactly 0 for a no. Null when it does not fit. */
export function screenChildren(raw: unknown, status: 'yes' | 'no'): ScreenedChild[] | null {
  if (status === 'no') return []
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_CHILDREN) return null
  const out: ScreenedChild[] = []
  for (const c of raw) {
    const o = c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : null
    const name = o ? screenName(o.firstName ?? o.first_name, CHILD_NAME_MAX) : null
    if (name === null) return null
    out.push({ first_name: name })
  }
  return out
}

export type ReminderContact =
  | { kind: 'none' }
  | { kind: 'email'; email: string }
  | { kind: 'phone'; phoneE164: string }
  | { kind: 'invalid' }

/**
 * The single "Want a reminder?" box. An `@` means email (and must pass
 * `isPlausibleEmailAddress`); otherwise ten digits, or eleven starting with 1,
 * is a US mobile number held as `+1XXXXXXXXXX` (area code and exchange start
 * 2-9, the table CHECK). Empty is `none`. Anything else is `invalid`, which a
 * route turns into a 400 NAMING THE FIELD rather than quietly dropping what the
 * guest typed.
 */
export function screenReminderContact(raw: unknown): ReminderContact {
  if (raw === undefined || raw === null) return { kind: 'none' }
  if (typeof raw !== 'string') return { kind: 'invalid' }
  const s = raw.replace(UNSAFE, '').trim()
  if (s === '') return { kind: 'none' }
  if (s.includes('@')) {
    if (s.length > EMAIL_MAX || !isPlausibleEmailAddress(s)) return { kind: 'invalid' }
    return { kind: 'email', email: s }
  }
  // Only phone punctuation may sit around the digits: letters mean it was not a number.
  if (!/^[+\d\s().-]+$/.test(s)) return { kind: 'invalid' }
  let d = s.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  if (!/^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(d)) return { kind: 'invalid' }
  return { kind: 'phone', phoneE164: `+1${d}` }
}

// ---------------------------------------------------------------- the two bodies

export type ScreenResult<T> = { ok: true; value: T } | { ok: false; field: string; message: string }

const bad = (field: string, message: string): { ok: false; field: string; message: string } => ({ ok: false, field, message })

function asObject(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}

export interface ScreenedRsvp {
  status: 'yes' | 'no'
  parentName: string
  children: ScreenedChild[]
  adultCount: 0 | 1 | 2
  hasAllergy: boolean | null
  allergyNote: string | null
  reminder: ReminderContact
}

/** `POST` body (screens 1-2). The honeypot is read by the route before this runs. */
export function screenRsvpPost(body: unknown): ScreenResult<ScreenedRsvp> {
  const o = asObject(body)
  if (!o) return bad('body', 'Please fill in the form.')

  const status = o.status
  if (status !== 'yes' && status !== 'no') return bad('status', 'Please choose Yes or Can’t make it.')

  const parentName = screenName(o.parentName, PARENT_NAME_MAX)
  if (parentName === null) return bad('parentName', 'Please enter your name.')

  if (status === 'no') {
    // A decline carries no party: whatever else was sent is ignored, not trusted.
    return { ok: true, value: { status, parentName, children: [], adultCount: 0, hasAllergy: null, allergyNote: null, reminder: { kind: 'none' } } }
  }

  const children = screenChildren(o.children, 'yes')
  if (children === null) return bad('children', 'Please add at least one child, with a first name (up to 6).')

  const adultCount = screenAdultCount(o.adultCount)
  if (adultCount === null) return bad('adultCount', 'Please choose how many adults are staying.')

  if (typeof o.hasAllergy !== 'boolean') return bad('hasAllergy', 'Please tell us whether there is a food allergy.')
  let allergyNote: string | null = null
  if (o.hasAllergy) {
    allergyNote = screenNote(o.allergyNote, ALLERGY_NOTE_MAX)
    if (allergyNote === null || allergyNote === '') return bad('allergyNote', 'Please tell us about the allergy (up to 300 characters).')
  }

  const reminder = screenReminderContact(o.reminderContact)
  if (reminder.kind === 'invalid') return bad('reminderContact', 'Please enter an email address or a mobile number.')

  return { ok: true, value: { status, parentName, children, adultCount, hasAllergy: o.hasAllergy, allergyNote, reminder } }
}

/** The caller's stored answer, as far as a PATCH needs to know it. */
export interface ExistingRsvp {
  status: 'yes' | 'no'
  parent_name: string
  children: ScreenedChild[]
  adult_count: number
  has_allergy: boolean | null
  allergy_note: string | null
  reminder_email: string | null
  reminder_phone_e164: string | null
}

export interface ScreenedClub {
  email: string
  birthdayMonth: number | null
  consentVersion: string
}

export interface ScreenedPatch {
  /** Columns to write (snake_case, ready for `.update()`), WITHOUT revision / timestamps / consent fields. */
  columns: Record<string, unknown>
  /** The answer as it will stand after the write. */
  next: Pick<ExistingRsvp, 'status' | 'children' | 'adult_count' | 'has_allergy'>
  /** Set when the box held a (new) address: the route runs the DB recipient cap on it. */
  newReminderEmail: string | null
  /** `reminderOptOut: true`. */
  reminderOptOut: boolean
  club: ScreenedClub | null
  clubOptOut: boolean
  touched: number
}

/**
 * `PATCH` body. Only the keys present are touched; `id` / `evite_id` / anything
 * unknown is IGNORED (never read), and an empty patch is a 400.
 *
 * The result is validated as the whole answer it will become, because the table
 * has two CHECKs a partial patch can break: a `no` must have no children and no
 * adults, and a `yes` must have a child. So `status: 'no'` zeroes the party
 * itself, and `status: 'yes'` on a stored `no` must bring its children.
 */
export function screenRsvpPatch(body: unknown, existing: ExistingRsvp): ScreenResult<ScreenedPatch> {
  const o = asObject(body)
  if (!o) return bad('body', 'Please fill in the form.')
  const has = (k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined

  const columns: Record<string, unknown> = {}
  let touched = 0

  // ---- status / party
  let status: 'yes' | 'no' = existing.status
  if (has('status')) {
    if (o.status !== 'yes' && o.status !== 'no') return bad('status', 'Please choose Yes or Can’t make it.')
    status = o.status
    touched++
  }

  if (has('parentName')) {
    const n = screenName(o.parentName, PARENT_NAME_MAX)
    if (n === null) return bad('parentName', 'Please enter your name.')
    columns.parent_name = n
    touched++
  }

  let children = existing.children
  let adultCount = existing.adult_count
  let hasAllergy = existing.has_allergy
  let allergyNote = existing.allergy_note

  if (status === 'no') {
    children = []
    adultCount = 0
    hasAllergy = null
    allergyNote = null
  } else {
    if (has('children')) {
      const c = screenChildren(o.children, 'yes')
      if (c === null) return bad('children', 'Please add at least one child, with a first name (up to 6).')
      children = c
      touched++
    } else if (existing.status === 'no') {
      return bad('children', 'Please add at least one child, with a first name (up to 6).')
    }
    if (has('adultCount')) {
      const a = screenAdultCount(o.adultCount)
      if (a === null) return bad('adultCount', 'Please choose how many adults are staying.')
      adultCount = a
      touched++
    }
    if (has('hasAllergy')) {
      if (typeof o.hasAllergy !== 'boolean') return bad('hasAllergy', 'Please tell us whether there is a food allergy.')
      hasAllergy = o.hasAllergy
      touched++
    } else if (existing.status === 'no') {
      return bad('hasAllergy', 'Please tell us whether there is a food allergy.')
    }
    if (has('allergyNote')) {
      const n = screenNote(o.allergyNote, ALLERGY_NOTE_MAX)
      if (n === null) return bad('allergyNote', 'That note is too long (up to 300 characters).')
      allergyNote = n === '' ? null : n
      touched++
    }
    if (hasAllergy === true && (allergyNote === null || allergyNote === '')) return bad('allergyNote', 'Please tell us about the allergy (up to 300 characters).')
    if (hasAllergy !== true) allergyNote = null // dropped when there is no allergy
  }

  if (status !== existing.status) columns.status = status
  if (status === 'no' || has('children') || existing.status === 'no') columns.children = children
  if (status === 'no' || has('adultCount') || existing.status === 'no') columns.adult_count = adultCount
  if (status === 'no' || has('hasAllergy') || existing.status === 'no') columns.has_allergy = hasAllergy
  if (status === 'no' || has('allergyNote') || has('hasAllergy') || existing.status === 'no') columns.allergy_note = allergyNote

  // ---- the note to the birthday child
  if (has('noteToHonoree')) {
    const n = screenNote(o.noteToHonoree, NOTE_TO_HONOREE_MAX)
    if (n === null) return bad('noteToHonoree', 'That note is too long (up to 500 characters).')
    columns.note_to_honoree = n === '' ? null : n
    touched++
  }

  // ---- reminders
  let newReminderEmail: string | null = null
  if (has('reminderContact')) {
    const r = screenReminderContact(o.reminderContact)
    if (r.kind === 'invalid') return bad('reminderContact', 'Please enter an email address or a mobile number.')
    touched++
    if (status === 'no') {
      // A decline gets no reminders: leave the stored contact alone rather than add one.
    } else if (r.kind === 'none') {
      columns.reminder_email = null
      columns.reminder_phone_e164 = null
    } else if (r.kind === 'email') {
      columns.reminder_email = r.email
      columns.reminder_phone_e164 = null // the table allows one channel
      if ((existing.reminder_email ?? '').toLowerCase() !== r.email.toLowerCase()) {
        newReminderEmail = r.email
        columns.reminder_opt_out_at = null // a new address typed on purpose is a fresh ask
      }
    } else {
      columns.reminder_phone_e164 = r.phoneE164
      columns.reminder_email = null
      if (existing.reminder_phone_e164 !== r.phoneE164) columns.reminder_opt_out_at = null
    }
  }

  let reminderOptOut = false
  if (has('reminderOptOut')) {
    if (o.reminderOptOut !== true) return bad('reminderOptOut', 'Invalid request.')
    reminderOptOut = true
    touched++
  }

  // ---- the club
  let club: ScreenedClub | null = null
  if (has('club')) {
    const c = asObject(o.club)
    if (!c || c.optIn !== true) return bad('club', 'Invalid request.')
    const email = typeof c.email === 'string' ? c.email.replace(UNSAFE, '').trim() : ''
    if (email.length > EMAIL_MAX || !isPlausibleEmailAddress(email)) return bad('club.email', 'Please enter a valid email address.')
    let birthdayMonth: number | null = null
    if (c.birthdayMonth !== undefined && c.birthdayMonth !== null && c.birthdayMonth !== '') {
      birthdayMonth = screenBirthdayMonth(c.birthdayMonth)
      if (birthdayMonth === null) return bad('club.birthdayMonth', 'Please choose a month.')
    }
    if (typeof c.consentVersion !== 'string' || c.consentVersion.length === 0 || c.consentVersion.length > 40) return bad('club.consentVersion', 'Invalid request.')
    club = { email, birthdayMonth, consentVersion: c.consentVersion }
    touched++
  }

  let clubOptOut = false
  if (has('clubOptOut')) {
    if (o.clubOptOut !== true) return bad('clubOptOut', 'Invalid request.')
    clubOptOut = true
    touched++
  }
  if (club && clubOptOut) return bad('club', 'Invalid request.')

  if (touched === 0) return bad('body', 'Nothing to update.')

  return {
    ok: true,
    value: {
      columns,
      next: { status, children, adult_count: adultCount, has_allergy: hasAllergy },
      newReminderEmail,
      reminderOptOut,
      club,
      clubOptOut,
      touched,
    },
  }
}
