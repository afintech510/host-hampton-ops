/**
 * Self-reported skills (prompt 03 §4). Informational only: nothing assigns,
 * pays or ranks by them.
 *
 * Stored in `crew_members.skills text[]` (CHECK cardinality <= 30) as the
 * labels below plus up to ten free-text extras.
 */

export const CREW_SKILLS = [
  'Hair (braids/tinsel/styling)',
  'Nails',
  'Arts & crafts',
  'Photo booth setup',
  'POS/card machine',
  'Deep clean floors',
  'Balloon arch/garland',
  'Face painting',
  'Has a car',
] as const

export const MAX_EXTRAS = 10
export const MAX_EXTRA_LENGTH = 40

export type SkillsScreen = { ok: true; skills: string[] } | { ok: false; error: string }

/**
 * The one screen for a skills save. Known labels are kept only if they are on
 * the list; extras are trimmed, inner whitespace collapsed, control characters
 * dropped, de-duplicated without regard to case (and against the list), and
 * refused past 40 characters or past ten entries rather than silently cut.
 */
export function screenSkills(input: { skills?: unknown; extras?: unknown }): SkillsScreen {
  const picked = Array.isArray(input.skills) ? input.skills : []
  const extrasIn = Array.isArray(input.extras) ? input.extras : []
  if (picked.length > CREW_SKILLS.length * 2 || extrasIn.length > MAX_EXTRAS * 2) return { ok: false, error: 'Too many entries.' }

  const known = new Set<string>(CREW_SKILLS)
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of picked) {
    if (typeof v !== 'string' || !known.has(v) || seen.has(v.toLowerCase())) continue
    seen.add(v.toLowerCase())
    out.push(v)
  }
  // Keep the list's own order, whatever order the boxes were ticked in.
  out.sort((a, b) => CREW_SKILLS.indexOf(a as typeof CREW_SKILLS[number]) - CREW_SKILLS.indexOf(b as typeof CREW_SKILLS[number]))

  const extras: string[] = []
  for (const v of extrasIn) {
    if (typeof v !== 'string') return { ok: false, error: 'Each extra skill must be text.' }
    // eslint-disable-next-line no-control-regex
    const clean = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!clean) continue
    if (clean.length > MAX_EXTRA_LENGTH) return { ok: false, error: `Keep each extra skill to ${MAX_EXTRA_LENGTH} characters.` }
    if (seen.has(clean.toLowerCase())) continue
    seen.add(clean.toLowerCase())
    extras.push(clean)
  }
  if (extras.length > MAX_EXTRAS) return { ok: false, error: `Up to ${MAX_EXTRAS} extra skills.` }
  return { ok: true, skills: [...out, ...extras] }
}

/** Split a stored list back into ticked boxes and free-text extras. */
export function splitSkills(stored: ReadonlyArray<string>): { picked: string[]; extras: string[] } {
  const known = new Set<string>(CREW_SKILLS)
  return { picked: stored.filter(s => known.has(s)), extras: stored.filter(s => !known.has(s)) }
}
