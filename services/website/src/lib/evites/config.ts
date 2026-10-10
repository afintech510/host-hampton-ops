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
