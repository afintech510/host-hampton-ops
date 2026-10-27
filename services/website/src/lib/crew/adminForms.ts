/**
 * The admin side's input screens (prompt 04 §4–§5). Pure: no Supabase, so the
 * client pages can share the field lists and the tests need no database.
 *
 *   screenCrewSetting(key, value)   one `crew_settings` section from the rules editor
 *   screenMemberInput(body, mode)   the roster form
 *   crewPhoneE164(raw)              "+1" + `normalizePhoneKey`, or why not
 *
 * A setting is REFUSED, never clamped. `settingsFromRows` clamps what it reads
 * so a bad row cannot break the arithmetic, but a save that it would then
 * silently change is a save that lies to Allie about what she set. So every
 * accepted value is round-tripped through `settingsFromRows` and must come back
 * exactly as typed.
 */

import { normalizePhoneKey, isPlausibleEmailAddress } from '@/lib/contactLookup'
import { HARD_MAX_STEPS, settingsFromRows, type CrewSettings } from '@/lib/crew/rules'
import { CREW_SKILLS, screenSkills } from '@/lib/crew/skills'

// ── Rules ───────────────────────────────────────────────────────────────────

export interface SettingField {
  field: string
  label: string
  /** How the value is shown and typed. `cents` is entered in dollars. */
  unit: 'cents' | 'steps' | 'count' | 'kids' | 'minutes' | 'hours' | 'days' | 'day_of_month' | 'date'
  min: number
  max: number
  integer: boolean
  help?: string
}

export interface SettingSection {
  key: string
  title: string
  help: string
  fields: SettingField[]
}

const int = (field: string, label: string, unit: SettingField['unit'], min: number, max: number, help?: string): SettingField =>
  ({ field, label, unit, min, max, integer: true, help })
const dec = (field: string, label: string, unit: SettingField['unit'], min: number, max: number, help?: string): SettingField =>
  ({ field, label, unit, min, max, integer: false, help })

