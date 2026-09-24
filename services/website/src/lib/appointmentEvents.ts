/**
 * The appointment-event registry.
 *
 * ── WHAT THIS REPLACES ──
 *
 * "Summer Hair" was a one-day pop-up in July 2026. It took 16 real bookings and
 * then the event passed — and three months later the admin sidebar still said
 * **Summer Hair**, the public form was still in the tree (imported by nothing),
 * and running the same day again meant a find-and-replace across six files.
 *
 * Underneath the name, four things were copy-pasted:
 *
 *   - the 20-minute / 18-slot grid, written out in THREE files
 *   - the service price table, in FOUR
 *   - `calcSlotsNeeded`, byte-for-byte identical in the banner and the route
 *   - `'3:00 PM'`, `* 20` and `TIME_SLOTS.indexOf(...)`, everywhere
 *
 * All of it is here now, once. Adding "Halloween Hair" is an entry in
 * `APPOINTMENT_EVENTS` and a deploy: no migration, no new route, no new tab.
 *
 * ── THE SHAPE IS `lib/christmasMarket.ts`'s, DELIBERATELY ──
 *
 * An interface, named instances, a `Record<slug, Config>`, and a resolver that
 * returns `null` so a caller 400s rather than guessing. The window is TWO DATES
 * with explicit UTC offsets — never an `is_active` boolean, never `setHours()`.
 *
 * A boolean is something a human must remember to flip. `SpecialEventBanner`,
 * the component this file retires, is the cautionary tale: it had an
 * `EXPIRY_DATE` and **no start date**, so it shipped, expired in July, and then
 * had to be deleted off `/events` by hand (commit 64afaa2) while still being
 * imported from nowhere. Two dates are self-executing in both directions.
 *
 * Pure module. No `next/*` imports — it is read by a client banner, a server
 * page, three API routes and a cron job.
 */

/** One thing a customer can book. Stored verbatim in `appointment_bookings.services`. */
export interface AppointmentService {
  /** The id written to the database. Never renamed once an event has bookings. */
  id: string
  label: string
  priceCents: number
  /**
   * How many PEOPLE one slot serves.
   *
   * Hair wraps are one person per 20 minutes (`1`); glitter and tinsel are
   * quick enough to do four in the same slot (`4`). This is the "4 people per
   * slot" half of the old `QUICK_SERVICES` rule, stated per service instead of
   * per array.
   */
  peoplePerSlot: number
  /**
   * How many CONSECUTIVE slots one serving takes.
   *
   * **This is the field that makes the registry reusable.** The old code had
   * two arrays and no way at all to say "this takes longer than one slot", so
   * permanent jewelry — 40 minutes a wrist — was not expressible. It is two
   * slots here and nothing else has to change.
   */
  slotsPerServing: number
  /**
   * Radio behaviour on the form: picking one member of a group deselects the
   * others. `Hair Wraps` and `Hair Wraps + Charms` are the same appointment at
   * two prices, never both.
   *
   * The FIRST member of a group in this array is the one the price summary
   * shows; the rest are its variants.
   */
  variantGroup?: string
  /** 'add charms +$3'. Derives the summary grid, so the grid is not a 5th copy. */
  summaryNote?: string
  /** Cosmetic only — indents a variant under its parent on the booking form. */
  indent?: boolean
}

/**
 * How the customer pays.
 *
 * Summer Hair was `in_person` and nothing else existed. Adam's call on
 * 2026-09-24 is that this is per-event: a $5 glitter appointment does not want
 * a card checkout, and a permanent-jewelry slot that takes 40 minutes of a
 * stylist's day probably wants a deposit against the no-show.
 */
export type PaymentMode = 'in_person' | 'deposit' | 'prepay'

export interface AppointmentEventConfig {
  /** Matches `appointment_bookings.event_slug` and the public URL. */
  slug: string
  name: string
  /** 'Friday, October 30' — display only. */
  dateLabel: string
  /** '2026-10-30'. The reminder cron's day gate, compared in Eastern. */
  eventDate: string
  /** When the site-wide banner turns ITSELF on. */
  promoStartsAt: string
  /** When booking closes. The form and the banner both stop at this instant. */
  closesAt: string
  locationLine: string
  /** Optional: a flyer image under /public. Omitted means the page renders text only. */
  flyerSrc?: string
  accentHex: string

  /** Minutes since midnight of the first slot. `9 * 60` is 9:00 AM. */
  firstSlotMinutes: number
  /** Length of one slot in minutes. */
  slotMinutes: number
  /** How many slots in the day. The last one ENDS at `closingLabel(cfg)`. */
  slotCount: number
  maxPartySize: number

