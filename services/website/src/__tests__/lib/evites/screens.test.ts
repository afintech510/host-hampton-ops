import {
  screenAdultCount,
  screenBirthdayMonth,
  screenChildren,
  screenCountFromZero,
  screenName,
  screenNote,
  screenReminderContact,
  screenRsvpPatch,
  screenRsvpPost,
  type ExistingRsvp,
} from '@/lib/evites/screens'
import { screenPublicCount } from '@/lib/publicIntake'

/** The RSVP input screens (spec §2 `screens.ts`, §7.5). */

describe('names', () => {
  it('trims, collapses whitespace and strips control, zero-width and bidi characters', () => {
    expect(screenName('  Pat \t  Parent  ', 120)).toBe('Pat Parent')
    expect(screenName('Pa' + String.fromCharCode(0) + 't' + String.fromCharCode(0x200b), 120)).toBe('Pat')
    expect(screenName(String.fromCharCode(0x202e) + 'evil', 120)).toBe('evil')
    expect(screenName('A\nB', 120)).toBe('A B')
  })
  it('refuses empty, invisible-only, non-string and over-cap values (it does not cut them)', () => {
    expect(screenName('', 40)).toBeNull()
    expect(screenName('   ', 40)).toBeNull()
    expect(screenName(String.fromCharCode(0x200b) + String.fromCharCode(0x200b), 40)).toBeNull()
    expect(screenName(42, 40)).toBeNull()
    expect(screenName(null, 40)).toBeNull()
    expect(screenName('x'.repeat(41), 40)).toBeNull()
    expect(screenName('x'.repeat(40), 40)).toBe('x'.repeat(40))
  })
  it('counts characters, not UTF-16 units', () => {
    expect(screenName('\u{1F600}'.repeat(40), 40)).not.toBeNull()
    expect(screenName('\u{1F600}'.repeat(41), 40)).toBeNull()
  })
})

describe('notes', () => {
  it('keeps line breaks, squeezes blank runs, and allows empty (stored as NULL by the caller)', () => {
    expect(screenNote('a\r\nb\n\n\n\nc', 500)).toBe('a\nb\n\nc')
    expect(screenNote('   ', 500)).toBe('')
    expect(screenNote('x'.repeat(501), 500)).toBeNull()
    expect(screenNote(5, 500)).toBeNull()
  })
})

describe('counts: 0..N, because screenPublicCount refuses 0', () => {
  it('accepts zero', () => {
    expect(screenPublicCount(0, 2)).toBeNull() // the reason this module exists
    expect(screenCountFromZero(0, 2)).toBe(0)
    expect(screenAdultCount(0)).toBe(0)
  })
  it('accepts whole numbers up to the maximum and nothing else', () => {
    expect(screenAdultCount(1)).toBe(1)
    expect(screenAdultCount(2)).toBe(2)
    for (const bad of [3, -1, 1.5, NaN, Infinity, '1', null, undefined, true]) expect(screenAdultCount(bad)).toBeNull()
  })
  it('birthday month is 1..12', () => {
    expect(screenBirthdayMonth(1)).toBe(1)
    expect(screenBirthdayMonth(12)).toBe(12)
    for (const bad of [0, 13, 1.5, '3', null]) expect(screenBirthdayMonth(bad)).toBeNull()
  })
})

describe('children', () => {
  it('yes needs 1..6, each with a first name', () => {
    expect(screenChildren([{ firstName: ' Ava ' }], 'yes')).toEqual([{ first_name: 'Ava' }])
    expect(screenChildren(Array.from({ length: 6 }, (_, i) => ({ firstName: `K${i}` })), 'yes')).toHaveLength(6)
    expect(screenChildren([], 'yes')).toBeNull()
    expect(screenChildren(Array.from({ length: 7 }, () => ({ firstName: 'K' })), 'yes')).toBeNull()
    expect(screenChildren([{ firstName: '' }], 'yes')).toBeNull()
    expect(screenChildren([{ firstName: 'x'.repeat(41) }], 'yes')).toBeNull()
    expect(screenChildren([{}], 'yes')).toBeNull()
    expect(screenChildren(['Ava'], 'yes')).toBeNull()
    expect(screenChildren('Ava', 'yes')).toBeNull()
  })
  it('no is always exactly zero, whatever was sent', () => {
    expect(screenChildren([{ firstName: 'Ava' }], 'no')).toEqual([])
    expect(screenChildren(undefined, 'no')).toEqual([])
  })
})