/** One section per `crew_settings` key (migration 077's seed), in the order the rules page shows them. */
export const SETTING_SECTIONS: SettingSection[] = [
  {
    key: 'pay', title: 'Pay per party',
    help: 'Flat per party, never hourly. Rate = start + steps × step. Tips under the floor are topped up by Host Hampton.',
    fields: [
      int('crew_start_cents', 'Crew start', 'cents', 0, 100_000),
      int('lead_start_cents', 'Party Lead start', 'cents', 0, 100_000),
      int('step_cents', 'Each step adds', 'cents', 0, 10_000),
      int('max_steps', 'Most steps', 'steps', 0, HARD_MAX_STEPS, `The database allows ${HARD_MAX_STEPS} at most.`),
      int('tip_floor_cents', 'Tip floor per person', 'cents', 0, 100_000),
    ],
  },
  {
    key: 'steps', title: 'How steps move',
    help: 'A late cancel nobody covers, and a no-show, reset to the start. A covered party counts in place of a worked one.',
    fields: [
      int('worked', 'Worked a party', 'steps', 0, HARD_MAX_STEPS),
      int('covered', 'Worked a party they covered', 'steps', 0, HARD_MAX_STEPS),
      int('early_release', 'Cancelled 7+ days ahead', 'steps', -HARD_MAX_STEPS, 0, 'Zero or a loss: -1 takes one step off.'),
    ],
  },
  {
    key: 'slots_by_guests', title: 'Crew needed',
    help: 'Including the Lead: the larger of the minimum and kids ÷ kids-per-crew (rounded up), never more than the maximum.',
    fields: [
      int('min_slots', 'Minimum crew', 'count', 1, 10),
      int('kids_per_crew', 'Kids per crew member', 'kids', 1, 50),
      int('max_slots', 'Maximum crew', 'count', 1, 10),
    ],
  },
  {
    key: 'shift', title: 'Setup and clean-up',
    help: 'Used for overlap checks and the hours on record. Never changes pay.',
    fields: [
      int('setup_minutes', 'Setup before the party', 'minutes', 0, 240),
      int('cleanup_minutes', 'Clean-up after the party', 'minutes', 0, 240),
    ],
  },
  {
    key: 'drops', title: 'Cancelling and cover',
    help: 'Less notice than this is a late cancel: the standbys are asked first, then Allie.',
    fields: [
      int('late_drop_days', 'Late cancel is under', 'days', 1, 60),
      dec('standby_window_hours', 'Standbys get', 'hours', 0, 72),
      dec('unclaimed_warning_hours', 'Warn when still uncovered at', 'hours', 0, 1440, 'Hours before the party.'),
    ],
  },
  {
    key: 'confirmations', title: 'Confirmations',
    help: 'Hours before the party. The request comes first, then the reminder, then the deadline, then the day-before text.',
    fields: [
      int('request_hours_before', 'Ask to confirm', 'hours', 1, 720),
      int('reminder_hours_before', 'Remind', 'hours', 1, 720),
      int('due_hours_before', 'Confirm by', 'hours', 1, 720),
      int('day_before_hours', 'Day-before reminder', 'hours', 0, 720),
    ],
  },
  {
    key: 'launch', title: 'Launch and grace',
    help: 'For the grace days after the launch date (Eastern), step losses are recorded but not applied. No date = not launched, so every loss is waived.',
    fields: [
      { field: 'launch_date', label: 'Launch date', unit: 'date', min: 0, max: 0, integer: false },
      int('grace_days', 'Grace period', 'days', 0, 365),
    ],
  },
  {
    key: 'lead', title: 'Party Lead alert',
    help: 'Alert Allie if a published party has no Lead this close to the day.',
    fields: [int('alert_days_before', 'Alert when no Lead at', 'days', 0, 60)],
  },
  {
    key: 'availability', title: 'Availability',
    help: "Next month's availability is due on this day of the month, with a reminder before it.",
    fields: [
      int('reminder_day_of_month', 'Reminder on the', 'day_of_month', 1, 28),
      int('due_day_of_month', 'Due on the', 'day_of_month', 1, 28),
    ],
  },
  {
    key: 'attendance', title: 'Attendance',
    help: 'Alert Allie if attendance is not marked this long after a party ends.',
    fields: [dec('alert_hours_after_end', 'Alert after', 'hours', 0, 168)],
  },
]

const SECTION_PROP: Record<string, keyof CrewSettings> = {
  pay: 'pay', steps: 'steps', slots_by_guests: 'slotsByGuests', shift: 'shift', drops: 'drops',
  confirmations: 'confirmations', launch: 'launch', lead: 'lead', availability: 'availability', attendance: 'attendance',
}

const camel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())