  services: AppointmentService[]

  payment: { mode: PaymentMode; depositCents?: number }
  /** Must be a key of `SERVICE_TYPE_MAP` in lib/contacts.ts, or the CRM row lands as 'other'. */
  contactServiceInterest: string
  /** How far ahead of the slot the reminder text goes out. Replaces a literal 75. */
  reminderLeadMinutes: number
  /** Who gets the "new booking" email. Replaces the ALLIE_EMAIL constant. */
  notifyEmail: string
}

/* ───────────────────────────────────────────────────────────────────────────
 * The registry.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * The hair-service menu Summer Hair actually ran, and the prices it actually
 * charged (measured off the retired route and banner, both of which carried
 * their own copy). Shared by the two hair events below because it IS the same
 * menu — the only thing that changed between July and October is the date.
 *
 * `peoplePerSlot` / `slotsPerServing` reproduce the old two-array rule exactly:
 * wraps are 1 person per slot, everything else is 4, and nothing took more than
 * one slot. See `calcSlotsNeeded` for the generalisation, and
 * `appointmentEvents.test.ts` for the table of numbers it must still produce.
 */
const HAIR_SERVICES: AppointmentService[] = [
  { id: 'Hair Tinsel', label: 'Hair Tinsel', priceCents: 1500, peoplePerSlot: 4, slotsPerServing: 1 },
  {
    id: 'Hair Wraps',
    label: 'Hair Wraps',
    priceCents: 3500,
    peoplePerSlot: 1,
    slotsPerServing: 1,
    variantGroup: 'Wraps',
    summaryNote: 'add charms +$3',
  },
  {
    id: 'Hair Wraps + Charms',
    label: 'Hair Wraps + Charms',
    priceCents: 3800,
    peoplePerSlot: 1,
    slotsPerServing: 1,
    variantGroup: 'Wraps',
    indent: true,
  },
  { id: 'Hair Glitter', label: 'Hair Glitter', priceCents: 500, peoplePerSlot: 4, slotsPerServing: 1 },
  { id: 'Glitter Freckles', label: 'Glitter Freckles', priceCents: 1000, peoplePerSlot: 4, slotsPerServing: 1 },
]

export const HALLOWEEN_HAIR_2026: AppointmentEventConfig = {
  slug: 'halloween-hair-2026',
  name: 'Halloween Hair',
  // TODO(adam): confirm the date, the hours and whether the menu differs from
  // Summer Hair's. See UNCONFIRMED_EVENT_SLUGS below — this event renders
  // nowhere until its slug is removed from that list.
  dateLabel: 'Friday, October 30',
  eventDate: '2026-10-30',
  promoStartsAt: '2026-10-01T00:00:00-04:00',
  closesAt: '2026-10-30T15:00:00-04:00',
  locationLine: 'Host Hampton · 295 Montauk Hwy, Suite 7, Speonk NY',
  accentHex: '#8b3a1d',

  firstSlotMinutes: 9 * 60,
  slotMinutes: 20,
  slotCount: 18,
  maxPartySize: 10,

  services: HAIR_SERVICES,

  payment: { mode: 'in_person' },
  contactServiceInterest: 'craft-event',
  reminderLeadMinutes: 75,
  notifyEmail: 'allie@hosthampton.com',
}

export const CHRISTMAS_HAIR_2026: AppointmentEventConfig = {
  slug: 'christmas-hair-2026',
  name: 'Christmas Hair',
  // TODO(adam): confirm date, hours and menu. Note this is a DIFFERENT day from
  // the Christmas Market (5 December) — two events, two registries, no overlap.
  dateLabel: 'Friday, December 18',
  eventDate: '2026-12-18',
  promoStartsAt: '2026-12-01T00:00:00-05:00',
  closesAt: '2026-12-18T15:00:00-05:00',
  locationLine: 'Host Hampton · 295 Montauk Hwy, Suite 7, Speonk NY',
  accentHex: '#8b1d2c',

  firstSlotMinutes: 9 * 60,
  slotMinutes: 20,
  slotCount: 18,
  maxPartySize: 10,

  services: HAIR_SERVICES,

  payment: { mode: 'in_person' },
  contactServiceInterest: 'craft-event',
  reminderLeadMinutes: 75,
  notifyEmail: 'allie@hosthampton.com',
}

