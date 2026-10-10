import { buildIcs, escapeIcsText, foldIcsLine, googleCalendarUrl, icsUtc, type IcsFacts } from '@/lib/evites/ics'
import { partyWindow } from '@/lib/evites/partyWindow'

/** The calendar entry (spec §8). */

const URL_ = 'https://www.hosthampton.com/i/mia-glow-7kq2'
const STAMP = new Date('2026-11-01T15:00:00Z')

function factsFor(date: string, time = '14:00', over: Partial<IcsFacts> = {}): IcsFacts {
  const window = partyWindow({ party_date: date, party_time: time, party_type: 'in_studio_theme' })
  if (!window) throw new Error('fixture has no window')
  return {
    window,
    title: "Mia's Glow Party",
    calendarLocation: 'Host Hampton, 295 Montauk Hwy, Speonk, NY 11972',
    hostContactLine: 'Any questions? Ask Allie · 631-998-9325',
    ...over,
  }
}

const NOV = factsFor('2026-11-14') // Saturday, EST (UTC-5): 2 PM ET = 19:00Z
const JUN = factsFor('2026-06-13') // Saturday, EDT (UTC-4): 2 PM ET = 18:00Z

describe('UTC conversion of a 2 PM Eastern Saturday', () => {
  it('November (standard time) is 19:00Z to 21:00Z', () => {
    expect(icsUtc(NOV.window!.startUtc)).toBe('20261114T190000Z')
    expect(icsUtc(NOV.window!.endUtc)).toBe('20261114T210000Z')
  })
  it('June (daylight time) is 18:00Z to 20:00Z', () => {
    expect(icsUtc(JUN.window!.startUtc)).toBe('20260613T180000Z')
    expect(icsUtc(JUN.window!.endUtc)).toBe('20260613T200000Z')
  })
})

describe('golden PUBLISH', () => {
  it('November', () => {
    const ics = buildIcs(NOV, { id: 'ev-uuid-1', cal_version: 2 }, URL_, { method: 'PUBLISH', now: STAMP })
    expect(ics).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Host Hampton//EVITE//EN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        'UID:evite-ev-uuid-1@hosthampton.com',
        'SEQUENCE:2',
        'DTSTAMP:20261101T150000Z',
        'DTSTART:20261114T190000Z',
        'DTEND:20261114T210000Z',
        "SUMMARY:Mia's Glow Party \u{1F389}",
        'LOCATION:Host Hampton\\, 295 Montauk Hwy\\, Speonk\\, NY 11972',
        'URL:https://www.hosthampton.com/i/mia-glow-7kq2',
        'DESCRIPTION:Any questions? Ask Allie · 631-998-9325\\nhttps://www.hosthampt',
        ' on.com/i/mia-glow-7kq2\\nPlans changed? Update your RSVP: https://www.hosth',
        ' ampton.com/i/mia-glow-7kq2',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Reminder',
        'TRIGGER:-P1D',
        'END:VALARM',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Reminder',
        'TRIGGER:-PT2H',
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    )
  })

  it('June changes only the times', () => {
    const nov = buildIcs(NOV, { id: 'ev-uuid-1', cal_version: 0 }, URL_, { method: 'PUBLISH', now: STAMP })
    const jun = buildIcs(JUN, { id: 'ev-uuid-1', cal_version: 0 }, URL_, { method: 'PUBLISH', now: STAMP })
    expect(jun).toContain('DTSTART:20260613T180000Z\r\n')
    expect(jun).toContain('DTEND:20260613T200000Z\r\n')
    expect(jun.replace(/20260613T(18|20)0000Z/g, 'T').replace('20260613', '')).toBeTruthy()
    expect(nov).not.toContain('20260613')
  })

  it('uses CRLF line ends only, ends with one, and never has a bare LF', () => {
    const ics = buildIcs(NOV, { id: 'e', cal_version: 0 }, URL_, { method: 'PUBLISH', now: STAMP })
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
  })

  it('omits LOCATION when there is none, and uses an edit link in the description when given', () => {
    const ics = buildIcs({ ...NOV, calendarLocation: null }, { id: 'e', cal_version: 0 }, URL_, { method: 'PUBLISH', now: STAMP, editUrl: 'https://www.hosthampton.com/i/mia-glow-7kq2/rsvp/T' })
    expect(ics).not.toContain('LOCATION')
    const unfolded = ics.replace(/\r\n /g, '')
    expect(unfolded).toContain('Plans changed? Update your RSVP: https://www.hosthampton.com/i/mia-glow-7kq2/rsvp/T')
  })

  it('a no-name party reads "<Theme> Birthday Party", straight from the facts title', () => {
    const ics = buildIcs({ ...NOV, title: 'Glow Birthday Party' }, { id: 'e', cal_version: 0 }, URL_, { method: 'PUBLISH', now: STAMP })
    expect(ics).toContain('SUMMARY:Glow Birthday Party \u{1F389}\r\n')
  })

  it('throws, rather than print a bogus time, when the party has no window', () => {
    expect(() => buildIcs({ ...NOV, window: null }, { id: 'e', cal_version: 0 }, URL_, { method: 'PUBLISH' })).toThrow()
    expect(() => googleCalendarUrl({ ...NOV, window: null }, URL_)).toThrow()
  })
})

