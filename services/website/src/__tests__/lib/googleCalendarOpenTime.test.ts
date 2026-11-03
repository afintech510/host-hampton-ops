import { openTimeFor, DEFAULT_HOURS } from '@/lib/googleCalendar'

describe('openTimeFor', () => {
  const kidsParty = { slug: 'kids-party', open_time: '11:00' }

  it('opens kids-party at 10:00 on Saturday', () => {
    expect(openTimeFor(kidsParty, 6)).toBe('10:00')
  })

  it('keeps kids-party at its configured 11:00 every other day', () => {
    for (const dow of [0, 1, 2, 3, 4, 5]) {
      expect(openTimeFor(kidsParty, dow)).toBe('11:00')
    }
  })

  it('leaves other booking types on their own open_time', () => {
    expect(openTimeFor({ slug: 'room-rental', open_time: '08:00' }, 6)).toBe('08:00')
  })

  it('falls back to business hours when open_time is unset', () => {
    expect(openTimeFor({ slug: 'pop-up', open_time: null }, 1)).toBe(DEFAULT_HOURS[1].open)
  })
})