export const PERMANENT_JEWELRY_2026: AppointmentEventConfig = {
  slug: 'permanent-jewelry-2026',
  name: 'Permanent Jewelry',
  // TODO(adam): confirm date, hours, the chain list and the prices. Also open
  // (plan item 2): is a wrist 40 minutes — `slotsPerServing: 2` against a
  // 20-minute grid, as written here — or does this event want its own
  // `slotMinutes`? Both are expressible; only one is true.
  dateLabel: 'Saturday, November 14',
  eventDate: '2026-11-14',
  promoStartsAt: '2026-10-20T00:00:00-04:00',
  closesAt: '2026-11-14T15:00:00-05:00',
  locationLine: 'Host Hampton · 295 Montauk Hwy, Suite 7, Speonk NY',
  accentHex: '#6b5b3f',

  firstSlotMinutes: 10 * 60,
  slotMinutes: 20,
  slotCount: 15,
  maxPartySize: 6,

  services: [
    // One person, 40 minutes — the case the old two-array code could not say.
    {
      id: 'Permanent Bracelet',
      label: 'Permanent Bracelet',
      priceCents: 6500,
      peoplePerSlot: 1,
      slotsPerServing: 2,
    },
    {
      id: 'Permanent Anklet',
      label: 'Permanent Anklet',
      priceCents: 7000,
      peoplePerSlot: 1,
      slotsPerServing: 2,
    },
    {
      id: 'Charm Add-On',
      label: 'Charm Add-On',
      priceCents: 1200,
      peoplePerSlot: 4,
      slotsPerServing: 1,
    },
  ],

  payment: { mode: 'in_person' },
  contactServiceInterest: 'permanent-jewelry',
  reminderLeadMinutes: 75,
  notifyEmail: 'allie@hosthampton.com',
}

/**
 * Every appointment event this site knows about.
 *
 * There is no `SUMMER_HAIR_2026` entry and there will not be one. That table
 * was exported to CSV and dropped in migration 060 (NEEDS-ADAM B10), so there
 * is nothing left for an entry to display.
 */
export const APPOINTMENT_EVENTS: Record<string, AppointmentEventConfig> = {
  [HALLOWEEN_HAIR_2026.slug]: HALLOWEEN_HAIR_2026,
  [CHRISTMAS_HAIR_2026.slug]: CHRISTMAS_HAIR_2026,
  [PERMANENT_JEWELRY_2026.slug]: PERMANENT_JEWELRY_2026,
}

/**
 * ── A SAFETY INTERLOCK, AND WHY IT IS NOT THE BOOLEAN THIS FILE BANS ──
 *
 * Every entry above carries `TODO(adam): confirm` against its dates and prices.
 * A guessed price is the one defect no tripwire in this repo can catch — the
 * arithmetic stays green while the customer is quoted the wrong number — and
 * the windows are SELF-EXECUTING, so a deploy today would put Halloween Hair on
 * the homepage on 1 October at prices nobody has approved.
 *
 * So an unconfirmed event resolves, prices and books exactly as normal for
 * anyone holding its URL, but it is **not promoted**: `livePromoEvent()` skips
 * it and the banner never appears. Confirming the content is one gesture —
 * delete the slug from this array — and when all three are real the array is
 * empty and this whole block can go.
 *
 * This is not `is_active` wearing a hat. The objection to `is_active` is that
 * its failure mode is silent and EXPENSIVE: migration 059's `is_active = false`
 * would have made the market page a 404 underneath a live banner. This one
 * fails the other way — the banner stays down, the page keeps working — which
 * is the direction an interlock is supposed to fail.
 */
export const UNCONFIRMED_EVENT_SLUGS: readonly string[] = [
  HALLOWEEN_HAIR_2026.slug,
  CHRISTMAS_HAIR_2026.slug,
  PERMANENT_JEWELRY_2026.slug,
]

/**
 * Unknown slug returns null — the caller 400s (or 404s) rather than guessing an
 * event and filing somebody's appointment under a day that does not exist.
 */
export function resolveAppointmentEvent(
  slug: string | null | undefined,
): AppointmentEventConfig | null {
  if (!slug) return null
  return APPOINTMENT_EVENTS[slug] ?? null
}

/* ───────────────────────────────────────────────────────────────────────────
 * The slot grid. Written out in three files before this.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Minutes since midnight → '9:00 AM'. The only place this arithmetic lives. */