describe('the reminder box: one field, email or mobile', () => {
  it('nothing is none', () => {
    for (const v of [undefined, null, '', '   ']) expect(screenReminderContact(v)).toEqual({ kind: 'none' })
  })
  it('an @ means email, and must be plausible', () => {
    expect(screenReminderContact(' Pat@Example.com ')).toEqual({ kind: 'email', email: 'Pat@Example.com' })
    for (const v of ['pat@', '@example.com', 'a b@example.com', 'pat@example', 'pat@@example.com', '%@example.com']) expect(screenReminderContact(v)).toEqual({ kind: 'invalid' })
  })
  it('ten digits, or eleven starting with 1, is a +1 E.164 number that matches the table CHECK', () => {
    const check = /^\+1[2-9][0-9]{9}$/
    for (const v of ['631-400-8080', '(631) 400-8080', '6314008080', '1 631 400 8080', '+1 (631) 400-8080', '16314008080']) {
      const r = screenReminderContact(v)
      expect(r).toEqual({ kind: 'phone', phoneE164: '+16314008080' })
      expect((r as { phoneE164: string }).phoneE164).toMatch(check)
    }
  })
  it('anything else is invalid, never silently dropped', () => {
    for (const v of ['abc', '12345', '631-400-808', '011-400-8080', '063-400-8080', '631 400 8080 ext 5', '12345678901234', 5, {}]) {
      expect(screenReminderContact(v)).toEqual({ kind: 'invalid' })
    }
  })
})

describe('the POST body', () => {
  const yes = {
    status: 'yes',
    parentName: 'Pat Parent',
    children: [{ firstName: 'Ava' }],
    adultCount: 1,
    hasAllergy: false,
  }
  it('a complete yes passes', () => {
    expect(screenRsvpPost(yes)).toEqual({
      ok: true,
      value: { status: 'yes', parentName: 'Pat Parent', children: [{ first_name: 'Ava' }], adultCount: 1, hasAllergy: false, allergyNote: null, reminder: { kind: 'none' } },
    })
  })
  it('each missing piece is refused NAMING the field', () => {
    const field = (b: unknown) => (screenRsvpPost(b) as { ok: false; field: string }).field
    expect(field(null)).toBe('body')
    expect(field({ ...yes, status: 'maybe' })).toBe('status') // D11: no "Maybe"
    expect(field({ ...yes, parentName: ' ' })).toBe('parentName')
    expect(field({ ...yes, children: [] })).toBe('children')
    expect(field({ ...yes, adultCount: 3 })).toBe('adultCount')
    expect(field({ ...yes, adultCount: undefined })).toBe('adultCount')
    expect(field({ ...yes, hasAllergy: undefined })).toBe('hasAllergy')
    expect(field({ ...yes, hasAllergy: 'no' })).toBe('hasAllergy')
    expect(field({ ...yes, hasAllergy: true })).toBe('allergyNote')
    expect(field({ ...yes, hasAllergy: true, allergyNote: 'x'.repeat(301) })).toBe('allergyNote')
    expect(field({ ...yes, reminderContact: 'nope' })).toBe('reminderContact')
  })
  it('the allergy note is dropped when there is no allergy', () => {
    const r = screenRsvpPost({ ...yes, hasAllergy: false, allergyNote: 'peanuts' })
    expect(r.ok && r.value.allergyNote).toBeNull()
    const r2 = screenRsvpPost({ ...yes, hasAllergy: true, allergyNote: ' peanuts ' })
    expect(r2.ok && r2.value.allergyNote).toBe('peanuts')
  })
  it('a decline needs a parent name and ignores the rest (children and adults forced to zero)', () => {
    const r = screenRsvpPost({ status: 'no', parentName: 'Pat', children: [{ firstName: 'Ava' }], adultCount: 2, hasAllergy: true, allergyNote: 'x', reminderContact: 'pat@example.com' })
    expect(r).toEqual({ ok: true, value: { status: 'no', parentName: 'Pat', children: [], adultCount: 0, hasAllergy: null, allergyNote: null, reminder: { kind: 'none' } } })
    expect(screenRsvpPost({ status: 'no' }).ok).toBe(false)
  })
})

