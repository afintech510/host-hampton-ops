import { formatGuestPhone, guestPhoneE164, matchGuestsToRsvps, parseGuestList, GUEST_LIST_MAX } from '@/lib/evites/guestList'

const names = (t: string) => parseGuestList(t).guests.map((g) => g.name)

describe('guestPhoneE164', () => {
  it.each([
    ['631-555-1234', '+16315551234'],
    ['(631) 555-1234', '+16315551234'],
    ['6315551234', '+16315551234'],
    ['+1 631 555 1234', '+16315551234'],
    ['1-631-555-1234', '+16315551234'],
    ['631.555.1234', '+16315551234'],
  ])('%s -> %s', (raw, out) => expect(guestPhoneE164(raw)).toBe(out))

  it.each(['555-1234', '163155512', '0315551234', '631-055-1234', '26315551234', '', '+44 20 7946 0958'])('refuses %s', (raw) => {
    expect(guestPhoneE164(raw)).toBeNull()
  })

  it('formats for display', () => {
    expect(formatGuestPhone('+16315551234')).toBe('(631) 555-1234')
    expect(formatGuestPhone(null)).toBe('')
  })
})

describe('parseGuestList', () => {
  it('reads name, phone lines in the usual shapes', () => {
    const r = parseGuestList('Ann Lee, 631-555-1234\nBob Diaz,6315551299\nCara\tPark\t(631) 555-0100\nDee Dee')
    // a tab line splits on tabs: "Cara", "Park", phone -> the first lettered cell is the name
    expect(r.guests).toEqual([
      { name: 'Ann Lee', phone_e164: '+16315551234' },
      { name: 'Bob Diaz', phone_e164: '+16315551299' },
      { name: 'Cara', phone_e164: '+16315550100' },
      { name: 'Dee Dee', phone_e164: null },
    ])
    expect(r.skipped).toEqual([])
  })

  it('name TAB phone', () => {
    expect(parseGuestList('Ann Lee\t631-555-1234').guests).toEqual([{ name: 'Ann Lee', phone_e164: '+16315551234' }])
  })

  it('ignores a header row, and a CSV file with CRLF and a BOM', () => {
    const csv = '﻿Name,Phone\r\n"Lee, Ann",631-555-1234\r\n"Bob Diaz",\r\n'
    const r = parseGuestList(csv)
    expect(r.guests.map((g) => g.name)).toEqual(['Lee, Ann', 'Bob Diaz'])
    expect(r.guests[0].phone_e164).toBe('+16315551234')
  })

  it('ignores header variants', () => {
    expect(names('Guest name, Mobile\nAnn')).toEqual(['Ann'])
    expect(names('first name;last name;phone\nAnn')).toEqual(['Ann'])
  })

  it('does not treat a first-line name as a header', () => {
    expect(names('Name Smith\nAnn')).toEqual(['Name Smith', 'Ann'])
  })

  it('strips quotes and folds whitespace', () => {
    expect(names('"  Ann    Lee "\n“Bob”')).toEqual(['Ann Lee', 'Bob'])
  })

  it('one line with no digits is a list of names', () => {
    expect(names('Ann, Bob; Cara Diaz,  Dee')).toEqual(['Ann', 'Bob', 'Cara Diaz', 'Dee'])
  })

  it('one line WITH a phone is a single guest', () => {
    expect(parseGuestList('Ann Lee, 631-555-1234').guests).toEqual([{ name: 'Ann Lee', phone_e164: '+16315551234' }])
  })

  it('a household stays one guest', () => {
    expect(names('Tom & Jen\nBob and Carol Diaz')).toEqual(['Tom & Jen', 'Bob and Carol Diaz'])
    expect(names('Tom & Jen')).toEqual(['Tom & Jen'])
  })

  it('a trailing phone with nothing to split on is found', () => {
    expect(parseGuestList('Ann Lee 631 555 1234\nBob').guests).toEqual([
      { name: 'Ann Lee', phone_e164: '+16315551234' },
      { name: 'Bob', phone_e164: null },
    ])
  })

  it('a bad phone keeps the guest, drops the number, and says so WITHOUT the number', () => {
    const r = parseGuestList('Ann Lee, 555-1234\nBob, 631-555-1234')
    expect(r.guests).toEqual([
      { name: 'Ann Lee', phone_e164: null },
      { name: 'Bob', phone_e164: '+16315551234' },
    ])
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0]).toContain('Ann Lee')
    expect(r.skipped[0]).not.toMatch(/\d/)
  })

  it('a line with only a phone number is skipped', () => {
    const r = parseGuestList('631-555-1234\nAnn')
    expect(r.guests.map((g) => g.name)).toEqual(['Ann'])
    expect(r.skipped).toHaveLength(1)
  })

  it('drops duplicates (same name and phone, any case) but keeps the same name with a different phone', () => {
    const r = parseGuestList('Ann Lee, 631-555-1234\nann lee,(631) 555-1234\nAnn Lee, 631-555-9999\nAnn Lee')
    expect(r.guests).toHaveLength(3)
  })

  it('removes control characters and caps a name at 120', () => {
    const r = parseGuestList(`An\u0000n‮ ${'x'.repeat(200)}`)
    expect(r.guests[0].name).not.toMatch(/[\u0000‮]/)
    expect(r.guests[0].name.length).toBeLessThanOrEqual(120)
  })

  it(`caps the list at ${GUEST_LIST_MAX}; the excess is reported`, () => {
    const text = Array.from({ length: 520 }, (_, i) => `Guest ${String.fromCharCode(65 + (i % 26))}${i}`).join('\n')
    const r = parseGuestList(text)
    expect(r.guests).toHaveLength(GUEST_LIST_MAX)
    expect(r.skipped.join(' ')).toContain('20 more guests were left out')
  })

  it('never throws on junk', () => {
    for (const v of [undefined, null, 5, {}, [], '', '   \n\n', ',,,', '\t', '""']) expect(parseGuestList(v).guests).toEqual([])
  })
})