/** A real `YYYY-MM-DD` calendar date. */
export function isCalendarDate(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

export type SettingScreen = { ok: true; value: Record<string, number | string | null> } | { ok: false; error: string }

export function screenCrewSetting(key: unknown, value: unknown): SettingScreen {
  const section = SETTING_SECTIONS.find(s => s.key === key)
  if (!section) return { ok: false, error: 'Unknown setting.' }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'Send every field of the section.' }
  const v = value as Record<string, unknown>
  const known = new Set(section.fields.map(f => f.field))
  const extra = Object.keys(v).filter(k => !known.has(k))
  if (extra.length) return { ok: false, error: `Unknown field: ${extra.join(', ')}.` }

  const out: Record<string, number | string | null> = {}
  for (const f of section.fields) {
    const raw = v[f.field]
    if (f.unit === 'date') {
      if (raw === null || raw === '') { out[f.field] = null; continue }
      if (!isCalendarDate(raw)) return { ok: false, error: `${f.label}: a date like 2026-12-01, or blank for not launched.` }
      out[f.field] = raw
      continue
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return { ok: false, error: `${f.label}: a number is required.` }
    if (f.integer && !Number.isInteger(raw)) return { ok: false, error: `${f.label}: a whole number.` }
    if (raw < f.min || raw > f.max) return { ok: false, error: `${f.label}: between ${f.min} and ${f.max}.` }
    out[f.field] = raw
  }

  // Relations inside a section.
  const n = (k: string) => out[k] as number
  if (key === 'slots_by_guests' && n('min_slots') > n('max_slots')) return { ok: false, error: 'Minimum crew cannot be more than the maximum.' }
  if (key === 'confirmations') {
    if (!(n('reminder_hours_before') < n('request_hours_before'))) return { ok: false, error: 'The reminder must come after the request (fewer hours before).' }
    if (!(n('due_hours_before') < n('reminder_hours_before'))) return { ok: false, error: 'The deadline must come after the reminder.' }
    if (!(n('day_before_hours') < n('due_hours_before'))) return { ok: false, error: 'The day-before reminder must come after the deadline.' }
  }
  if (key === 'drops' && n('unclaimed_warning_hours') > n('late_drop_days') * 24) {
    return { ok: false, error: 'The uncovered warning must fall inside the late-cancel window.' }
  }
  if (key === 'availability' && !(n('reminder_day_of_month') < n('due_day_of_month'))) {
    return { ok: false, error: 'The reminder must come before the due day.' }
  }

  // Round-trip: what settingsFromRows reads back must be exactly what was typed.
  const parsed = settingsFromRows([{ key: section.key, value: out }])[SECTION_PROP[section.key]] as unknown as Record<string, unknown>
  for (const f of section.fields) {
    if (parsed[camel(f.field)] !== out[f.field]) return { ok: false, error: `${f.label}: that value would not be read back as typed.` }
  }
  return { ok: true, value: out }
}

// ── Roster ──────────────────────────────────────────────────────────────────

export type PhoneScreen = { ok: true; phone: string | null } | { ok: false; error: string }

/** Stored E.164 as `+1` + `normalizePhoneKey` (the `crew_members_phone_check` shape). Blank is "no phone". */
export function crewPhoneE164(raw: unknown): PhoneScreen {
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return { ok: true, phone: null }
  if (typeof raw !== 'string') return { ok: false, error: 'Phone must be text.' }
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 10 && !(digits.length === 11 && digits.startsWith('1'))) return { ok: false, error: 'A 10-digit US phone number.' }
  const key = normalizePhoneKey(raw)
  if (!/^[2-9]\d{9}$/.test(key)) return { ok: false, error: 'That is not a US phone number.' }
  return { ok: true, phone: `+1${key}` }
}

export const MEMBER_STATUSES = ['active', 'paused', 'removed'] as const

/** What the owner row (Allie) may have edited: her name and the notes. Never steps, pay, contact, status. */
const OWNER_EDITABLE = new Set(['first_name', 'last_name', 'admin_notes', 'skills'])

