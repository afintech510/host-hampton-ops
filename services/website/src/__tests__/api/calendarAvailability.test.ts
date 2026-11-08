import { NextRequest } from 'next/server'
import { GET } from '@/app/api/availability/route'
import { readCalendarMonth } from '@/lib/googleCalendar'
import { getSupabase } from '@/lib/supabase'

jest.mock('@/lib/googleCalendar', () => ({
  ...jest.requireActual('@/lib/googleCalendar'), readCalendarMonth: jest.fn(),
}))
jest.mock('@/lib/supabase', () => ({ getSupabase: jest.fn() }))
const read = jest.mocked(readCalendarMonth)
const env = { ...process.env }
beforeEach(() => {
  jest.clearAllMocks()
  process.env.GOOGLE_CALENDAR_ID = 'test-calendar'
})
afterAll(() => { process.env = env })

it.each(['', '&bookingType=kids-party'])('offers no dates during a Google outage (%s)', async query => {
  read.mockResolvedValue({ events: [], failed: true })
  const res = await GET(new NextRequest(`http://localhost/api/availability?month=2026-12${query}`))
  expect(await res.json()).toEqual({ slots: {}, blockedDates: [], configured: false, calendarFailed: true })
  expect(getSupabase).not.toHaveBeenCalled()
})

it('also fails closed on a thrown network error or an unconfigured calendar', async () => {
  read.mockRejectedValueOnce(new Error('network down'))
  let res = await GET(new NextRequest('http://localhost/api/availability?month=2026-12'))
  expect(await res.json()).toMatchObject({ calendarFailed: true, slots: {} })
  delete process.env.GOOGLE_CALENDAR_ID
  read.mockResolvedValue({ events: [], failed: false })
  res = await GET(new NextRequest('http://localhost/api/availability?month=2026-12'))
  expect(await res.json()).toMatchObject({ calendarFailed: true, slots: {} })
})

it('an empty successfully read month still offers bookable slots', async () => {
  read.mockResolvedValue({ events: [], failed: false })
  const chain: any = {
    select: () => chain, eq: () => chain,
    single: async () => ({ data: { slug: 'kids-party', allowed_days: [0, 1, 2, 3, 4, 5, 6], min_advance_days: 0, open_time: '11:00', close_time: '16:00', slot_duration_min: 120, buffer_min: 0 } }),
  }
  jest.mocked(getSupabase).mockReturnValue({ from: () => chain } as any)
  const res = await GET(new NextRequest('http://localhost/api/availability?month=2099-12&bookingType=kids-party'))
  const data = await res.json()
  expect(data.calendarFailed).toBeUndefined()
  expect(data.configured).toBe(true)
  expect(data.slots['2099-12-01']).toContainEqual({ start: '11:00', end: '13:00', status: 'open' })
})
