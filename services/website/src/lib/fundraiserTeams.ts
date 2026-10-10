/**
 * Which fundraiser an order belongs to — ONE definition.
 *
 * `cm_cheer_orders` held 21 real orders and no column saying whose they were,
 * because until now there was only ever one real customer for it (`/li-high` is
 * a sales sample that posts as CM Cheer). Adding a second real team — the ESM
 * Sharks — makes "whose order is this" a question the table has to be able to
 * answer, so migration 051 adds `team` and this module is the list of legal
 * values.
 *
 * Everything that differs between two otherwise identical storefronts lives
 * HERE rather than being spelled out again in the page, the API route and the
 * two confirmation emails (rule 11 — the CM Cheer password was wrong in four
 * places at once because the same fact was written four times). The order-number
 * prefix is the one field that is NOT authoritative here: the DB trigger mints
 * it, and this copy is for display and for the test that keeps the two in step.
 */

export interface FundraiserTeam {
  /** `cm_cheer_orders.team`. Also the first path segment of the order page. */
  slug: string
  /** Short name, e.g. for an email subject line. */
  name: string
  /** Who the money is being raised for, as it should read in a footer. */
  organization: string
  /** The Venmo account the ORDER PAGE tells the customer to pay. */
  venmoHandle: string
  venmoUrl: string
  /**
   * The handle the CONFIRMATION EMAIL names.
   *
   * These two should be the same string and for the Sharks they are. For CM
   * Cheer they are NOT, and never have been: the page has always said `@CM_PAL`
   * while the email has always said `@CM-PAL-Red-Devils-Football`. A customer
   * who orders on the page and pays from the email is aiming at a different
   * account than one who pays from the page, and there is no way to tell from
   * here which of the two is the booster club's real Venmo.
   *
   * So the discrepancy is RECORDED rather than guessed at. Quietly collapsing
   * them would be changing where a live fundraiser's money is sent on nothing
   * but a hunch — needs-Adam. Once he says which is right, set both fields to
   * it and delete this one.
   */
  venmoEmailHandle: string
  /**
   * The `order_ref` prefix the DB trigger mints for this team. Mirrored from
   * `generate_cm_cheer_order_ref()`; a test asserts the two agree, because a
   * prefix that drifts here silently mislabels an order number in an email.
   */
  orderPrefix: string
  /** Accent colour used in the transactional emails (hex, no alpha). */
  emailAccent: string
  /** Where the organizer dashboard for this team lives. */
  ordersPath: string
  /**
   * What this fundraiser calls the young person an order is for.
   *
   * CM Cheer is a squad, so "Athlete"; the Sharks page is run by an elementary
   * school PTO, so "Child". The DB column is `athlete_name` and the API field is
   * `athleteName` for BOTH — renaming those would mean a migration on a live
   * table and a breaking change to a shared endpoint, to alter a word nobody
   * but us reads. This is the label, not the field.
   */
  personLabel: string
  /**
   * Whether an order must name the child's teacher (`teacher_name`, migration
   * 067). True for a school PTO, where an in-class handout is sorted by room;
   * false for a squad. When false the route stores NULL whatever was posted.
   */
  collectsTeacher: boolean
  /** Who receives a copy of every new-order notification. Absent = Host Hampton only. */
  organizerEmail?: string
}

export const FUNDRAISER_TEAMS: Record<string, FundraiserTeam> = {
  'cm-cheer': {
    slug: 'cm-cheer',
    name: 'CM Cheer',
    organization: 'Center Moriches Cheerleading Boosters',
    venmoHandle: '@CM_PAL',
    venmoUrl: 'https://www.venmo.com/u/CM_PAL',
    venmoEmailHandle: '@CM-PAL-Red-Devils-Football',
    orderPrefix: 'CMC-',
    emailAccent: '#CE1126',
    ordersPath: '/cm-cheer/orders',
    personLabel: 'Athlete',
    collectsTeacher: false,
  },
  'esm-sharks': {
    slug: 'esm-sharks',
    name: 'ESM Sharks',
    organization: 'Eastport-Tuttle PTO',
    // The PTO's own account, set 2026-09-16 (was Host Hampton's as a
    // placeholder). Verified against Venmo before it went live: the profile at
    // this username reports itself as "Eastport Tuttle PTO | @Eastport-tuttlepto-1".
    // All three fields are the same string on purpose — see venmoEmailHandle.
    venmoHandle: '@Eastport-tuttlepto-1',
    venmoUrl: 'https://www.venmo.com/u/Eastport-tuttlepto-1',
    venmoEmailHandle: '@Eastport-tuttlepto-1',
    orderPrefix: 'ESM-',
    emailAccent: '#0C2340',
    ordersPath: '/esm-sharks/orders',
    personLabel: 'Child',
    collectsTeacher: true,
    organizerEmail: 'Eastporttuttlepto@gmail.com',
  },
}

/** The value written when a page posts without saying which team it is. */
export const DEFAULT_FUNDRAISER_TEAM = 'cm-cheer'

export const FUNDRAISER_TEAM_SLUGS: string[] = Object.keys(FUNDRAISER_TEAMS)

/**
 * Resolve a posted `team` to a known one.
 *
 * An absent value means the caller is `/cm-cheer` or `/li-high`, neither of
 * which sends the field — those must keep working, so absence is the default
 * rather than an error. An UNKNOWN value is a different thing and is refused:
 * it would land in the table past the CHECK constraint's back and show up in
 * neither dashboard.
 */
export function resolveFundraiserTeam(value: unknown): FundraiserTeam | null {
  if (value === undefined || value === null || value === '') {
    return FUNDRAISER_TEAMS[DEFAULT_FUNDRAISER_TEAM]
  }
  if (typeof value !== 'string') return null
  return isFundraiserTeamSlug(value) ? FUNDRAISER_TEAMS[value] : null
}

/** Long enough for "Mrs. Van Der Berg-Kowalski (Room 12)"; the DB backstop is 120. */
export const MAX_TEACHER_NAME_LENGTH = 80

export type TeacherScreen =
  | { ok: true; teacherName: string | null }
  | { ok: false; reason: string }

/**
 * Resolve a posted teacher name for this team.
 *
 * A team that does not collect one gets NULL regardless of what was sent — a
 * squad has no classroom, and a stray value would only be noise in its CSV.
 * A team that does collect one REQUIRES it: an in-class order with no room on
 * it is a box the PTO has to go and ask about.
 */
export function screenTeacherName(team: FundraiserTeam, value: unknown): TeacherScreen {
  if (!team.collectsTeacher) return { ok: true, teacherName: null }
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, reason: "the child's teacher is required" }
  }
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (trimmed.length > MAX_TEACHER_NAME_LENGTH) {
    return { ok: false, reason: `a teacher's name must be under ${MAX_TEACHER_NAME_LENGTH} characters` }
  }
  return { ok: true, teacherName: trimmed }
}

/**
 * Own-property check, NOT `value in FUNDRAISER_TEAMS` and NOT a bare index.
 *
 * `FUNDRAISER_TEAMS` is an object literal, so it inherits from
 * `Object.prototype`: `'constructor' in FUNDRAISER_TEAMS` is true and
 * `FUNDRAISER_TEAMS['constructor']` is the `Object` constructor — a truthy
 * value that would sail through a `?? null` and be returned as a team. Its
 * `.slug` is `undefined`, which a Supabase insert DROPS, so the column default
 * would quietly file the order under `cm-cheer`: an attacker-chosen string
 * turning into the wrong fundraiser's money. `hasOwn` has no prototype chain.
 */
export function isFundraiserTeamSlug(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(FUNDRAISER_TEAMS, value)
}