const MEMBER_FIELDS = new Set([
  'first_name', 'last_name', 'email', 'phone', 'can_lead', 'skills', 'email_opt_in', 'sms_opt_in',
  'admin_notes', 'status', 'needs_review', 'steps', 'job_application_id',
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type MemberScreen =
  | { ok: true; row: Record<string, unknown>; startingSteps: number | null }
  | { ok: false; error: string }

function cleanText(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  return t === '' ? null : t.slice(0, max)
}

/**
 * The roster form. `create` needs a first name; `edit` takes whichever fields
 * were sent. Steps are taken ONLY on create (as the starting step, applied by
 * `crew_admin_set_steps` so the ledger records it); afterwards a step change is
 * the override, with its required reason.
 */
export function screenMemberInput(
  body: Record<string, unknown>, mode: { kind: 'create' } | { kind: 'edit'; isOwner: boolean; hasPhone: boolean },
  maxSteps: number = HARD_MAX_STEPS,
): MemberScreen {
  const unknown = Object.keys(body).filter(k => !MEMBER_FIELDS.has(k))
  if (unknown.length) return { ok: false, error: `Unknown field: ${unknown.join(', ')}.` }
  if (mode.kind === 'edit' && mode.isOwner) {
    const refused = Object.keys(body).filter(k => !OWNER_EDITABLE.has(k))
    if (refused.length) return { ok: false, error: "Allie's row is never paid, given steps, notified, paused or removed." }
  }
  if (mode.kind === 'edit' && ('steps' in body || 'job_application_id' in body)) {
    return { ok: false, error: 'Change steps with the override (it needs a reason).' }
  }

  const row: Record<string, unknown> = {}
  if ('first_name' in body || mode.kind === 'create') {
    const v = cleanText(body.first_name, 40)
    if (!v) return { ok: false, error: 'First name is required.' }
    row.first_name = v
  }
  if ('last_name' in body) {
    const v = cleanText(body.last_name, 60)
    if (v === undefined) return { ok: false, error: 'Last name must be text.' }
    row.last_name = v
  }
  if ('email' in body) {
    const v = cleanText(body.email, 254)
    if (v === undefined) return { ok: false, error: 'Email must be text.' }
    if (v !== null && !isPlausibleEmailAddress(v.toLowerCase())) return { ok: false, error: 'That email address does not look right.' }
    row.email = v
  }
  let phonePresent = mode.kind === 'edit' ? mode.hasPhone : false
  if ('phone' in body) {
    const p = crewPhoneE164(body.phone)
    if (!p.ok) return p
    row.phone = p.phone
    phonePresent = p.phone !== null
  }
  for (const b of ['can_lead', 'email_opt_in', 'sms_opt_in', 'needs_review'] as const) {
    if (b in body) {
      if (typeof body[b] !== 'boolean') return { ok: false, error: `${b} must be true or false.` }
      row[b] = body[b]
    }
  }
  if (row.sms_opt_in === true && !phonePresent) return { ok: false, error: 'Texts need a phone number.' }
  if (row.sms_opt_in === true) row.sms_opt_in_at = new Date().toISOString()
  if (row.sms_opt_in === false) row.sms_opt_in_at = null
  // Taking the number away takes the texts with it.
  if ('phone' in body && row.phone === null) { row.sms_opt_in = false; row.sms_opt_in_at = null }

  if ('skills' in body) {
    if (!Array.isArray(body.skills)) return { ok: false, error: 'Skills must be a list.' }
    const known = new Set<string>(CREW_SKILLS)
    const s = screenSkills({
      skills: body.skills.filter(x => typeof x === 'string' && known.has(x)),
      extras: body.skills.filter(x => !(typeof x === 'string' && known.has(x))),
    })
    if (!s.ok) return s
    row.skills = s.skills
  }
  if ('admin_notes' in body) {
    const v = cleanText(body.admin_notes, 4000)
    if (v === undefined) return { ok: false, error: 'Notes must be text.' }
    row.admin_notes = v
  }
  if ('status' in body) {
    if (typeof body.status !== 'string' || !(MEMBER_STATUSES as readonly string[]).includes(body.status)) {
      return { ok: false, error: 'Status is active, paused or removed.' }
    }
    row.status = body.status
  }
  if ('job_application_id' in body && body.job_application_id != null) {
    if (typeof body.job_application_id !== 'string' || !UUID_RE.test(body.job_application_id)) return { ok: false, error: 'Unknown application.' }
    row.job_application_id = body.job_application_id
  }

  let startingSteps: number | null = null
  if (mode.kind === 'create' && body.steps !== undefined && body.steps !== null) {
    const n = body.steps
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > Math.min(maxSteps, HARD_MAX_STEPS)) {
      return { ok: false, error: `Starting step: a whole number from 0 to ${Math.min(maxSteps, HARD_MAX_STEPS)}.` }
    }
    startingSteps = n
  }
  if (Object.keys(row).length === 0) return { ok: false, error: 'Nothing to change.' }
  return { ok: true, row, startingSteps }
}

/** Pre-fill for "Add to crew" from a hired job application. Name split on the first space; nothing invented. */
export function prefillFromApplication(app: { id: string; name: string; email: string; phone: string; role_interest: string }) {
  const parts = app.name.trim().split(/\s+/)
  const phone = crewPhoneE164(app.phone)
  return {
    first_name: parts[0] ?? '',
    last_name: parts.slice(1).join(' ') || null,
    email: app.email.trim(),
    phone: phone.ok ? phone.phone : null,
    can_lead: app.role_interest === 'lead',
    job_application_id: app.id,
  }
}
