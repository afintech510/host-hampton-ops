/**
 * The appointment registry, and the tripwires that guard what was actually
 * promised rather than what is merely easy to assert.
 *
 * Modelled on `christmasMarket.test.ts`: arithmetic **plus** source scanning.
 * Arithmetic alone stays green through the exact regression this plan exists to
 * prevent — somebody re-introduces a literal `'3:00 PM'` or a second price
 * table in a component, every number here still adds up, and the two copies
 * drift apart over a weekend. The whole point of the refactor is that the grid
 * and the price table EXIST ONCE, and only a source scan can say so.
 *
 * ── Comments are stripped before every source rule ──
 *
 * Without that, a rule matches the comment explaining the rule — the tripwire
 * firing on itself, which this repo has now caught three separate times. And
 * every anchor uses `\r?\n`, never a bare `\n`: the checkout is
 * `core.autocrlf=true`, and a fresh worktree gets CRLF, which is how one rule
 * silently stopped checking anything in the one environment everybody works in.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  HALLOWEEN_HAIR_2026,
  CHRISTMAS_HAIR_2026,
  PERMANENT_JEWELRY_2026,
  APPOINTMENT_EVENTS,
  UNCONFIRMED_EVENT_SLUGS,
  resolveAppointmentEvent,
  slotTimes,
  slotIndex,
  slotMinutesSinceMidnight,
  closingLabel,
  endLabel,
  durationRange,
  durationMinutes,
  durationLabel,
  calcSlotsNeeded,
  occupiedSlotIndices,
  estimateCents,
  priceSummaryRows,
  formatAppointmentMoney,
  paymentNote,
  isEventClosed,
  isPromoLive,
  livePromoEvent,
  eventsOnDate,
  isValidServiceId,
  APPOINTMENT_STATUSES,
  type AppointmentEventConfig,
} from '@/lib/appointmentEvents'
import { SERVICE_TYPE_MAP } from '@/lib/contacts'

const SRC = join(__dirname, '..', '..')
const MIGRATIONS = join(__dirname, '..', '..', '..', '..', '..', 'starting_plan')

const HAIR = HALLOWEEN_HAIR_2026
const JEWELRY = PERMANENT_JEWELRY_2026

function decomment(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n\r]*/g, (m, p) => {
    const keep = p ?? ''
    return keep + m.slice(keep.length).replace(/[^\n\r]/g, ' ')
  })
}

/**
 * Blank the TEXT of every string and template literal, keeping `${…}`
 * interpolations (which are real code) and everything outside.
 *
 * Needed by exactly two rules below — "no `* 20`" and "no `$35`" — and needed
 * because Tailwind writes both of those shapes in ordinary class names:
 * `border-hampton-mauve/20` matches a naive `/\s*20` and would fail every
 * component in the list for a reason that has nothing to do with arithmetic.
 * Rules that care about STRINGS (the `'3:00 PM'` literal) do not use this.
 */
function stripLiteralText(src: string): string {
  const out = src.split('')
  const n = src.length
  let i = 0
  while (i < n) {
    const c = src[i]
    if (c === "'" || c === '"') {
      const q = c
      i++
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { out[i] = ' '; i++; if (i < n) { out[i] = ' '; i++ } continue }
        if (src[i] !== '\n' && src[i] !== '\r') out[i] = ' '
        i++
      }
      i++
      continue
    }
    if (c === '`') {
      i++
      while (i < n) {
        if (src[i] === '\\') { out[i] = ' '; i++; if (i < n) { out[i] = ' '; i++ } continue }
        if (src[i] === '`') { i++; break }
        if (src[i] === '$' && src[i + 1] === '{') {
          // An interpolation is CODE, so it survives — but it routinely holds
          // more strings (`${x ? 'border-mauve/20' : ''}` is every conditional
          // className in this codebase), and skipping it whole left those
          // unstripped. Recurse, or the rule fails on Tailwind again.
          const start = i + 2
          let depth = 1
          let j = start
          while (j < n && depth > 0) {
            if (src[j] === '{') depth++
            else if (src[j] === '}') depth--
            j++
          }
          const stripped = stripLiteralText(src.slice(start, j - 1))
          for (let k = 0; k < stripped.length; k++) out[start + k] = stripped[k]
          i = j
          continue
        }
        if (src[i] !== '\n' && src[i] !== '\r') out[i] = ' '
        i++
      }
      continue
    }
    i++
  }
  return out.join('')
}