function minutesToLabel(totalMin: number): string {
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`
}

/** Every bookable start time, in order. Index `i` is `slot_index` in the DB. */
export function slotTimes(cfg: AppointmentEventConfig): string[] {
  return Array.from({ length: cfg.slotCount }, (_, i) =>
    minutesToLabel(cfg.firstSlotMinutes + i * cfg.slotMinutes),
  )
}

/**
 * Label → index, or -1.
 *
 * `slot_index` is canonical in the database and `time_slot` is a rendering of
 * it; this is the one direction that ever needs undoing, for a legacy row or a
 * form that posts a label.
 */
export function slotIndex(cfg: AppointmentEventConfig, label: string): number {
  return slotTimes(cfg).indexOf(label)
}

/** Minutes since midnight of slot `i`. Two lines of arithmetic, not an indexOf. */
export function slotMinutesSinceMidnight(cfg: AppointmentEventConfig, index: number): number {
  return cfg.firstSlotMinutes + index * cfg.slotMinutes
}

/** When the day ends — the moment the LAST slot finishes. Was `'3:00 PM'`, twice. */
export function closingLabel(cfg: AppointmentEventConfig): string {
  return minutesToLabel(cfg.firstSlotMinutes + cfg.slotCount * cfg.slotMinutes)
}

/** When a booking starting at `startIdx` and taking `n` slots finishes. */
export function endLabel(cfg: AppointmentEventConfig, startIdx: number, n: number): string {
  const endIdx = startIdx + n
  const times = slotTimes(cfg)
  return endIdx >= times.length ? closingLabel(cfg) : times[endIdx]
}

/** '10:20 AM - 11:00 AM'. A hyphen, never an en dash — see `sms.ts`. */
export function durationRange(cfg: AppointmentEventConfig, startIdx: number, n: number): string {
  const times = slotTimes(cfg)
  const start = times[startIdx] ?? ''
  // '-', not the en dash this used to be: it lands in an SMS, and one non-GSM
  // character costs the WHOLE message 160 characters per segment down to 70.
  return `${start} - ${endLabel(cfg, startIdx, n)}`
}

/** How long `n` slots is. Was `slotsNeeded * 20`, in four places. */
export function durationMinutes(cfg: AppointmentEventConfig, n: number): number {
  return n * cfg.slotMinutes
}

/** '40 min (2 slots)'. The label the form and the admin timeline both show. */
export function durationLabel(cfg: AppointmentEventConfig, n: number): string {
  const mins = durationMinutes(cfg, n)
  return n === 1 ? `${mins} min` : `${mins} min (${n} slots)`
}

/* ───────────────────────────────────────────────────────────────────────────
 * Services, duration and money.
 * ─────────────────────────────────────────────────────────────────────────── */

export function findService(
  cfg: AppointmentEventConfig,
  id: string,
): AppointmentService | undefined {
  return cfg.services.find(s => s.id === id)
}

export function isValidServiceId(cfg: AppointmentEventConfig, id: unknown): boolean {
  return typeof id === 'string' && cfg.services.some(s => s.id === id)
}

/**
 * How many consecutive slots this booking needs.
 *
 * **A booking is as long as its LONGEST service.** That is what the old
 * `if (hasWraps) return partySize; if (hasQuick) return ceil(partySize / 4)`
 * was saying about two hard-coded arrays — wraps won because wraps were the
 * slow thing, and the quick services fitted inside the wrap time.
 *
 * Stated per service instead of per array, the same rule generalises to
 * anything: a service that serves four people at once divides, a service that
 * takes two slots per serving multiplies, and the max across the chosen
 * services is the answer. `appointmentEvents.test.ts` pins every number the old
 * code produced, plus the one it could not express.
 *
 * Unknown ids are ignored rather than thrown on — the route validates them and
 * 400s, and this function is also called from the browser where a stale bundle
 * is a real possibility. No services at all is one slot, as before.
 */
export function calcSlotsNeeded(
  cfg: AppointmentEventConfig,
  serviceIds: string[],
  partySize: number,
): number {
  const size = Math.max(1, Math.floor(partySize) || 1)
  const chosen = serviceIds
    .map(id => findService(cfg, id))
    .filter((s): s is AppointmentService => !!s)

  if (chosen.length === 0) return 1

  return Math.max(
    ...chosen.map(s => Math.ceil(size / Math.max(1, s.peoplePerSlot)) * Math.max(1, s.slotsPerServing)),
  )
}

/** The slot indices a booking occupies, start first. */
export function occupiedSlotIndices(startIdx: number, slotsNeeded: number): number[] {
  return Array.from({ length: slotsNeeded }, (_, i) => startIdx + i)
}

/**
 * What this booking is expected to cost, in cents.
 *
 * Per person, times the party — which is how the old route and the old banner
 * both computed it, from two separate copies of the same price table that
 * nothing checked against each other.
 */
export function estimateCents(
  cfg: AppointmentEventConfig,
  serviceIds: string[],
  partySize: number,
): number {
  const size = Math.max(1, Math.floor(partySize) || 1)
  const perPerson = serviceIds.reduce((sum, id) => sum + (findService(cfg, id)?.priceCents ?? 0), 0)
  return perPerson * size
}

export interface PriceSummaryRow {
  label: string
  priceCents: number
  note?: string
}

/**
 * The at-a-glance price grid, DERIVED rather than written out again.
 *
 * This existed as a fourth hand-maintained copy of the price table inside the
 * banner — `[{ name: 'Hair Wraps', price: '$35', note: 'add charms +$3' }, …]`
 * — which is how "$35" could have drifted from the $35 the route charged with
 * nothing noticing. A variant (`Hair Wraps + Charms`) is folded into its
 * parent's row and carries no row of its own; the parent's `summaryNote` is
 * what mentions it.
 */
export function priceSummaryRows(cfg: AppointmentEventConfig): PriceSummaryRow[] {
  const seenGroups = new Set<string>()
  const rows: PriceSummaryRow[] = []
  for (const s of cfg.services) {
    if (s.variantGroup) {
      if (seenGroups.has(s.variantGroup)) continue
      seenGroups.add(s.variantGroup)
    }
    rows.push({ label: s.label, priceCents: s.priceCents, ...(s.summaryNote ? { note: s.summaryNote } : {}) })
  }
  return rows
}

/** `$35` when it is whole dollars, `$52.05` when it is not. */
export function formatAppointmentMoney(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`
}

