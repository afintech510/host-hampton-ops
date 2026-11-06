/**
 * Crew rules v1.1 (docs/specs/crew/CREW_SPEC.md §3). The figures asserted here
 * are the ones Adam approved; a change to any of them is a change to what real
 * people are paid, so it belongs in the spec changelog before it belongs here.
 */
import {
  DEFAULT_SETTINGS, HARD_MAX_STEPS, settingsFromRows, partyRateCents, partyPayCents, tipTopupCents,
  stepAfter, revertedSteps, isInGracePeriod, nextStepLabel, ratesFor, formatCents, requiredSlots,
  slotsForParty, slotRolesFor, classifyDrop, standbyEscalateAt, unclaimedWarningAt, leadAlertAt,
  confirmationSchedule, isBlockedByAvailability, shiftsOverlap, defaultShift, localParts,
  payLabelFor, staffingShortfall, understaffedAlertAt, nudgeMarks,
  type CrewSettings,
} from '@/lib/crew/rules'
import { LADDER_ON, PAY_SHOWN_LADDER_OFF } from '../../helpers/crewLadder'

const S = DEFAULT_SETTINGS
const withLaunch = (launchDate: string | null, graceDays = 60): CrewSettings => ({ ...S, launch: { launchDate, graceDays } })

describe('pay: flat per party', () => {
  it('crew $51 → $71 and Lead $70 → $90 in $2.50 steps, 8 at most', () => {
    expect(partyRateCents('crew', 0)).toBe(5100)
    expect(partyRateCents('crew', 8)).toBe(7100)
    expect(partyRateCents('lead', 0)).toBe(7000)
    expect(partyRateCents('lead', 8)).toBe(9000)
    for (let st = 0; st < 8; st++) {
      expect(partyRateCents('crew', st + 1) - partyRateCents('crew', st)).toBe(250)
      expect(partyRateCents('lead', st + 1) - partyRateCents('lead', st)).toBe(250)
    }
  })

  it('the acceptance figures: step 3 crew $58.50, step 3 Lead $77.50', () => {
    expect(partyRateCents('crew', 3)).toBe(5850)
    expect(partyRateCents('lead', 3)).toBe(7750)
  })

  it('clamps an out-of-range step instead of paying past the top', () => {
    expect(partyRateCents('crew', 12)).toBe(7100)
    expect(partyRateCents('crew', -4)).toBe(5100)
    expect(partyRateCents('crew', Number.NaN)).toBe(5100)
    expect(partyRateCents('crew', 2.9)).toBe(5600)
  })

  it('adds the flat extra per person, and ignores a negative one', () => {
    expect(partyPayCents('crew', 3, 1500)).toBe(7350)
    expect(partyPayCents('crew', 3, -1500)).toBe(5850)
    expect(partyPayCents('lead', 0, null)).toBe(7000)
  })
})

describe('tips: topped up to $20 per person', () => {
  it('a $12 tip records an $8 top-up', () => expect(tipTopupCents(1200)).toBe(800))
  it('no tip records a $20 top-up', () => {
    expect(tipTopupCents(0)).toBe(2000)
    expect(tipTopupCents(null)).toBe(2000)
    expect(tipTopupCents(undefined)).toBe(2000)
  })
  it('$20 or more needs nothing', () => {
    expect(tipTopupCents(2000)).toBe(0)
    expect(tipTopupCents(10000)).toBe(0)
  })
  it('a negative tip is not a bigger top-up than none', () => expect(tipTopupCents(-500)).toBe(2000))
})