const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')
const readClean = (rel: string) => decomment(read(rel))
const readCode = (rel: string) => stripLiteralText(readClean(rel))

/**
 * Every file that RENDERS or REASONS ABOUT an appointment. These are the places
 * the 20-minute grid, the price table and `calcSlotsNeeded` used to be copied
 * into, one per copy.
 */
const CONSUMERS = [
  'app/api/appointments/[slug]/book/route.ts',
  'app/api/admin/appointments/route.ts',
  'app/api/cron/appointment-reminders/route.ts',
  'app/appointments/[slug]/page.tsx',
  'app/appointments/[slug]/AppointmentForm.tsx',
  'app/admin/AppointmentsTab.tsx',
  'components/AppointmentBanner.tsx',
  'lib/email-templates/appointments.ts',
] as const

/* ───────────────────────────────────────────────────────────────────────────
 * R0 — the registry
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R0: the appointment registry', () => {
  it('resolves every known slug and refuses everything else', () => {
    for (const slug of Object.keys(APPOINTMENT_EVENTS)) {
      expect(resolveAppointmentEvent(slug)).toBe(APPOINTMENT_EVENTS[slug])
    }
    expect(resolveAppointmentEvent('summer-hair-2026')).toBeNull()
    expect(resolveAppointmentEvent('')).toBeNull()
    expect(resolveAppointmentEvent(null)).toBeNull()
    expect(resolveAppointmentEvent(undefined)).toBeNull()
  })

  it('keys every entry by its own slug', () => {
    // A mismatch means resolveAppointmentEvent() hands back an event whose slug
    // is not the one asked for, and bookings get filed under the wrong day.
    for (const [key, cfg] of Object.entries(APPOINTMENT_EVENTS)) {
      expect(cfg.slug).toBe(key)
    }
  })

  it('has no SUMMER_HAIR entry — that table was dropped', () => {
    // Migration 060 drops `summer_hair_bookings` after exporting it. An entry
    // here would be a page promising a day whose bookings no longer exist.
    expect(Object.keys(APPOINTMENT_EVENTS).some(s => /summer/i.test(s))).toBe(false)
  })

  it('never repeats a service id within one event', () => {
    // Duplicated ids make `estimateCents` double-count and `findService`
    // ambiguous, and the id is what is written to the database.
    for (const cfg of Object.values(APPOINTMENT_EVENTS)) {
      const ids = cfg.services.map(s => s.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('every contactServiceInterest is a real service_type', () => {
    // Anything not in SERVICE_TYPE_MAP silently becomes 'other' — a CRM row
    // that looks healthy and is filed under nothing.
    for (const cfg of Object.values(APPOINTMENT_EVENTS)) {
      expect(Object.keys(SERVICE_TYPE_MAP)).toContain(cfg.contactServiceInterest)
    }
  })

  it('every event opens before it closes, and closes on or after its date', () => {
    for (const cfg of Object.values(APPOINTMENT_EVENTS)) {
      // A window inverted by a typo renders the banner never, silently.
      expect(new Date(cfg.promoStartsAt).getTime())
        .toBeLessThan(new Date(cfg.closesAt).getTime())
      // And `closesAt` must be on the event day or later, or booking shuts
      // before the day it is for.
      expect(cfg.closesAt.slice(0, 10) >= cfg.eventDate).toBe(true)
    }
  })

  it('every event has a sane grid and at least one service', () => {
    for (const cfg of Object.values(APPOINTMENT_EVENTS)) {
      expect(cfg.slotCount).toBeGreaterThan(0)
      expect(cfg.slotMinutes).toBeGreaterThan(0)
      expect(cfg.maxPartySize).toBeGreaterThan(0)
      expect(cfg.services.length).toBeGreaterThan(0)
      for (const s of cfg.services) {
        expect(s.peoplePerSlot).toBeGreaterThan(0)
        expect(s.slotsPerServing).toBeGreaterThan(0)
        expect(s.priceCents).toBeGreaterThan(0)
      }
    }
  })

  it('a deposit event names its deposit', () => {
    // `mode: 'deposit'` with no `depositCents` resolves to $0, which Stripe
    // refuses — the booking 503s at the moment somebody tries to pay.
    for (const cfg of Object.values(APPOINTMENT_EVENTS)) {
      if (cfg.payment.mode === 'deposit') {
        expect(cfg.payment.depositCents).toBeGreaterThan(0)
      }
    }
  })

  it('every unconfirmed slug names a real event', () => {
    // Both directions. A stale entry here is an event silently never promoted.
    for (const slug of UNCONFIRMED_EVENT_SLUGS) {
      expect(resolveAppointmentEvent(slug)).not.toBeNull()
    }
  })

  it('the status list matches migration 060s CHECK', () => {
    expect([...APPOINTMENT_STATUSES]).toEqual(['pending_payment', 'confirmed', 'cancelled'])
    const sql = readFileSync(join(MIGRATIONS, 'migration_060_appointment_bookings.sql'), 'utf8')
    for (const s of APPOINTMENT_STATUSES) expect(sql).toContain(`'${s}'`)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * R1 — duration. The rule that has to reproduce the old numbers exactly.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R1: duration is config-driven and still gives the old answers', () => {
  // The retired code was two hard-coded arrays:
  //   if (hasWraps) return partySize
  //   if (hasQuick) return Math.ceil(partySize / 4)
  //   return 1
  // Every case below is a number that code produced. If the generalisation
  // changed ANY of them, a real customer's appointment got longer or shorter
  // than it should be — and nothing else in the suite would notice.

  it('one person having wraps is one slot', () => {
    expect(calcSlotsNeeded(HAIR, ['Hair Wraps'], 1)).toBe(1)
  })

  it('four people having wraps is four slots — one each', () => {
    expect(calcSlotsNeeded(HAIR, ['Hair Wraps'], 4)).toBe(4)
    expect(calcSlotsNeeded(HAIR, ['Hair Wraps + Charms'], 4)).toBe(4)
  })

  it('four people having glitter is ONE slot — four fit in twenty minutes', () => {
    expect(calcSlotsNeeded(HAIR, ['Hair Glitter'], 4)).toBe(1)
  })

  it('five people having glitter is two slots', () => {
    expect(calcSlotsNeeded(HAIR, ['Hair Glitter'], 5)).toBe(2)
  })

  it('three people having BOTH is three — the longest service wins', () => {
    // This is the whole generalisation. The old code said "if there are wraps,
    // it is partySize" and that was right for the accidental reason that wraps
    // were the slow thing. Stated as max(), it is right on purpose.
    expect(calcSlotsNeeded(HAIR, ['Hair Wraps', 'Hair Glitter'], 3)).toBe(3)
    expect(calcSlotsNeeded(HAIR, ['Hair Glitter', 'Hair Wraps'], 3)).toBe(3)
  })

  it('no services at all is one slot', () => {
    expect(calcSlotsNeeded(HAIR, [], 1)).toBe(1)
    expect(calcSlotsNeeded(HAIR, [], 8)).toBe(1)
  })

  it('an unknown service id is ignored, not crashed on', () => {
    expect(calcSlotsNeeded(HAIR, ['Nonsense'], 3)).toBe(1)
    expect(calcSlotsNeeded(HAIR, ['Nonsense', 'Hair Wraps'], 3)).toBe(3)
  })

  it('permanent jewelry for two people is FOUR slots', () => {
    // THE case the old two-array code could not express at all: a service that
    // takes longer than one slot per person. 40 minutes a wrist, two wrists.
    expect(calcSlotsNeeded(JEWELRY, ['Permanent Bracelet'], 2)).toBe(4)
    expect(calcSlotsNeeded(JEWELRY, ['Permanent Bracelet'], 1)).toBe(2)
    // And a quick add-on does not extend it — the bracelet is still the longest.
    expect(calcSlotsNeeded(JEWELRY, ['Permanent Bracelet', 'Charm Add-On'], 2)).toBe(4)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * R2 — the grid and the money, computed once
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R2: the slot grid', () => {
  it('reproduces the 18 twenty-minute slots from 9:00 AM', () => {
    const times = slotTimes(HAIR)
    expect(times.length).toBe(18)
    expect(times[0]).toBe('9:00 AM')
    expect(times[1]).toBe('9:20 AM')
    expect(times[3]).toBe('10:00 AM')
    expect(times[15]).toBe('2:00 PM')
    expect(times[17]).toBe('2:40 PM')
  })

  it('renders noon as 12, never as 0', () => {
    // `h > 12 ? h - 12 : h` was the old expression and it is correct at noon by
    // luck; the twelve-hour clock is exactly where an off-by-one hides.
    expect(slotTimes(HAIR)[9]).toBe('12:00 PM')
  })

  it('knows when the day ends without a literal', () => {
    expect(closingLabel(HAIR)).toBe('3:00 PM')
    expect(closingLabel(JEWELRY)).toBe('3:00 PM')
  })

  it('maps a label back to its index, and refuses one that is not on the grid', () => {
    expect(slotIndex(HAIR, '9:00 AM')).toBe(0)
    expect(slotIndex(HAIR, '10:20 AM')).toBe(4)
    expect(slotIndex(HAIR, '4:00 PM')).toBe(-1)
    expect(slotIndex(HAIR, '')).toBe(-1)
  })

  it('turns an index into minutes since midnight by arithmetic', () => {
    expect(slotMinutesSinceMidnight(HAIR, 0)).toBe(540)
    expect(slotMinutesSinceMidnight(HAIR, 3)).toBe(600)
    expect(slotMinutesSinceMidnight(HAIR, 17)).toBe(880)
  })

  it('ends a booking at the right label, and at closing when it runs to the end', () => {
    expect(endLabel(HAIR, 0, 1)).toBe('9:20 AM')
    expect(endLabel(HAIR, 4, 2)).toBe('11:00 AM')
    expect(endLabel(HAIR, 17, 1)).toBe('3:00 PM')
  })

  it('writes the range with a HYPHEN — an en dash costs an SMS segment', () => {
    const range = durationRange(HAIR, 4, 2)
    expect(range).toBe('10:20 AM - 11:00 AM')
    expect(range).not.toMatch(/[–—]/)
  })

  it('converts slots to minutes and to a label', () => {
    expect(durationMinutes(HAIR, 1)).toBe(20)
    expect(durationMinutes(HAIR, 3)).toBe(60)
    expect(durationLabel(HAIR, 1)).toBe('20 min')
    expect(durationLabel(HAIR, 3)).toBe('60 min (3 slots)')
  })

  it('lists the indices a booking occupies, start first', () => {
    expect(occupiedSlotIndices(4, 3)).toEqual([4, 5, 6])
    expect(occupiedSlotIndices(0, 1)).toEqual([0])
  })
})

describe('R2: the price table', () => {
  it('prices per person, times the party', () => {
    expect(estimateCents(HAIR, ['Hair Tinsel'], 1)).toBe(1500)
    expect(estimateCents(HAIR, ['Hair Tinsel'], 2)).toBe(3000)
    expect(estimateCents(HAIR, ['Hair Wraps', 'Hair Glitter'], 2)).toBe(8000)
    expect(estimateCents(HAIR, [], 4)).toBe(0)
  })

  it('reproduces the prices Summer Hair actually charged', () => {
    // Measured off the retired route's own priceMap. If any of these moved in
    // the port, a customer was quoted a number the studio never agreed to.
    const expected: Record<string, number> = {
      'Hair Tinsel': 1500,
      'Hair Wraps': 3500,
      'Hair Wraps + Charms': 3800,
      'Hair Glitter': 500,
      'Glitter Freckles': 1000,
    }
    for (const [id, cents] of Object.entries(expected)) {
      expect(estimateCents(HAIR, [id], 1)).toBe(cents)
    }
  })

  it('folds a variant into its parents summary row rather than listing it twice', () => {
    const rows = priceSummaryRows(HAIR)
    expect(rows.map(r => r.label)).toEqual([
      'Hair Tinsel', 'Hair Wraps', 'Hair Glitter', 'Glitter Freckles',
    ])
    expect(rows.find(r => r.label === 'Hair Wraps')!.note).toBe('add charms +$3')
  })

  it('formats whole dollars without cents, and cents when there are any', () => {
    expect(formatAppointmentMoney(3500)).toBe('$35')
    expect(formatAppointmentMoney(0)).toBe('$0')
    expect(formatAppointmentMoney(5205)).toBe('$52.05')
  })

  it('says how payment works, per event', () => {
    expect(paymentNote(HAIR)).toBe('Paid in person')
    expect(paymentNote({ ...HAIR, payment: { mode: 'prepay' } })).toMatch(/full/i)
    expect(paymentNote({ ...HAIR, payment: { mode: 'deposit', depositCents: 2500 } }))
      .toMatch(/^\$25 deposit/)
  })

  it('only accepts service ids the event actually has', () => {
    expect(isValidServiceId(HAIR, 'Hair Tinsel')).toBe(true)
    expect(isValidServiceId(HAIR, 'Permanent Bracelet')).toBe(false)
    expect(isValidServiceId(HAIR, '')).toBe(false)
    expect(isValidServiceId(HAIR, null)).toBe(false)
    expect(isValidServiceId(HAIR, ['Hair Tinsel'])).toBe(false)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * R3 — the window. Every assertion passes an explicit `now`.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R3: the promo window', () => {
  // Six tests in this repo were red between 9pm and 8am ET because they read
  // the wall clock. Nothing below does.

  it('is off a week before it is due up', () => {
    expect(isPromoLive(HAIR, new Date('2026-09-24T12:00:00Z'))).toBe(false)
  })

  it('turns itself on at promoStartsAt — nobody has to remember', () => {
    // 2026-10-01T00:00:00-04:00 is 04:00Z.
    expect(isPromoLive(HAIR, new Date('2026-10-01T03:59:00Z'))).toBe(false)
    expect(isPromoLive(HAIR, new Date('2026-10-01T04:00:00Z'))).toBe(true)
  })

  it('is up on the morning of the event', () => {
    expect(isPromoLive(HAIR, new Date('2026-10-30T13:00:00Z'))).toBe(true)
  })

  it('turns itself off one minute past closesAt', () => {
    // 3pm Eastern == 19:00Z. A naive local comparison here is the same class of
    // bug that scheduled every reminder 4-5 hours early.
    expect(isEventClosed(HAIR, new Date('2026-10-30T18:59:00Z'))).toBe(false)
    expect(isEventClosed(HAIR, new Date('2026-10-30T19:01:00Z'))).toBe(true)
    expect(isPromoLive(HAIR, new Date('2026-10-30T19:01:00Z'))).toBe(false)
  })

  it('stays closed a year later', () => {
    expect(isEventClosed(HAIR, new Date('2027-10-30T12:00:00Z'))).toBe(true)
  })

  it('never promotes an event whose content is still unconfirmed', () => {
    // The interlock. A guessed price is the one defect no tripwire can catch,
    // so an event with a TODO against its prices resolves and books for anyone
    // holding the link, but is not put on every page in the site.
    for (const slug of UNCONFIRMED_EVENT_SLUGS) {
      const cfg = resolveAppointmentEvent(slug)!
      const mid = new Date(new Date(cfg.promoStartsAt).getTime() + 60_000)
      expect(isPromoLive(cfg, mid)).toBe(true)      // its own window IS open
      expect(livePromoEvent(mid)?.slug).not.toBe(slug) // and it is still not promoted
    }
  })

  it('picks the soonest-closing live event when two windows overlap', () => {
    const a: AppointmentEventConfig = { ...HAIR, slug: 'a', closesAt: '2026-10-30T15:00:00-04:00' }
    const b: AppointmentEventConfig = { ...HAIR, slug: 'b', closesAt: '2026-11-30T15:00:00-05:00' }
    // Exercised through the same comparison livePromoEvent uses, on a pair this
    // test owns — the registry itself is all unconfirmed while it holds TODOs.
    const live = [b, a]
      .filter(c => isPromoLive(c, new Date('2026-10-15T12:00:00Z')))
      .sort((x, y) => new Date(x.closesAt).getTime() - new Date(y.closesAt).getTime())
    expect(live[0].slug).toBe('a')
  })

  it('finds the events happening on a given day, and none on any other', () => {
    expect(eventsOnDate(HAIR.eventDate).map(c => c.slug)).toContain(HAIR.slug)
    expect(eventsOnDate('2026-01-01')).toEqual([])
  })

  it('the three registry entries are on three different days', () => {
    // Two events on one day is legal — the cron loops — but it is worth knowing
    // about, because they share a studio and a stylist.
    const dates = [HALLOWEEN_HAIR_2026, CHRISTMAS_HAIR_2026, PERMANENT_JEWELRY_2026].map(c => c.eventDate)
    expect(new Set(dates).size).toBe(3)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * R4 — the grid exists ONCE. Source scan.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R4: the slot grid is written in exactly one place', () => {
  it('reads every consumer it claims to examine', () => {
    // Count what was examined. A walker that silently found nothing is the
    // quietest hole there is.
    let examined = 0
    for (const rel of CONSUMERS) {
      expect(read(rel).length).toBeGreaterThan(200)
      examined++
    }
    expect(examined).toBe(CONSUMERS.length)
  })

  it('no consumer builds its own Array.from generator of slot times', () => {
    const offenders = CONSUMERS.filter(rel => /Array\.from\(\s*\{\s*length:/.test(readClean(rel)))
    expect(offenders).toEqual([])
  })

  it('no consumer writes a slot time as a literal', () => {
    const offenders: string[] = []
    for (const rel of CONSUMERS) {
      const code = readClean(rel)
      if (/'9:00 AM'|"9:00 AM"|'3:00 PM'|"3:00 PM"/.test(code)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('no consumer multiplies or divides by the slot length', () => {
    // `slotsNeeded * 20` appeared in four files. It is `durationMinutes(cfg, n)`
    // now, and 20 is a property of the event. Literal text is stripped first, or
    // every Tailwind `border-hampton-mauve/20` is an offender.
    const offenders: string[] = []
    for (const rel of CONSUMERS) {
      if (/[*/]\s*20\b/.test(readCode(rel))) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('every consumer that renders a time imports the helpers', () => {
    const RENDERS_TIMES = [
      'app/api/appointments/[slug]/book/route.ts',
      'app/api/admin/appointments/route.ts',
      'app/api/cron/appointment-reminders/route.ts',
      'app/appointments/[slug]/AppointmentForm.tsx',
      'app/admin/AppointmentsTab.tsx',
    ]
    for (const rel of RENDERS_TIMES) {
      expect(readClean(rel)).toMatch(/from\s+'@\/lib\/appointmentEvents'/)
    }
  })
})