describe('two VALARMs, each with a DESCRIPTION', () => {
  it('has exactly two display alarms, a day and two hours before', () => {
    const ics = buildIcs(NOV, { id: 'e', cal_version: 0 }, URL_, { method: 'PUBLISH', now: STAMP })
    const alarms = ics.split('BEGIN:VALARM\r\n').slice(1).map((a) => a.split('END:VALARM')[0])
    expect(alarms).toHaveLength(2)
    for (const a of alarms) {
      expect(a).toContain('ACTION:DISPLAY\r\n')
      expect(a).toContain('DESCRIPTION:Reminder\r\n')
    }
    expect(alarms[0]).toContain('TRIGGER:-P1D')
    expect(alarms[1]).toContain('TRIGGER:-PT2H')
  })
})

describe('CANCEL', () => {
  it('is METHOD:CANCEL, STATUS:CANCELLED, and one SEQUENCE ahead of the PUBLISH it replaces', () => {
    const pub = buildIcs(NOV, { id: 'ev-uuid-1', cal_version: 3 }, URL_, { method: 'PUBLISH', now: STAMP })
    const can = buildIcs(NOV, { id: 'ev-uuid-1', cal_version: 3 }, URL_, { method: 'CANCEL', now: STAMP })
    expect(pub).toContain('METHOD:PUBLISH\r\n')
    expect(pub).toContain('SEQUENCE:3\r\n')
    expect(pub).not.toContain('STATUS:')
    expect(can).toContain('METHOD:CANCEL\r\n')
    expect(can).toContain('SEQUENCE:4\r\n')
    expect(can).toContain('STATUS:CANCELLED\r\n')
    // the same event: the UID is what ties them together
    expect(can).toContain('UID:evite-ev-uuid-1@hosthampton.com\r\n')
    expect(can).toContain('DTSTART:20261114T190000Z\r\n')
  })

  it('links no page (a cancelled invitation is a dead page) and carries no alarm', () => {
    const can = buildIcs(NOV, { id: 'ev-uuid-1', cal_version: 3 }, URL_, { method: 'CANCEL', now: STAMP, editUrl: 'https://www.hosthampton.com/i/mia-glow-7kq2/rsvp/TOKEN' })
    const unfolded = can.replace(/\r\n /g, '')
    expect(unfolded).not.toMatch(/^URL:/m)
    expect(unfolded).not.toContain(URL_)
    expect(unfolded).not.toContain('Plans changed')
    expect(unfolded).not.toContain('TOKEN')
    expect(unfolded).not.toContain('VALARM')
    expect(unfolded).not.toContain('TRIGGER')
    // the properties that make it a cancellation survive
    expect(unfolded).toContain('UID:evite-ev-uuid-1@hosthampton.com\r\n')
    expect(unfolded).toContain('SEQUENCE:4\r\n')
    expect(unfolded).toContain('STATUS:CANCELLED\r\n')
  })

  it('a PUBLISH still carries the URL, the edit line and both alarms (the CANCEL change is not a PUBLISH change)', () => {
    const pub = buildIcs(NOV, { id: 'ev-uuid-1', cal_version: 3 }, URL_, { method: 'PUBLISH', now: STAMP })
    const unfolded = pub.replace(/\r\n /g, '')
    expect(unfolded).toContain(`\r\nURL:${URL_}\r\n`)
    expect(unfolded).toContain('Plans changed')
    expect(pub.match(/BEGIN:VALARM/g)).toHaveLength(2)
  })
})