describe('steps', () => {
  it('worked +1, covered +2 in place of +1, early release −1', () => {
    expect(stepAfter('worked', 3, LADDER_ON).stepsAfter).toBe(4)
    expect(stepAfter('worked_covered', 3, LADDER_ON).stepsAfter).toBe(5)
    expect(stepAfter('early_release', 3, LADDER_ON).stepsAfter).toBe(2)
  })

  it('never below 0, never above the max', () => {
    expect(stepAfter('early_release', 0, LADDER_ON).stepsAfter).toBe(0)
    expect(stepAfter('worked', 8, LADDER_ON).stepsAfter).toBe(8)
    expect(stepAfter('worked_covered', 7, LADDER_ON).stepsAfter).toBe(8)
  })

  it('a covered late cancel changes nothing; an uncovered one and a no-show reset to 0', () => {
    expect(stepAfter('late_cancel_covered', 6, LADDER_ON).stepsAfter).toBe(6)
    expect(stepAfter('late_cancel_uncovered', 6, LADDER_ON).stepsAfter).toBe(0)
    expect(stepAfter('no_show', 6, LADDER_ON).stepsAfter).toBe(0)
  })

  it('in grace a loss is recorded, not applied — and says what it would have been', () => {
    const o = stepAfter('no_show', 6, LADDER_ON, true)
    expect(o).toEqual({ stepsAfter: 6, stepsBefore: 6, delta: 0, waivedGrace: true, wouldBe: 0 })
    expect(stepAfter('early_release', 2, LADDER_ON, true)).toMatchObject({ stepsAfter: 2, waivedGrace: true, wouldBe: 1 })
    expect(stepAfter('late_cancel_uncovered', 4, LADDER_ON, true)).toMatchObject({ stepsAfter: 4, waivedGrace: true })
  })

  it('in grace a GAIN still applies, and is not marked waived', () => {
    expect(stepAfter('worked', 2, LADDER_ON, true)).toMatchObject({ stepsAfter: 3, delta: 1, waivedGrace: false })
  })

  it('a loss that loses nothing is not "waived" (step 0 early release)', () => {
    expect(stepAfter('early_release', 0, LADDER_ON, true).waivedGrace).toBe(false)
    expect(stepAfter('no_show', 0, LADDER_ON, true).waivedGrace).toBe(false)
  })

  it('the delta always equals after − before (crew_events_delta_check)', () => {
    const events = ['worked', 'worked_covered', 'early_release', 'late_cancel_covered', 'late_cancel_uncovered', 'no_show'] as const
    for (const e of events) for (let st = 0; st <= 8; st++) for (const g of [true, false]) {
      const o = stepAfter(e, st, LADDER_ON, g)
      expect(o.stepsAfter - o.stepsBefore).toBe(o.delta)
      expect(o.stepsAfter).toBeGreaterThanOrEqual(0)
      expect(o.stepsAfter).toBeLessThanOrEqual(HARD_MAX_STEPS)
    }
  })

  it('the attendance acceptance: step 3 paid $58.50, then 4', () => {
    const before = 3
    expect(partyRateCents('crew', before)).toBe(5850)
    expect(stepAfter('worked', before, LADDER_ON).stepsAfter).toBe(4)
  })

  it('LADDER OFF (the launch default): no event moves a step, in grace or out of it', () => {
    const events = ['worked', 'worked_covered', 'early_release', 'late_cancel_covered', 'late_cancel_uncovered', 'no_show'] as const
    expect(S.ladderEnabled).toBe(false)
    let examined = 0
    for (const e of events) for (let st = 0; st <= 8; st++) for (const g of [true, false]) {
      const o = stepAfter(e, st, S, g)
      expect(o).toEqual({ stepsAfter: st, stepsBefore: st, delta: 0, waivedGrace: false, wouldBe: st })
      // Showing pay does not switch the ladder on: only the ladder switch moves steps.
      expect(stepAfter(e, st, PAY_SHOWN_LADDER_OFF, g).delta).toBe(0)
      examined++
    }
    expect(examined).toBe(events.length * 9 * 2)
  })

  it('reverting a correction undoes exactly the earlier change, a reset included', () => {
    expect(revertedSteps(4, 1)).toBe(3)       // worked, corrected
    expect(revertedSteps(0, -5)).toBe(5)      // a no-show reset from 5, corrected
    expect(revertedSteps(6, 0)).toBe(6)       // a waived loss changed nothing
  })
})

describe('launch grace (60 days from an ET date)', () => {
  it('not launched = grace', () => expect(isInGracePeriod(new Date('2030-01-01T00:00:00Z'), withLaunch(null))).toBe(true))

  it('ends at Eastern midnight, not UTC midnight', () => {
    const s = withLaunch('2026-11-01', 60) // grace ends 2026-12-31 00:00 ET = 05:00Z (EST)
    expect(isInGracePeriod(new Date('2026-12-31T04:59:00Z'), s)).toBe(true)
    expect(isInGracePeriod(new Date('2026-12-31T05:00:00Z'), s)).toBe(false)
    // v1's `T00:00:00Z` anchor would have ended it here, five hours early:
    expect(isInGracePeriod(new Date('2026-12-31T00:30:00Z'), s)).toBe(true)
  })

  it('an unreadable launch date waives losses rather than applying them', () => {
    expect(isInGracePeriod(new Date(), settingsFromRows([{ key: 'launch', value: { launch_date: '2026-13', grace_days: 60 } }]))).toBe(true)
  })

  it('grace 0 days ends at the launch date itself', () => {
    const s = withLaunch('2026-11-01', 0)
    expect(isInGracePeriod(new Date('2026-11-01T03:59:00Z'), s)).toBe(true)
    expect(isInGracePeriod(new Date('2026-11-01T04:00:00Z'), s)).toBe(false) // EDT ends Nov 1 06:00Z, so midnight is 04:00Z
  })
})