/** What the customer is told about paying, as one sentence. */
export function paymentNote(cfg: AppointmentEventConfig): string {
  if (cfg.payment.mode === 'prepay') return 'Paid in full when you book'
  if (cfg.payment.mode === 'deposit') {
    const dep = cfg.payment.depositCents ?? 0
    return `${formatAppointmentMoney(dep)} deposit to hold your slot, balance in person`
  }
  return 'Paid in person'
}

/* ───────────────────────────────────────────────────────────────────────────
 * The window. Two dates, both ends, no boolean.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Has booking closed?
 *
 * Takes `now` so a test can ask about a specific instant rather than the wall
 * clock — six tests in this repo were red between 9pm and 8am ET for exactly
 * that reason.
 */
export function isEventClosed(cfg: AppointmentEventConfig, now: Date = new Date()): boolean {
  return now.getTime() > new Date(cfg.closesAt).getTime()
}

/**
 * Should the site-wide banner be up for this event right now?
 *
 * Governs the BANNER only. `/appointments/<slug>` is reachable before the
 * banner goes up and that is the point: Adam can send the link and fill slots
 * for weeks without a bar on every page. A closed event is a 410 from the book
 * route, which is a different question from whether the banner is showing.
 */
export function isPromoLive(cfg: AppointmentEventConfig, now: Date = new Date()): boolean {
  if (now.getTime() < new Date(cfg.promoStartsAt).getTime()) return false
  return !isEventClosed(cfg, now)
}

/**
 * The one event the banner should be promoting, or null.
 *
 * Soonest-closing first, so when two windows overlap the banner advertises the
 * one about to run out rather than whichever happens to be first in the object.
 * Unconfirmed events are skipped — see `UNCONFIRMED_EVENT_SLUGS`.
 */
export function livePromoEvent(now: Date = new Date()): AppointmentEventConfig | null {
  const live = Object.values(APPOINTMENT_EVENTS)
    .filter(cfg => !UNCONFIRMED_EVENT_SLUGS.includes(cfg.slug))
    .filter(cfg => isPromoLive(cfg, now))
    .sort((a, b) => new Date(a.closesAt).getTime() - new Date(b.closesAt).getTime())
  return live[0] ?? null
}

/** Is `dateStr` ('YYYY-MM-DD', Eastern) this event's day? The cron's day gate. */
export function isEventDay(cfg: AppointmentEventConfig, dateStr: string): boolean {
  return cfg.eventDate === dateStr
}

/** Every event happening on `dateStr`. The reminder cron loops over these. */
export function eventsOnDate(dateStr: string): AppointmentEventConfig[] {
  return Object.values(APPOINTMENT_EVENTS).filter(cfg => isEventDay(cfg, dateStr))
}

/** Accepted values for `appointment_bookings.status`. Mirrors the DB CHECK. */
export const APPOINTMENT_STATUSES = ['pending_payment', 'confirmed', 'cancelled'] as const
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number]