describe('the PATCH body', () => {
  const existing: ExistingRsvp = {
    status: 'yes',
    parent_name: 'Pat Parent',
    children: [{ first_name: 'Ava' }],
    adult_count: 1,
    has_allergy: true,
    allergy_note: 'peanuts',
    reminder_email: 'pat@example.com',
    reminder_phone_e164: null,
  }
  const ok = (b: unknown, e: ExistingRsvp = existing) => {
    const r = screenRsvpPatch(b, e)
    if (!r.ok) throw new Error(`expected ok, got ${r.field}: ${r.message}`)
    return r.value
  }
  const field = (b: unknown, e: ExistingRsvp = existing) => (screenRsvpPatch(b, e) as { ok: false; field: string }).field

  it('an empty patch, a non-object and one with only unknown keys are refused', () => {
    expect(field({})).toBe('body')
    expect(field(null)).toBe('body')
    expect(field({ id: 'x', evite_id: 'y', edit_nonce: 'z' })).toBe('body')
  })
  it('never carries an id or an evite id into the columns', () => {
    const v = ok({ parentName: 'New Name', id: 'other', evite_id: 'other', revision: 99, edit_nonce: 'x', status_code: 1 })
    expect(Object.keys(v.columns)).toEqual(['parent_name'])
  })
  it('status no zeroes the party itself (the CHECKs would refuse otherwise)', () => {
    const v = ok({ status: 'no' })
    expect(v.columns).toMatchObject({ status: 'no', children: [], adult_count: 0, has_allergy: null, allergy_note: null })
    expect(v.next).toEqual({ status: 'no', children: [], adult_count: 0, has_allergy: null })
  })
  it('flipping no to yes must bring children and the allergy answer', () => {
    const was: ExistingRsvp = { ...existing, status: 'no', children: [], adult_count: 0, has_allergy: null, allergy_note: null }
    expect(field({ status: 'yes' }, was)).toBe('children')
    expect(field({ status: 'yes', children: [{ firstName: 'Ava' }] }, was)).toBe('hasAllergy')
    const v = ok({ status: 'yes', children: [{ firstName: 'Ava' }], adultCount: 2, hasAllergy: false }, was)
    expect(v.next).toEqual({ status: 'yes', children: [{ first_name: 'Ava' }], adult_count: 2, has_allergy: false })
  })
  it('turning the allergy off drops the note; leaving it on without a note is refused', () => {
    expect(ok({ hasAllergy: false }).columns).toMatchObject({ has_allergy: false, allergy_note: null })
    expect(field({ allergyNote: '' })).toBe('allergyNote')
    expect(ok({ allergyNote: 'tree nuts' }).columns).toMatchObject({ allergy_note: 'tree nuts' })
  })
  it('the note to the birthday child: empty clears it, over 500 is refused', () => {
    expect(ok({ noteToHonoree: '  ' }).columns).toEqual({ note_to_honoree: null })
    expect(ok({ noteToHonoree: 'Happy birthday!' }).columns).toEqual({ note_to_honoree: 'Happy birthday!' })
    expect(field({ noteToHonoree: 'x'.repeat(501) })).toBe('noteToHonoree')
  })
  it('a new reminder email replaces a phone, clears an old opt-out and asks for the DB cap; the same address does not', () => {
    const fresh = ok({ reminderContact: 'new@example.com' })
    expect(fresh.columns).toMatchObject({ reminder_email: 'new@example.com', reminder_phone_e164: null, reminder_opt_out_at: null })
    expect(fresh.newReminderEmail).toBe('new@example.com')
    const same = ok({ reminderContact: 'PAT@example.com' })
    expect(same.newReminderEmail).toBeNull()
    expect(same.columns).not.toHaveProperty('reminder_opt_out_at')
    const phone = ok({ reminderContact: '631-400-8080' })
    expect(phone.columns).toMatchObject({ reminder_phone_e164: '+16314008080', reminder_email: null })
    expect(ok({ reminderContact: '' }).columns).toMatchObject({ reminder_email: null, reminder_phone_e164: null })
    expect(field({ reminderContact: 'garbage' })).toBe('reminderContact')
  })
  it('reminderOptOut is true or nothing', () => {
    expect(ok({ reminderOptOut: true }).reminderOptOut).toBe(true)
    expect(field({ reminderOptOut: false })).toBe('reminderOptOut')
  })
  it('club: opt-in needs optIn true, a plausible email, a month 1..12 or none, and a version', () => {
    const v = ok({ club: { optIn: true, email: ' pat@example.com ', birthdayMonth: 6, consentVersion: 'club-v1' } })
    expect(v.club).toEqual({ email: 'pat@example.com', birthdayMonth: 6, consentVersion: 'club-v1' })
    expect(ok({ club: { optIn: true, email: 'pat@example.com', consentVersion: 'club-v1' } }).club?.birthdayMonth).toBeNull()
    expect(field({ club: { optIn: false, email: 'pat@example.com', consentVersion: 'club-v1' } })).toBe('club')
    expect(field({ club: { optIn: true, email: 'nope', consentVersion: 'club-v1' } })).toBe('club.email')
    expect(field({ club: { optIn: true, email: 'pat@example.com', birthdayMonth: 13, consentVersion: 'club-v1' } })).toBe('club.birthdayMonth')
    expect(field({ club: { optIn: true, email: 'pat@example.com' } })).toBe('club.consentVersion')
    expect(field({ club: { optIn: true, email: 'pat@example.com', consentVersion: 'club-v1' }, clubOptOut: true })).toBe('club')
  })
})