describe('matchGuestsToRsvps (matched by name)', () => {
  const rs = [
    { status: 'yes' as const, parent_name: 'Ann Lee', children: [{ first_name: 'Ann' }, { first_name: 'Joe' }] },
    { status: 'no' as const, parent_name: 'Bob Diaz', children: [] },
    { status: 'yes' as const, parent_name: 'Cara Park', children: ['Cara', 'Dev'] },
  ]
  const m = (...n: string[]) => matchGuestsToRsvps(n.map((name) => ({ name })), rs)

  it('full name equality, case and accent insensitive', () => {
    expect(m('ann lee', 'BOB DIAZ', 'Zoë Q')).toEqual(['yes', 'no', null])
    expect(m('Ánn Lee')).toEqual(['yes'])
  })
  it('a one-word name matches a given first name or the first word of the RSVP name', () => {
    expect(m('Joe', 'Bob', 'Dev', 'Cara')).toEqual(['yes', 'no', 'yes', 'yes'])
  })
  it('a two-word name does not match on the first name alone', () => {
    expect(m('Joe Smith', 'Bob Jones')).toEqual([null, null])
  })
  it('a household matches when one part does', () => {
    expect(m('Tom & Joe', 'Tom and Jen')).toEqual(['yes', null])
  })
  it('yes wins over no when both match', () => {
    const r = matchGuestsToRsvps([{ name: 'Sam Roe' }], [
      { status: 'no', parent_name: 'Sam Roe', children: [] },
      { status: 'yes', parent_name: 'Sam Roe', children: ['Sam Roe'] },
    ])
    expect(r).toEqual(['yes'])
  })
  it('no RSVPs -> nobody answered', () => {
    expect(matchGuestsToRsvps([{ name: 'A' }], [])).toEqual([null])
  })
})