describe('what crew read', () => {
  it('plain words, dollars only', () => {
    expect(nextStepLabel(3, true)).toBe("You're at $58.50 a party ($77.50 leading). One more party makes it $61.00.")
    expect(nextStepLabel(0, false)).toBe("You're at $51.00 a party. One more party makes it $53.50.")
    expect(nextStepLabel(8, true)).toBe("You're at the top rate: $71.00 a party ($90.00 leading).")
  })

  it('never says level, tier or points', () => {
    for (let st = 0; st <= 8; st++) for (const lead of [true, false]) {
      expect(nextStepLabel(st, lead)).not.toMatch(/\b(level|tier|points?|captain|pro)\b/i)
    }
  })

  it('ratesFor / formatCents', () => {
    expect(ratesFor(8)).toEqual({ crewCents: 7100, leadCents: 9000, atMax: true })
    expect(formatCents(5750)).toBe('$57.50')
    expect(formatCents(5)).toBe('$0.05')
    expect(formatCents(-800)).toBe('-$8.00')
  })
})

describe('staffing: max(3, ceil(kids / 4)), including the Lead', () => {
  it('3 up to 12 kids, 4 up to 16, then one per 4', () => {
    expect(requiredSlots(1)).toBe(3)
    expect(requiredSlots(12)).toBe(3)
    expect(requiredSlots(13)).toBe(4)
    expect(requiredSlots(16)).toBe(4)
    expect(requiredSlots(17)).toBe(5)
    expect(requiredSlots(24)).toBe(6)
  })
  it('unknown, zero or nonsense kids = 3', () => {
    expect(requiredSlots(null)).toBe(3)
    expect(requiredSlots(undefined)).toBe(3)
    expect(requiredSlots(0)).toBe(3)
    expect(requiredSlots(Number.NaN)).toBe(3)
  })
  it('capped at max_slots', () => expect(requiredSlots(400)).toBe(10))
  it('an override wins, a nonsense override does not', () => {
    expect(slotsForParty({ guestCount: 30, slotsOverride: 2 })).toBe(2)
    expect(slotsForParty({ guestCount: 30, slotsOverride: 0 })).toBe(8)
    expect(slotsForParty({ guestCount: 30, slotsOverride: 2.5 })).toBe(8)
  })
  it('exactly one Lead spot', () => {
    expect(slotRolesFor(4)).toEqual(['lead', 'crew', 'crew', 'crew'])
    expect(slotRolesFor(1)).toEqual(['lead'])
    expect(slotRolesFor(0)).toEqual(['lead'])
  })
})

describe('settingsFromRows', () => {
  it('no rows = the seed', () => expect(settingsFromRows([])).toEqual(DEFAULT_SETTINGS))

  it('reads the snake_case seed shape', () => {
    const s = settingsFromRows([
      { key: 'pay', value: { crew_start_cents: 5500, lead_start_cents: 7500, step_cents: 300, max_steps: 6, tip_floor_cents: 2500 } },
      { key: 'slots_by_guests', value: { min_slots: 2, kids_per_crew: 5, max_slots: 8 } },
      { key: 'launch', value: { launch_date: '2026-11-01', grace_days: 30 } },
    ])
    expect(s.pay).toEqual({ crewStartCents: 5500, leadStartCents: 7500, stepCents: 300, maxSteps: 6, tipFloorCents: 2500 })
    expect(s.slotsByGuests).toEqual({ minSlots: 2, kidsPerCrew: 5, maxSlots: 8 })
    expect(s.launch).toEqual({ launchDate: '2026-11-01', graceDays: 30 })
  })

  it('clamps max_steps to the DB check, and refuses a zero divisor', () => {
    const s = settingsFromRows([
      { key: 'pay', value: { max_steps: 12 } },
      { key: 'slots_by_guests', value: { kids_per_crew: 0, min_slots: 4, max_slots: 2 } },
    ])
    expect(s.pay.maxSteps).toBe(8)
    expect(s.slotsByGuests.kidsPerCrew).toBe(1)
    expect(s.slotsByGuests.maxSlots).toBe(4) // never below min
  })

  it('an early-release value cannot become a reward, nor worked a loss', () => {
    const s = settingsFromRows([{ key: 'steps', value: { worked: -3, covered: 'two', early_release: 2 } }])
    expect(s.steps).toEqual({ worked: 0, covered: 2, earlyRelease: 0 })
  })
})

