/**
 * Crew work that is not a booked party (Adam, 2026-11-05: "load other work
 * scenarios besides parties"). Allie adds one by hand from the schedule page:
 * a day, a start and end, how many people, and where. It is a crew party row
 * like any other (draft until she publishes it, claimed and covered the same
 * way), with two differences that live here and nowhere else:
 *
 *   - it has NO Party Lead spot: every spot is a plain crew spot, like a studio
 *     rental's;
 *   - it has no child, no kids count, no booking and no food: the crew card
 *     says what the work is, not who the party is for.
 *
 * Pure: no database, no clock. The CHECK on `crew_parties.party_kind`
 * (migration 089) must list exactly these kinds.
 */

export const WORK_KINDS = ['clean_floor', 'dropoff_event', 'balloon_decor', 'party_setup', 'retail_shift'] as const
export type WorkKind = (typeof WORK_KINDS)[number]

export interface WorkType {
  kind: WorkKind
  label: string
  emoji: string
  /** One line for Allie when she picks it. */
  blurb: string
  /** How many people it needs unless she says otherwise. */
  defaultSpots: number
  /** Eastern, 24-hour. Only a starting point: she can change both. */
  defaultStart: string
  defaultEnd: string
}

export const WORK_TYPES: readonly WorkType[] = [
  { kind: 'clean_floor', label: 'Clean Floor', emoji: '🧹', blurb: 'Deep clean the studio floor.', defaultSpots: 1, defaultStart: '09:00', defaultEnd: '11:00' },
  { kind: 'dropoff_event', label: 'Drop-off Event', emoji: '🎨', blurb: 'Kids are dropped off; the crew runs the event.', defaultSpots: 2, defaultStart: '10:00', defaultEnd: '13:00' },
  { kind: 'balloon_decor', label: 'Balloon Decor', emoji: '🎈', blurb: 'Build balloon decor for a party or the studio.', defaultSpots: 1, defaultStart: '09:00', defaultEnd: '12:00' },
  { kind: 'party_setup', label: 'Party Setup', emoji: '🛠️', blurb: 'Set up a party room ahead of time.', defaultSpots: 2, defaultStart: '10:00', defaultEnd: '12:00' },
  { kind: 'retail_shift', label: 'Retail Shift', emoji: '🛍️', blurb: 'Work the shop floor and register.', defaultSpots: 1, defaultStart: '11:00', defaultEnd: '17:00' },
]

export function isWorkKind(v: unknown): v is WorkKind {
  return typeof v === 'string' && (WORK_KINDS as readonly string[]).includes(v)
}

export function workTypeOf(kind: string | null | undefined): WorkType | null {
  return WORK_TYPES.find(t => t.kind === kind) ?? null
}

/**
 * Does this kind of crew work have a Party Lead spot? Parties do; a studio
 * rental (a Party Helper) and every kind of work here do not.
 */
export function kindHasLead(kind: string): boolean {
  return kind !== 'studio_rental' && !isWorkKind(kind)
}
