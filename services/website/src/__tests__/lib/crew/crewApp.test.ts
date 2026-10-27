/**
 * Phase 2's pure pieces: §3.6 claim eligibility, §3.8 "you can't block a day
 * you're working", the skills screen, and the crew-facing projections added for
 * the app (the test picker, the pay ladder, "how cancelling works").
 */
import { claimRefusal, DEFAULT_SETTINGS, partiesBlockedBy, type CrewSettings } from '@/lib/crew/rules'
import { cancellingLines, payLadder, testPickView, claimRefusalText } from '@/lib/crew/view'
import { screenSkills, splitSkills, CREW_SKILLS } from '@/lib/crew/skills'

const S = DEFAULT_SETTINGS
// Sat 2026-11-14, 1:00–4:00 PM ET (EST, UTC-5).
const P = { startsAt: new Date('2026-11-14T18:00:00Z'), endsAt: new Date('2026-11-14T21:00:00Z') }
const NOW = new Date('2026-11-01T12:00:00Z')

const ok = {
  party: { status: 'published', ...P },
  slot: { role: 'crew' as const, status: 'open' },
  member: { status: 'active', canLead: false, isOwner: false },
  alreadyOnParty: false,
  otherParties: [],
  blocks: [],
  recurring: [],
  now: NOW,
}

describe('claimRefusal (§3.6)', () => {
  it('an eligible claim is allowed', () => {
    expect(claimRefusal(ok, S)).toBeNull()
  })

  it('a draft, cancelled or started party is closed', () => {
    expect(claimRefusal({ ...ok, party: { ...ok.party, status: 'draft' } }, S)).toBe('party_closed')
    expect(claimRefusal({ ...ok, party: { ...ok.party, status: 'cancelled' } }, S)).toBe('party_closed')
    expect(claimRefusal({ ...ok, now: P.startsAt }, S)).toBe('party_closed')
  })

  it('a paused member, a removed member and the owner may not claim', () => {
    expect(claimRefusal({ ...ok, member: { ...ok.member, status: 'paused' } }, S)).toBe('inactive')
    expect(claimRefusal({ ...ok, member: { ...ok.member, status: 'removed' } }, S)).toBe('inactive')
    expect(claimRefusal({ ...ok, member: { ...ok.member, isOwner: true } }, S)).toBe('inactive')
  })

  it('a spot that is not open is unavailable', () => {
    expect(claimRefusal({ ...ok, slot: { role: 'crew', status: 'assigned' } }, S)).toBe('unavailable')
  })

  it('the Lead spot needs can_lead', () => {
    expect(claimRefusal({ ...ok, slot: { role: 'lead', status: 'open' } }, S)).toBe('not_lead')
    expect(claimRefusal({ ...ok, slot: { role: 'lead', status: 'open' }, member: { ...ok.member, canLead: true } }, S)).toBeNull()
  })

  it('one spot per party', () => {
    expect(claimRefusal({ ...ok, alreadyOnParty: true }, S)).toBe('already_on_party')
  })

  it('an overlapping party counts setup and clean-up', () => {
    // Ends 12:40 ET; with 30 min clean-up + 30 min setup it touches a 1:00 start.
    const morning = { startsAt: new Date('2026-11-14T15:00:00Z'), endsAt: new Date('2026-11-14T17:40:00Z') }
    expect(claimRefusal({ ...ok, otherParties: [morning] }, S)).toBe('overlap')
    // Ends 11:30 ET: an hour and a half clear.
    const early = { startsAt: new Date('2026-11-14T14:00:00Z'), endsAt: new Date('2026-11-14T16:30:00Z') }
    expect(claimRefusal({ ...ok, otherParties: [early] }, S)).toBeNull()
  })

  it('a blocked date or part of day refuses, judged in Eastern time', () => {
    expect(claimRefusal({ ...ok, blocks: [{ day: '2026-11-14', part: 'all_day' }] }, S)).toBe('blocked')
    expect(claimRefusal({ ...ok, blocks: [{ day: '2026-11-14', part: 'after_noon' }] }, S)).toBe('blocked')
    expect(claimRefusal({ ...ok, blocks: [{ day: '2026-11-14', part: 'before_noon' }] }, S)).toBeNull()
    expect(claimRefusal({ ...ok, blocks: [{ day: '2026-11-15', part: 'all_day' }] }, S)).toBeNull()
    expect(claimRefusal({ ...ok, recurring: [{ dow: 6, part: 'all_day', active: true }] }, S)).toBe('blocked')
    expect(claimRefusal({ ...ok, recurring: [{ dow: 6, part: 'all_day', active: false }] }, S)).toBeNull()
  })

  it('every refusal has plain words, and none of them is the generic fallback', () => {
    for (const r of ['party_closed', 'inactive', 'unavailable', 'not_lead', 'already_on_party', 'overlap', 'blocked']) {
      expect(claimRefusalText(r)).not.toBe(claimRefusalText('?'))
    }
  })
})