describe('cancelling and cover', () => {
  const start = new Date('2026-11-14T18:00:00Z')
  it('7+ days is an early release, under 7 a late cancel, after the start "started"', () => {
    expect(classifyDrop(start, new Date('2026-11-07T18:00:00Z')).kind).toBe('early_release')
    expect(classifyDrop(start, new Date('2026-11-07T18:00:01Z')).kind).toBe('late_cancel')
    expect(classifyDrop(start, new Date('2026-11-14T18:00:00Z')).kind).toBe('started')
  })
  it('escalates after the standby window, or at once with nobody to ask', () => {
    const at = new Date('2026-11-10T15:00:00Z')
    expect(standbyEscalateAt(at, 3).toISOString()).toBe('2026-11-10T17:00:00.000Z')
    expect(standbyEscalateAt(at, 0).toISOString()).toBe(at.toISOString())
  })
  it('the 48-hour warning and the 7-day no-Lead alert', () => {
    expect(unclaimedWarningAt(start).toISOString()).toBe('2026-11-12T18:00:00.000Z')
    expect(leadAlertAt(start).toISOString()).toBe('2026-11-07T18:00:00.000Z')
  })
  it('a claim has no undo: nothing hands a committed spot back except a cover request', () => {
    expect(require('@/lib/crew/rules').canUndoClaim).toBeUndefined()
  })
})

describe('availability and overlap (kept from v1)', () => {
  // Sat 2026-11-14, 1:00–4:00pm EST
  const party = { startsAt: new Date('2026-11-14T18:00:00Z'), endsAt: new Date('2026-11-14T21:00:00Z') }
  it('reads the Eastern day', () => expect(localParts(party.startsAt)).toEqual({ dateKey: '2026-11-14', dow: 6, minutes: 13 * 60 }))
  it('all_day and after_noon block an afternoon party; before_noon does not', () => {
    expect(isBlockedByAvailability(party, [{ day: '2026-11-14', part: 'all_day' }], [])).toBe(true)
    expect(isBlockedByAvailability(party, [{ day: '2026-11-14', part: 'after_noon' }], [])).toBe(true)
    expect(isBlockedByAvailability(party, [{ day: '2026-11-14', part: 'before_noon' }], [])).toBe(false)
  })
  it('a recurring Saturday block applies; an inactive one does not', () => {
    expect(isBlockedByAvailability(party, [], [{ dow: 6, part: 'all_day', active: true }])).toBe(true)
    expect(isBlockedByAvailability(party, [], [{ dow: 6, part: 'all_day', active: false }])).toBe(false)
  })
  it('shifts overlap through the setup/clean-up buffers', () => {
    const later = { startsAt: new Date('2026-11-14T21:45:00Z'), endsAt: new Date('2026-11-15T00:00:00Z') }
    const muchLater = { startsAt: new Date('2026-11-14T22:00:00Z'), endsAt: new Date('2026-11-15T00:00:00Z') }
    expect(shiftsOverlap(party, later)).toBe(true)
    expect(shiftsOverlap(party, muchLater)).toBe(false)
  })
  it('the default shift on record is party ± 30 minutes, and is hours only', () => {
    const sh = defaultShift(party)
    expect(sh.startedAt.toISOString()).toBe('2026-11-14T17:30:00.000Z')
    expect(sh.endedAt.toISOString()).toBe('2026-11-14T21:30:00.000Z')
    expect(sh.hours).toBe(4)
  })
})

