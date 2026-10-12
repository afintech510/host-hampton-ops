import { isEventListable } from '@/lib/eventVisibility'

describe('isEventListable', () => {
  const today = '2026-10-11'

  it('hides an event whose date has passed (Bitchy Bingo Halloween, 2026-10-09)', () => {
    expect(isEventListable({ event_date: '2026-10-09' }, today)).toBe(false)
  })
  it('keeps an event happening today and later', () => {
    expect(isEventListable({ event_date: '2026-10-11' }, today)).toBe(true)
    expect(isEventListable({ event_date: '2026-10-26' }, today)).toBe(true)
  })
  it('keeps undated events', () => {
    expect(isEventListable({ event_date: null }, today)).toBe(true)
    expect(isEventListable({}, today)).toBe(true)
  })
  it('keeps session-based events; their sessions are filtered separately', () => {
    expect(isEventListable({ event_date: '2026-04-07', has_sessions: true }, today)).toBe(true)
  })
  it('does not judge a malformed date as past', () => {
    expect(isEventListable({ event_date: '2026' }, today)).toBe(true)
  })
  it('tolerates a timestamp-shaped value', () => {
    expect(isEventListable({ event_date: '2026-10-09T00:00:00+00:00' }, today)).toBe(false)
  })
})
