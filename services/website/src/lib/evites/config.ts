/**
 * EVITE feature flags (spec §2, §14, §16).
 *
 * Two independent switches, so that turning sends off never takes a live
 * invitation page down in the middle of a party:
 *
 *   EVITES_PAGES  — creation, pages, renders.
 *   EVITES_SENDS  — every evite email.
 *
 * Each is `off | pilot | on`. ANYTHING else — unset, empty, a typo, `true`,
 * `ON ` with a stray space (that one is trimmed and lowercased, deliberately),
 * `enabled` — reads as `off`. The unrecognised value must land on the safe
 * side: a typo cannot switch the feature on for the whole customer base.
 *
 * `pilot` means "only the bookings named in EVITES_PILOT_REFS".
 *
 * Read at call time, never at import: the flags are runtime env, and a module
 * constant would freeze whatever was set when the first request arrived.
 */

export type EviteMode = 'off' | 'pilot' | 'on'

function readMode(raw: string | undefined | null): EviteMode {
  const v = (raw ?? '').trim().toLowerCase()
  return v === 'pilot' || v === 'on' ? v : 'off'
}

/** `EVITES_PAGES`: creation, public pages, renders. */
export function evitePagesMode(): EviteMode {
  return readMode(process.env.EVITES_PAGES)
}

/** `EVITES_SENDS`: every evite email. */
export function eviteSendsMode(): EviteMode {
  return readMode(process.env.EVITES_SENDS)
}

/** The refs named in `EVITES_PILOT_REFS` (comma-separated), upper-cased. */
function pilotRefs(): Set<string> {
  const raw = process.env.EVITES_PILOT_REFS ?? ''
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length > 0),
  )
}

/**
 * Is this booking one of the pilot bookings? An empty or missing ref is never a
 * pilot booking, and neither is anything when the list is empty.
 */
export function isPilotBooking(ref: string | null | undefined): boolean {
  if (typeof ref !== 'string') return false
  const key = ref.trim().toUpperCase()
  if (key === '') return false
  return pilotRefs().has(key)
}

/* ── the launch cutoff for the automatic parent emails ─────────── */

/**
 * `EVITES_AUTOSEND_SINCE` — Adam's ruling, 2026-10-11: "do not email booked clients the invitation; allow it to be
 * created but not emailed unless we request. New bookings yes."
 *
 * The automatic `invite_ready` (and, as defence in depth, `lead_preview`) goes ONLY to a booking whose `created_at`
 * is at or after this instant. Anything booked before it still gets its invitation created (the backfill) and can
 * open it in the portal; its email goes out only when an admin presses "Send invitation email to parent"
 * (`send_invite_ready` on the admin invitation route), which bypasses this cutoff and nothing else.
 *
 * FAILS CLOSED. Unset, empty, or anything that is not a FULL ISO-8601 datetime WITH a zone designator
 * (`2026-10-12T04:00:00Z`, `2026-10-12T00:00:00-04:00`) reads as "no cutoff configured" = NO automatic
 * `invite_ready` / `lead_preview` at all. `new Date('2026')` is January 1st and `new Date('2026-10-12T00:00:00')`
 * is local time, so the SHAPE is screened before the date is parsed; a typo can never mass-mail.
 */
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/

export function eviteAutosendSince(): Date | null {
  const raw = (process.env.EVITES_AUTOSEND_SINCE ?? '').trim()
  const m = ISO_DATETIME.exec(raw)
  if (!m) return null
  const [, , mo, d, h, mi, s] = m
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59 || (s !== undefined && +s > 59)) return null
  const t = Date.parse(raw)
  return Number.isFinite(t) ? new Date(t) : null
}

/**
 * May the AUTOMATIC parent email go for a booking created at `bookingCreatedAt`? False when no valid cutoff is
 * configured, when the booking's creation time is missing or unreadable, or when it was created before the cutoff.
 */
export function autosendAllowedFor(bookingCreatedAt: string | null | undefined): boolean {
  const since = eviteAutosendSince()
  if (!since) return false
  const t = Date.parse(String(bookingCreatedAt ?? ''))
  return Number.isFinite(t) && t >= since.getTime()
}
