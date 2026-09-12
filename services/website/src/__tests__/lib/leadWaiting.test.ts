/**
 * Tests for lib/leadWaiting.ts — the anti-silence signal in the Inbox queue.
 *
 * Plan §18's lead was visible in that list the whole time it was being missed,
 * because the list rendered an absolute timestamp and sorted newest-first. Two
 * properties fix that and both are tested here: elapsed time is stated in
 * words, and the queue orders the most neglected row to the top.
 *
 * The third property is the one most likely to be got wrong by a later change:
 * an UNREADABLE clock must not read as fresh, and must not float to the top of
 * a "most neglected" list either.
 */

import { byLongestWaiting, describeElapsed, waitingInfo } from '@/lib/leadWaiting'

const NOW = new Date('2026-09-11T12:00:00.000Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

describe('describeElapsed', () => {
  it('reads as a human would say it', () => {
    expect(describeElapsed(30_000)).toBe('just now')
    expect(describeElapsed(1 * MINUTE)).toBe('1 minute')
    expect(describeElapsed(20 * MINUTE)).toBe('20 minutes')
    expect(describeElapsed(1 * HOUR)).toBe('1 hour')
    expect(describeElapsed(6 * HOUR)).toBe('6 hours')
    expect(describeElapsed(1 * DAY)).toBe('1 day')
    expect(describeElapsed(4 * DAY)).toBe('4 days')
  })
})

describe('waitingInfo severity', () => {
  it('is fresh inside the 2-hour nudge window', () => {
    // Under 2h the system has not yet broken its own promise, so colouring it
    // would just make the badge noise.
    expect(waitingInfo({ sent_for_review_at: ago(30 * MINUTE), created_at: ago(DAY) }, NOW)!.severity).toBe('fresh')
  })

  it('turns amber once the nudge has fired', () => {
    expect(waitingInfo({ sent_for_review_at: ago(3 * HOUR), created_at: null }, NOW)!.severity).toBe('waiting')
  })

  it('turns red past a day, when nothing automated will chase it again', () => {
    // The nudge fires once. Past this point only a human ever picks it up.
    expect(waitingInfo({ sent_for_review_at: ago(DAY + MINUTE), created_at: null }, NOW)!.severity).toBe('overdue')
    expect(waitingInfo({ sent_for_review_at: ago(4 * DAY), created_at: null }, NOW)!.label).toBe('4 days')
  })
})

describe('waitingInfo clock choice', () => {
  it('prefers sent_for_review_at, so a re-drafted draft is not aged unfairly', () => {
    // A re-draft or an edit resets that column. The ball only just re-entered a
    // human's court, whatever the original created_at says.
    const info = waitingInfo({ sent_for_review_at: ago(10 * MINUTE), created_at: ago(9 * DAY) }, NOW)!
    expect(info.severity).toBe('fresh')
    expect(info.label).toBe('10 minutes')
  })

  it('falls back to created_at for a HELD draft, which never got one', () => {
    // `status='drafted'` drafts are exactly the ones that used to notify
    // nobody, so they must not read as ageless.
    const info = waitingInfo({ sent_for_review_at: null, created_at: ago(3 * DAY) }, NOW)!
    expect(info.severity).toBe('overdue')
    expect(info.label).toBe('3 days')
  })

  it('returns null for a missing or unparseable clock rather than claiming freshness', () => {
    expect(waitingInfo({ sent_for_review_at: null, created_at: null }, NOW)).toBeNull()
    expect(waitingInfo({ created_at: 'not a date' }, NOW)).toBeNull()
  })

  it('treats a future timestamp as zero, not as negative age', () => {
    const info = waitingInfo({ created_at: new Date(NOW.getTime() + HOUR).toISOString() }, NOW)!
    expect(info.ms).toBe(0)
    expect(info.severity).toBe('fresh')
  })
})

describe('byLongestWaiting', () => {
  it('puts the most neglected draft at the top', () => {
    const rows = [
      { id: 'fresh', sent_for_review_at: ago(5 * MINUTE), created_at: ago(5 * MINUTE) },
      { id: 'old', sent_for_review_at: ago(4 * DAY), created_at: ago(4 * DAY) },
      { id: 'mid', sent_for_review_at: ago(6 * HOUR), created_at: ago(6 * HOUR) },
    ]
    expect(rows.slice().sort((a, b) => byLongestWaiting(a, b, NOW)).map(r => r.id)).toEqual(['old', 'mid', 'fresh'])
  })

  it('sorts an unreadable clock LAST, so it cannot displace a real one', () => {
    // An unknown at the top of a list that means "these are the most neglected"
    // would push a genuinely neglected lead off the top.
    const rows = [
      { id: 'unknown', sent_for_review_at: null, created_at: null },
      { id: 'old', sent_for_review_at: ago(4 * DAY), created_at: ago(4 * DAY) },
    ]
    expect(rows.slice().sort((a, b) => byLongestWaiting(a, b, NOW)).map(r => r.id)).toEqual(['old', 'unknown'])
  })
})