describe('escaping (RFC 5545 §3.3.11)', () => {
  it('escapes backslash, semicolon, comma and newlines, backslash first', () => {
    expect(escapeIcsText('a,b;c\\d')).toBe('a\\,b\\;c\\\\d')
    expect(escapeIcsText('one\ntwo\r\nthree\rfour')).toBe('one\\ntwo\\nthree\\nfour')
    expect(escapeIcsText('\\n')).toBe('\\\\n') // a literal backslash-n is not a newline
  })
  it('a hostile title cannot add a property or end the event', () => {
    const ics = buildIcs({ ...NOV, title: 'Mia\r\nEND:VEVENT\r\nBEGIN:VEVENT; X,Y\\' }, { id: 'e', cal_version: 0 }, URL_, { method: 'PUBLISH', now: STAMP })
    // As PROPERTY LINES: the hostile text survives only inside the escaped SUMMARY value.
    const lines = ics.split('\r\n')
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1)
    expect(lines.filter((l) => l === 'END:VEVENT')).toHaveLength(1)
    const unfolded = ics.replace(/\r\n /g, '')
    expect(unfolded).toContain('SUMMARY:Mia\\nEND:VEVENT\\nBEGIN:VEVENT\\; X\\,Y\\\\ \u{1F389}\r\n')
  })
})

describe('folding at 75 octets', () => {
  const octets = (s: string) => Buffer.byteLength(s, 'utf8')

  it('leaves a short line alone', () => {
    expect(foldIcsLine('SUMMARY:short')).toBe('SUMMARY:short')
    expect(foldIcsLine('x'.repeat(75))).toBe('x'.repeat(75))
  })
  it('folds a long ASCII line so no physical line exceeds 75 octets, and unfolding restores it', () => {
    const line = 'DESCRIPTION:' + 'abcdefghij'.repeat(30)
    const folded = foldIcsLine(line)
    const parts = folded.split('\r\n')
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) expect(octets(p)).toBeLessThanOrEqual(75)
    for (const p of parts.slice(1)) expect(p.startsWith(' ')).toBe(true)
    expect(folded.replace(/\r\n /g, '')).toBe(line)
  })
  it('never splits a multi-byte emoji: the whole sequence moves to the next line', () => {
    // 73 ASCII octets + a 4-octet emoji would be 77: the emoji must start line 2.
    const line = 'S'.repeat(73) + '\u{1F389}' + 'tail'
    const folded = foldIcsLine(line)
    const parts = folded.split('\r\n')
    expect(parts[0]).toBe('S'.repeat(73))
    expect(parts[1]).toBe(' \u{1F389}tail')
    for (const p of parts) expect(octets(p)).toBeLessThanOrEqual(75)
    expect(folded).not.toContain('�')
    expect(folded.replace(/\r\n /g, '')).toBe(line)
  })
  it('a run of emoji folds cleanly at every boundary', () => {
    const line = 'SUMMARY:' + '\u{1F389}'.repeat(60)
    const folded = foldIcsLine(line)
    for (const p of folded.split('\r\n')) expect(octets(p)).toBeLessThanOrEqual(75)
    expect(Buffer.from(folded.replace(/\r\n /g, ''), 'utf8').toString('utf8')).toBe(line)
  })
  it('the emoji in a real SUMMARY survives folding in a long title', () => {
    const ics = buildIcs({ ...NOV, title: "Alexandria-Montgomery's Extremely Long Glow Birthday Party Celebration" }, { id: 'e', cal_version: 0 }, URL_, { method: 'PUBLISH', now: STAMP })
    for (const line of ics.split('\r\n')) expect(octets(line)).toBeLessThanOrEqual(75)
    expect(ics.replace(/\r\n /g, '')).toContain('\u{1F389}\r\n')
  })
})

describe('googleCalendarUrl', () => {
  it('is the prefilled template form with UTC dates and an Eastern ctz', () => {
    const u = googleCalendarUrl(NOV, URL_)
    expect(u.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE&')).toBe(true)
    expect(u).toContain('&dates=20261114T190000Z/20261114T210000Z&')
    expect(u).toContain('&ctz=America/New_York')
    const q = new URL(u).searchParams
    expect(q.get('text')).toBe("Mia's Glow Party \u{1F389}")
    expect(q.get('location')).toBe('Host Hampton, 295 Montauk Hwy, Speonk, NY 11972')
    expect(q.get('details')).toContain(URL_)
    expect(q.get('details')).toContain('Plans changed? Update your RSVP')
  })
  it('June uses daylight time', () => {
    expect(googleCalendarUrl(JUN, URL_)).toContain('dates=20260613T180000Z/20260613T200000Z')
  })
  it('omits location when there is none', () => {
    expect(googleCalendarUrl({ ...NOV, calendarLocation: null }, URL_)).not.toContain('location=')
  })
  it('encodes values so a hostile title cannot add a parameter', () => {
    const u = googleCalendarUrl({ ...NOV, title: 'A&dates=evil&x=1' }, URL_)
    expect(new URL(u).searchParams.get('dates')).toBe('20261114T190000Z/20261114T210000Z')
    expect(new URL(u).searchParams.get('x')).toBeNull()
  })
})