describe('R4: the price table is written in exactly one place', () => {
  it('no consumer contains a dollar literal', () => {
    // Four copies of the price table is how the banner could have advertised
    // $35 while the route charged something else. Prices are cents in the
    // registry and formatted by one function.
    const offenders: string[] = []
    let examined = 0
    for (const rel of CONSUMERS) {
      // String TEXT is blanked, so a price printed by `formatAppointmentMoney`
      // in an interpolation survives while a hand-typed `$35` in copy does not.
      const code = readCode(rel)
      examined++
      for (const m of code.matchAll(/\$\d+/g)) offenders.push(`${rel}: ${m[0]}`)
    }
    expect(examined).toBe(CONSUMERS.length)
    expect(offenders).toEqual([])
  })

  it('no consumer declares its own service or price map', () => {
    const offenders: string[] = []
    for (const rel of CONSUMERS) {
      const code = readClean(rel)
      if (/\b(PRICE_MAP|VALID_SERVICES|WRAP_SERVICES|QUICK_SERVICES)\b/.test(code)) offenders.push(rel)
      // `const SERVICES = ` specifically — a local re-declaration. A `cfg.services`
      // read is the correct thing and must not trip this.
      if (/\bconst\s+SERVICES\s*=/.test(code)) offenders.push(`${rel}: const SERVICES`)
    }
    expect(offenders).toEqual([])
  })

  it('no consumer re-implements calcSlotsNeeded', () => {
    // It was byte-for-byte identical in the banner and the route.
    const offenders = CONSUMERS.filter(rel => /function\s+calcSlotsNeeded/.test(readClean(rel)))
    expect(offenders).toEqual([])
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * R5 — the banner gates itself, and nothing else does
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R5: the promo window governs the BANNER and nothing else', () => {
  it('the banner is the thing that calls livePromoEvent', () => {
    expect(readClean('components/AppointmentBanner.tsx')).toMatch(/livePromoEvent\(\)/)
  })

  it('the layout renders it — permanently, which is the fix', () => {
    // `SpecialEventBanner` was mounted by hand for one day and then deleted by
    // hand, and then sat imported-by-nothing for three months. A permanent
    // mount is only safe because the window governs visibility; assert both.
    const layout = readClean('app/layout.tsx')
    expect(layout).toMatch(/import\s+AppointmentBanner\s+from\s+'@\/components\/AppointmentBanner'/)
    expect(layout).toMatch(/<AppointmentBanner\s*\/>/)
  })

  it('no route file gates itself on isPromoLive', () => {
    // A closed event 410s (`isEventClosed`); whether the BANNER is up is a
    // different question. If the promo window leaked into the routes, sending
    // somebody the link before the banner goes up would stop working — which is
    // exactly the quiet period Adam uses to fill slots.
    const ROUTES = CONSUMERS.filter(rel => rel.includes('/api/'))
    const offenders = ROUTES.filter(rel => /isPromoLive/.test(readClean(rel)))
    expect(offenders).toEqual([])
  })

  it('the book route stops on isEventClosed with a 410', () => {
    // Sliced to POST. GET also calls `isEventClosed` — it renders a closed grid
    // rather than 410ing, because an availability read for a finished day is a
    // fair question with a boring answer. Scoping to the site that matters is
    // the whole lesson of the "satisfied by the wrong occurrence" family: the
    // whole-file form of this rule passes on GET's call and never looks at POST.
    const code = readClean('app/api/appointments/[slug]/book/route.ts')
    const postAt = code.indexOf('export async function POST')
    expect(postAt).toBeGreaterThan(-1)
    const post = code.slice(postAt)
    const at = post.indexOf('isEventClosed(cfg)')
    expect(at).toBeGreaterThan(-1)
    expect(post.slice(at, at + 400)).toMatch(/status:\s*410/)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * R6 — the race fix is in the SCHEMA, and the route trusts it
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R6: double-booking', () => {
  const migration = readFileSync(join(MIGRATIONS, 'migration_060_appointment_bookings.sql'), 'utf8')

  it('the holds table is keyed on (event_slug, slot_index)', () => {
    // THE fix. Without this line the route's 23505 branch is unreachable and
    // twenty concurrent requests for one slot all succeed, which is what the
    // retired route measurably did.
    expect(migration).toMatch(/PRIMARY KEY\s*\(\s*event_slug\s*,\s*slot_index\s*\)/)
  })

  it('the migration drops summer_hair_bookings as its first statement', () => {
    const drop = migration.indexOf('DROP TABLE IF EXISTS public.summer_hair_bookings')
    const create = migration.indexOf('CREATE TABLE IF NOT EXISTS public.appointment_bookings')
    expect(drop).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(drop)
    // And it names where the rows went, or the drop is unreviewable.
    expect(migration).toContain('audit_scratch/summer_hair_bookings_export_2026-09-24.csv')
  })

  it('both tables have RLS enabled', () => {
    for (const t of ['appointment_bookings', 'appointment_slot_holds']) {
      expect(migration).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`))
    }
  })

  it('the book route builds no Set of occupied indices before its insert', () => {
    // The check-then-act shape, named exactly. A pre-check would be a second,
    // weaker answer to the question the primary key already answers — and the
    // first thing somebody trusts when the two disagree.
    const code = readClean('app/api/appointments/[slug]/book/route.ts')
    const postAt = code.indexOf('export async function POST')
    expect(postAt).toBeGreaterThan(-1)
    const post = code.slice(postAt)
    expect(post).not.toMatch(/new Set<number>\(\)/)
    expect(post).not.toMatch(/occupied\.add\(/)
  })

  it('the conflict is matched by CODE, never by message text', () => {
    for (const rel of [
      'app/api/appointments/[slug]/book/route.ts',
      'app/api/admin/appointments/route.ts',
    ]) {
      const code = readClean(rel)
      expect(code).toMatch(/isUniqueViolation\(/)
      expect(code).not.toMatch(/error\.message[\s\S]{0,80}duplicate key/)
      expect(code).not.toMatch(/duplicate key[\s\S]{0,80}error\.message/)
    }
  })

  it('a lost race is a 409, and the pending booking is undone', () => {
    const code = readClean('app/api/appointments/[slug]/book/route.ts')
    const at = code.indexOf('isUniqueViolation(holdErr)')
    expect(at).toBeGreaterThan(-1)
    expect(code.slice(at, at + 400)).toMatch(/status:\s*409/)
    // And the pending row is deleted BEFORE the branch, so BOTH failure paths
    // clean up — a 409 that leaves a phantom booking on the admin screen is a
    // half-fix. `\r?\n`, because a fresh worktree checks out CRLF.
    // `\s*` throughout, so the rule survives both a chained one-liner and a
    // reformat onto four lines — and `\r?\n` is inside `\s*`, which is what a
    // CRLF worktree needs. Line endings and indentation are never the property
    // under test.
    const delRe = /from\('appointment_bookings'\)\s*\.delete\(\)\s*\.eq\('id',\s*booking\.id\)/
    const delMatch = delRe.exec(code)
    expect(delMatch).not.toBeNull()
    expect(delMatch!.index).toBeLessThan(at)
  })

  it('cancel, restore and adjust_duration ALL touch the holds table', () => {
    // A status flip that leaves holds behind is a slot nobody can rebook — an
    // empty chair that reads as full, which is the more expensive direction.
    const code = readClean('app/api/admin/appointments/route.ts')
    for (const action of ["'cancel'", "'restore'", "'adjust_duration'"]) {
      const at = code.indexOf(`action === ${action}`)
      expect(at).toBeGreaterThan(-1)
      // Slice the branch: up to the next action test, or the end.
      const rest = code.slice(at + 1)
      const nextAt = rest.search(/action === '/)
      const branch = nextAt === -1 ? code.slice(at) : code.slice(at, at + 1 + nextAt)
      expect(branch).toMatch(/appointment_slot_holds|claimHolds\(/)
    }
  })

  it('the availability read refuses rather than showing every slot as free', () => {
    // Rule 12. An unreadable holds table is not an empty one, and defaulting to
    // "available" invites a customer to book something already taken.
    const code = readClean('app/api/appointments/[slug]/book/route.ts')
    const at = code.indexOf("from('appointment_slot_holds')")
    expect(at).toBeGreaterThan(-1)
    expect(code.slice(at, at + 900)).toMatch(/status:\s*503/)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * R7 — the customer reaches `contacts`, and the money path is honest
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R7: the booking round-trips into contacts', () => {
  it('the book route upserts the contact with the events own interest', () => {
    // The retired route never did this, so sixteen Summer Hair bookers never
    // landed in `contacts` at all and the reminder cron had to hunt by phone.
    const code = readClean('app/api/appointments/[slug]/book/route.ts')
    expect(code).toMatch(/upsertContactResult\(/)
    expect(code).toMatch(/serviceInterests:\s*\[cfg\.contactServiceInterest\]/)
    expect(code).toMatch(/contact_id:\s*contactId/)
  })

  it('a contacts outage does not cost us the appointment', () => {
    const code = readClean('app/api/appointments/[slug]/book/route.ts')
    const at = code.indexOf("contact.kind === 'unavailable'")
    expect(at).toBeGreaterThan(-1)
    // It logs and continues. A `return` inside that branch would mean a CRM
    // outage silently refusing real bookings.
    const branch = code.slice(at, code.indexOf('const paid =', at))
    expect(branch).toMatch(/console\.error/)
    expect(branch).not.toMatch(/return NextResponse/)
  })

  it('the booking success URL comes from publicOrigin, never a header', () => {
    const code = readClean('app/api/appointments/[slug]/book/route.ts')
    expect(code).toMatch(/publicOrigin\(req\)/)
    expect(code).not.toMatch(/x-forwarded-host/i)
  })

  it('the webhook settles on paid_at and cannot be won twice', () => {
    const code = readClean('app/api/webhook/route.ts')
    const at = code.indexOf("m.type === 'appointment_booking'")
    expect(at).toBeGreaterThan(-1)
    const branch = code.slice(at, at + 4000)
    expect(branch).toMatch(/if \(appt\.paid_at\)/)
    expect(branch).toMatch(/\.is\('paid_at', null\)/)
    // Money with no matching row is a 500 into the unclaimed net, never an
    // invented row — that is how a real $250 payment ended up in no table.
    expect(branch).toMatch(/no matching appointment booking/)
    expect(branch).not.toMatch(/from\('appointment_bookings'\)\s*\r?\n?\s*\.insert\(/)
  })

  it("'appointment_booking' is a handled Stripe type", () => {
    // An unhandled type is swept into the unclaimed net and the customer is
    // never confirmed. Rule 14.
    expect(readClean('lib/stripeSettlement.ts')).toContain("'appointment_booking'")
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * R8 — nothing from the retired feature survives
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R8: the Summer Hair surface is gone', () => {
  it('no source file under src still REFERS to it in code', () => {
    // The acceptance criterion's negative half. A stale import of a deleted file
    // is a build failure; a stale STRING is a table read that 404s at runtime.
    //
    // COMMENTS ARE STRIPPED FIRST, and that is not laziness. `christmasMarket.ts`
    // and `ChristmasMarketBanner.tsx` both cite `SpecialEventBanner` by name in
    // their headers, as the cautionary tale that produced the two-date window;
    // so does this plan's own migration. Prose about a thing that is gone is the
    // record of why it went, and a rule that fired on it would be a rule people
    // delete the prose to satisfy.
    const { readdirSync, statSync } = require('fs') as typeof import('fs')
    const offenders: string[] = []
    let examined = 0
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e)
        if (statSync(p).isDirectory()) { walk(p); continue }
        if (!/\.tsx?$/.test(e)) continue
        // This file names all five strings in CODE — in the regex on the next
        // line — because naming them is how it says they are gone. Skipping it
        // is narrower than weakening the rule for everybody else.
        if (p === __filename) continue
        examined++
        const code = decomment(readFileSync(p, 'utf8'))
        if (/summer_hair_bookings|SummerHairTab|SpecialEventBanner|summerHair|summer-hair/.test(code)) {
          offenders.push(p.slice(SRC.length + 1).split(/[\\/]/).join('/'))
        }
      }
    }
    walk(SRC)
    expect(examined).toBeGreaterThan(200)
    expect(offenders).toEqual([])
  })
})