describe('partiesBlockedBy (§3.8: no blocking a day you are working)', () => {
  it('a date block on a working day collides; a part of day that misses does not', () => {
    expect(partiesBlockedBy({ day: '2026-11-14', part: 'all_day' }, [P])).toHaveLength(1)
    expect(partiesBlockedBy({ day: '2026-11-14', part: 'before_noon' }, [P])).toHaveLength(0)
    expect(partiesBlockedBy({ day: '2026-11-13', part: 'all_day' }, [P])).toHaveLength(0)
  })
  it('a weekly block collides with any party on that weekday', () => {
    expect(partiesBlockedBy({ dow: 6, part: 'after_noon' }, [P])).toHaveLength(1)
    expect(partiesBlockedBy({ dow: 0, part: 'all_day' }, [P])).toHaveLength(0)
  })
})

describe('screenSkills', () => {
  it('keeps known labels in list order and drops unknown ones', () => {
    const r = screenSkills({ skills: ['Nails', 'Hacking', CREW_SKILLS[0]], extras: [] })
    expect(r).toEqual({ ok: true, skills: [CREW_SKILLS[0], 'Nails'] })
  })
  it('trims, collapses, strips control characters and de-duplicates extras', () => {
    const r = screenSkills({ skills: ['Nails'], extras: ['  Cake   decorating ', 'cake decorating', 'nails', 'a\u0000b', '   '] })
    expect(r).toEqual({ ok: true, skills: ['Nails', 'Cake decorating', 'a b'] })
  })
  it('refuses an extra over 40 characters rather than cutting it', () => {
    expect(screenSkills({ extras: ['x'.repeat(41)] }).ok).toBe(false)
    expect(screenSkills({ extras: ['x'.repeat(40)] }).ok).toBe(true)
  })
  it('refuses more than ten extras, and non-text', () => {
    expect(screenSkills({ extras: Array.from({ length: 11 }, (_, i) => `skill ${i}`) }).ok).toBe(false)
    expect(screenSkills({ extras: Array.from({ length: 10 }, (_, i) => `skill ${i}`) }).ok).toBe(true)
    expect(screenSkills({ extras: [{ evil: true }] }).ok).toBe(false)
  })
  it('splits a stored list back into boxes and extras', () => {
    expect(splitSkills(['Nails', 'Cake decorating'])).toEqual({ picked: ['Nails'], extras: ['Cake decorating'] })
  })
})

describe('testPickView', () => {
  it('carries a name, a rate and can-lead, and never an email or a phone', () => {
    const row = { id: 'id-1', first_name: 'Ava', last_name: 'Martinez', steps: 3, can_lead: true,
      email: 'SENTINEL-EMAIL@example.com', phone: '+16315550199', admin_notes: 'SENTINEL-NOTE' } as any
    const out = testPickView([row], S)
    expect(out).toEqual([{ id: 'id-1', firstName: 'Ava', lastName: 'Martinez', rateCents: 5850, canLead: true }])
    expect(JSON.stringify(out)).not.toMatch(/SENTINEL|\+1631/)
  })
})

describe('payLadder', () => {
  it('runs $51 → $71 crew and $70 → $90 leading, marking my row', () => {
    const l = payLadder(3, true, S)
    expect(l).toHaveLength(9)
    expect(l[0]).toMatchObject({ crewCents: 5100, leadCents: 7000 })
    expect(l[8]).toMatchObject({ crewCents: 7100, leadCents: 9000 })
    expect(l.filter(r => r.isMine).map(r => r.index)).toEqual([3])
  })
  it('no Lead column for a member who cannot lead', () => {
    expect(payLadder(0, false, S).every(r => r.leadCents === null)).toBe(true)
  })
})

describe('cancellingLines', () => {
  const BANNED = /\b(level|levels|tier|tiers|points?|captain|crew pro|pro)\b/i
  const launched: CrewSettings = { ...S, launch: { launchDate: '2026-01-01', graceDays: 60 } }

  it('says what the settings do, in dollars, with no tier words', () => {
    const lines = cancellingLines(launched, NOW)
    const text = lines.join(' ')
    expect(text).toMatch(/7 days or more notice/)
    expect(text).toMatch(/goes down \$2\.50 a party/)
    expect(text).toMatch(/starting \$51\.00/)
    expect(text).toMatch(/by \$5\.00 instead of \$2\.50/)
    expect(text).toMatch(/\$20\.00/)
    expect(text).not.toMatch(BANNED)
    expect(text).not.toMatch(/getting started/) // grace is over
  })

  it('says so during the launch grace', () => {
    expect(cancellingLines(S, NOW).join(' ')).toMatch(/While we're getting started, none of this lowers your rate/)
    const inGrace: CrewSettings = { ...S, launch: { launchDate: '2026-10-20', graceDays: 60 } }
    expect(cancellingLines(inGrace, NOW).join(' ')).toMatch(/until Sat, Dec 19/)
  })

  it('follows a changed setting rather than a sentence typed once', () => {
    const s: CrewSettings = { ...launched, drops: { ...S.drops, lateDropDays: 10 }, steps: { ...S.steps, earlyRelease: 0 } }
    const text = cancellingLines(s, NOW).join(' ')
    expect(text).toMatch(/10 days or more notice\? Your spot opens up for the rest of the crew and your rate stays the same/)
  })
})
