import {
  troopConfig,
  publicSnack,
  screenInboxEntry,
  screenSnackClaim,
  screenScheduleItem,
  screenSettings,
  screenFamilySignup,
  familyConsentText,
  isIsoDate,
  fmtLongDate,
} from '@/lib/troop'
import { isTroopBoardPath, isMetaPixelBlockedPath } from '@/lib/evites/chrome'

describe('troop board', () => {
  it('knows troop 2514 and nothing else', () => {
    expect(troopConfig('2514')?.number).toBe('2514')
    expect(troopConfig('9999')).toBeNull()
    expect(troopConfig('__proto__')).toBeNull()
  })

  it("the public snack view never carries the scout's name", () => {
    const shown = publicSnack({ schedule_id: 'x', parent_name: 'Dana', scout_name: 'Maya R.', item: 'Pretzels' })
    expect(shown).toEqual({ parent_name: 'Dana', item: 'Pretzels' })
    expect(JSON.stringify(shown)).not.toContain('Maya')
  })

  it('screens an absence: requires scout, parent and a real date; email optional but checked', () => {
    expect(screenInboxEntry({ kind: 'absence', scout: 'Maya R.', parent: 'Dana', date: '2026-10-30' }).ok).toBe(true)
    expect(screenInboxEntry({ kind: 'absence', scout: 'Maya R.', parent: 'Dana', date: '2026-02-30' }).ok).toBe(false)
    expect(screenInboxEntry({ kind: 'absence', scout: '', parent: 'Dana', date: '2026-10-30' }).ok).toBe(false)
    expect(screenInboxEntry({ kind: 'absence', scout: 'M', parent: 'D', date: '2026-10-30', email: 'nope' }).ok).toBe(false)
  })

  it('an anonymous idea drops the name even if one was typed', () => {
    const r = screenInboxEntry({ kind: 'idea', text: 'Aquarium trip', anon: true, name: 'Dana' })
    expect(r.ok && r.value.kind === 'idea' && r.value.parent_name).toBeNull()
  })

  it('an unknown idea kind falls back rather than storing free text', () => {
    const r = screenInboxEntry({ kind: 'idea', text: 'x', ideaKind: '<script>' })
    expect(r.ok && r.value.kind === 'idea' && r.value.idea_kind).toBe('Activity idea')
  })

  it('refuses an unknown form kind', () => {
    expect(screenInboxEntry({ kind: 'admin' }).ok).toBe(false)
  })

  it('a snack claim needs a schedule uuid and all three fields', () => {
    const id = '0b6f4c1e-3a2d-4f7a-9e1b-2c3d4e5f6a7b'
    expect(screenSnackClaim({ scheduleId: id, parent: 'Dana', scout: 'Maya', item: 'Grapes' }).ok).toBe(true)
    expect(screenSnackClaim({ scheduleId: 'x', parent: 'Dana', scout: 'Maya', item: 'Grapes' }).ok).toBe(false)
    expect(screenSnackClaim({ scheduleId: id, parent: 'Dana', scout: 'Maya', item: ' ' }).ok).toBe(false)
  })

  it('a schedule item refuses an end before its start', () => {
    const base = { title: 'Meeting', event_date: '2026-10-30', start_time: '18:30' }
    expect(screenScheduleItem({ ...base, end_time: '19:45' }).ok).toBe(true)
    expect(screenScheduleItem({ ...base, end_time: '18:00' }).ok).toBe(false)
    expect(screenScheduleItem({ ...base, start_time: '25:00' }).ok).toBe(false)
  })

  it('a blank start time is "Time TBA", but an end time needs a start', () => {
    const base = { title: 'Rockettes show', event_date: '2026-11-11' }
    const r = screenScheduleItem({ ...base, start_time: '' })
    expect(r.ok && r.value.start_time).toBeNull()
    expect(screenScheduleItem({ ...base }).ok).toBe(true)
    expect(screenScheduleItem({ ...base, start_time: '', end_time: '19:00' }).ok).toBe(false)
    expect(screenScheduleItem({ ...base, start_time: 'soon' }).ok).toBe(false)
  })

  it('settings refuse a malformed leader email and de-duplicate', () => {
    expect(screenSettings({ leader_emails: ['a@b.co', 'bad'] }).ok).toBe(false)
    const r = screenSettings({ leader_emails: ['A@b.co', 'a@b.co'], leader_names: ['Ms. Kelly'] })
    expect(r.ok && r.value.leader_emails).toEqual(['a@b.co'])
  })

  it('reads a date as a calendar day, not a UTC instant', () => {
    expect(isIsoDate('2026-10-30')).toBe(true)
    expect(isIsoDate('2026-10')).toBe(false)
    expect(fmtLongDate('2026-10-30')).toBe('Friday, Oct 30')
  })

  it('the board path loads no Meta Pixel', () => {
    expect(isTroopBoardPath('/troop2514')).toBe(true)
    expect(isTroopBoardPath('/troopers')).toBe(false)
    expect(isMetaPixelBlockedPath('/troop2514')).toBe(true)
  })

  it('a family sign-up needs a name, a real email and the consent box', () => {
    const ok = screenFamilySignup({ name: 'Dana P.', email: 'Dana@Example.com', phone: '(631) 555-0134', consent: true }, 'Troop X')
    expect(ok.ok && ok.value.email).toBe('Dana@Example.com')
    expect(ok.ok && ok.value.consent_text).toBe(familyConsentText('Troop X', true))
    expect(ok.ok && ok.value.consent_text).toContain('text message')
    const noPhone = screenFamilySignup({ name: 'Dana', email: 'd@e.co', consent: true }, 'Troop X')
    expect(noPhone.ok && noPhone.value.consent_text).not.toContain('text')
    expect(screenFamilySignup({ name: 'Dana', email: 'd@e.co', consent: false }, 'T').ok).toBe(false)
    expect(screenFamilySignup({ name: 'Dana', email: 'd@e.co', consent: 'yes' }, 'T').ok).toBe(false)
    expect(screenFamilySignup({ name: '', email: 'd@e.co', consent: true }, 'T').ok).toBe(false)
    expect(screenFamilySignup({ name: 'Dana', email: 'd@e.co', phone: '555-12', consent: true }, 'T').ok).toBe(false)
  })
})