describe('launch switches', () => {
  it('both default OFF; payVisible follows the ladder or CREW_SHOW_PAY', () => {
    expect(DEFAULT_SETTINGS.ladderEnabled).toBe(false)
    expect(DEFAULT_SETTINGS.payVisible).toBe(false)
    const off = settingsFromRows([])
    expect([off.ladderEnabled, off.payVisible]).toEqual([false, false])
    const show = settingsFromRows([], { showPay: true })
    expect([show.ladderEnabled, show.payVisible]).toEqual([false, true])
    const ladder = settingsFromRows([], { ladderEnabled: true })
    expect([ladder.ladderEnabled, ladder.payVisible]).toEqual([true, true])
  })

  it('payLabelFor is null while pay is hidden and a dollar string once it is shown', () => {
    expect(payLabelFor('crew', 3, null, S)).toBeNull()
    expect(payLabelFor('lead', 3, 500, S)).toBeNull()
    expect(payLabelFor('crew', 3, null, LADDER_ON)).toBe('$58.50')
    expect(payLabelFor('crew', 3, null, PAY_SHOWN_LADDER_OFF)).toBe('$58.50')
  })
})

describe('autopilot settings', () => {
  it('missing rows fall back to the defaults, never to "off" for the alerts', () => {
    expect(settingsFromRows([]).autopilot).toEqual({
      autoPublish: false, autoPublishFrom: null, understaffedDaysBefore: 5, nudgeFirstDaysBefore: 10, nudgeSecondDaysBefore: 5,
    })
  })

  it('reads the snake_case seed shape and refuses a non-boolean or a malformed date', () => {
    const ok = settingsFromRows([{ key: 'autopilot', value: {
      auto_publish: true, auto_publish_from: '2026-11-10', understaffed_days_before: 4, nudge_first_days_before: 9, nudge_second_days_before: 3,
    } }])
    expect(ok.autopilot).toEqual({ autoPublish: true, autoPublishFrom: '2026-11-10', understaffedDaysBefore: 4, nudgeFirstDaysBefore: 9, nudgeSecondDaysBefore: 3 })
    const bad = settingsFromRows([{ key: 'autopilot', value: { auto_publish: 'yes', auto_publish_from: 'tomorrow' } }])
    expect(bad.autopilot.autoPublish).toBe(false)
    expect(bad.autopilot.autoPublishFrom).toBeNull()
  })
})

describe('staffing shortfall', () => {
  const slot = (role: 'lead' | 'crew', status: string, member: string | null) => ({ role, status, member_id: member })
  it('a themed party with no Lead held is lead-short; held and cancelled spots are not crew-short', () => {
    expect(staffingShortfall({ party_kind: 'themed' }, [slot('lead', 'open', null), slot('crew', 'assigned', 'm1'), slot('crew', 'open', null), slot('crew', 'cancelled', null)]))
      .toEqual({ crewShort: 1, leadShort: true })
    expect(staffingShortfall({ party_kind: 'themed' }, [slot('lead', 'assigned', 'm1'), slot('crew', 'assigned', 'm2')]))
      .toEqual({ crewShort: 0, leadShort: false })
  })

  it('a studio rental can never be short of a Lead', () => {
    expect(staffingShortfall({ party_kind: 'studio_rental' }, [slot('crew', 'open', null)])).toEqual({ crewShort: 1, leadShort: false })
    expect(staffingShortfall({ party_kind: 'studio_rental' }, [])).toEqual({ crewShort: 0, leadShort: false })
  })

  it('the alert moment: a missing Lead no later than the Lead window, crew at the autopilot setting', () => {
    const start = new Date('2026-11-14T18:00:00Z')
    expect(understaffedAlertAt(start, false).toISOString()).toBe('2026-11-09T18:00:00.000Z')   // 5 days
    expect(understaffedAlertAt(start, true).toISOString()).toBe('2026-11-07T18:00:00.000Z')    // max(7, 5) days
    const wide = { ...S, autopilot: { ...S.autopilot, understaffedDaysBefore: 9 } }
    expect(understaffedAlertAt(start, true, wide).toISOString()).toBe('2026-11-05T18:00:00.000Z')
  })

  it('the nudge marks come from the autopilot settings', () => {
    const start = new Date('2026-11-14T18:00:00Z')
    const m = nudgeMarks(start)
    expect(m.first.toISOString()).toBe('2026-11-04T18:00:00.000Z')
    expect(m.second.toISOString()).toBe('2026-11-09T18:00:00.000Z')
  })
})
