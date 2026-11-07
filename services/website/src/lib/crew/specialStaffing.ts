import type { getSupabase } from '@/lib/supabase'

/**
 * Special staffing: things a party or rental has bought that need a particular PERSON,
 * not just the usual crew head count. The staffing page raises an alert for each so it is
 * not missed:
 *
 *   party_helper   a Party Helper (a room rental's crew spot is the helper)
 *   face_painter   a Face Painter: an outside performer, with no spot in the crew app
 *   character      a Character Visit: the same
 *   entertainment  any other entertainment add-on (a DJ, a magician, ...)
 *
 * Read only, and it carries no prices. The names come from what the customer actually
 * bought (`booking_line_items`), optional (quoted, not charged) lines excluded.
 */

type Supa = ReturnType<typeof getSupabase>

export type SpecialKind = 'party_helper' | 'face_painter' | 'character' | 'entertainment'

export interface SpecialStaffing {
  kind: SpecialKind
  /** What was bought, as it reads on the invoice: "Face Painter". */
  label: string
  quantity: number
  /** True when the crew app has a spot for it (a helper); false when someone must be arranged outside it. */
  crewSpot: boolean
  /** What to do about it, in a sentence. */
  action: string
}

export interface LineLike {
  name: string
  category?: string | null
  quantity?: number | null
  is_optional?: boolean | null
}

const ACTION: Record<SpecialKind, string> = {
  party_helper: 'A Party Helper needs a crew member on the spot: make sure it is filled and confirmed.',
  face_painter: 'An outside performer: arrange who is coming and confirm them. The crew app has no spot for this.',
  character: 'A character visit: arrange the character and confirm them. The crew app has no spot for this.',
  entertainment: 'Entertainment someone has to provide: confirm who is coming. The crew app has no spot for this.',
}

export function kindOfLine(l: Pick<LineLike, 'name' | 'category'>): SpecialKind | null {
  const name = l.name ?? ''
  // A themed party named "Princess Party" is a theme, not a character booking.
  if (l.category === 'theme' || l.category === 'package' || l.category === 'rental') return null
  if (/party\s*helper/i.test(name)) return 'party_helper'
  if (/face\s*paint/i.test(name)) return 'face_painter'
  if (/character\s*(visit|appearance)|\bmascot\b/i.test(name) || /^character\b/i.test(name)) return 'character'
  if (l.category === 'entertainment-add-on') return 'entertainment'
  return null
}

/** The special staffing among a booking's lines, one entry per thing bought, in the order they matter. */
export function specialStaffingOf(lines: LineLike[]): SpecialStaffing[] {
  const out: SpecialStaffing[] = []
  for (const l of lines) {
    if (l.is_optional) continue
    const kind = kindOfLine(l)
    if (!kind) continue
    out.push({
      kind,
      label: l.name.replace(/\s*\((?:1st|2nd|3rd)[^)]*\)\s*$/i, '').trim(),
      quantity: Math.max(1, Math.floor(Number(l.quantity) || 1)),
      crewSpot: kind === 'party_helper',
      action: ACTION[kind],
    })
  }
  const order: SpecialKind[] = ['party_helper', 'face_painter', 'character', 'entertainment']
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
}

/** The booking's special staffing, or null when its lines could not be read (never "none"). */
export async function loadSpecialStaffing(sb: Supa, bookingId: string | null | undefined): Promise<SpecialStaffing[] | null> {
  if (!bookingId) return []
  const { data, error } = await sb.from('booking_line_items').select('name, category, quantity, is_optional').eq('booking_id', bookingId)
  if (error) return null
  return specialStaffingOf((data ?? []) as LineLike[])
}
