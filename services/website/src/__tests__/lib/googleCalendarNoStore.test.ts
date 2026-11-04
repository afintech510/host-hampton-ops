/**
 * Every Google Calendar READ must bypass Next's data cache. Measured 2026-11-04:
 * without `cache: 'no-store'` the container served one Calendar list for 20+
 * minutes after it changed, so availability and the calendar sync both read a
 * calendar that no longer existed — and the sync would have re-created events
 * it had just created.
 */
import { getCalendarEvents, listCalendarEvents, getCalendarEvent } from '@/lib/googleCalendar'

const calls: { url: string; init: RequestInit | undefined }[] = []

beforeEach(() => {
  calls.length = 0
  process.env.GOOGLE_CLIENT_ID = 'id'
  process.env.GOOGLE_CLIENT_SECRET = 'secret'
  process.env.GOOGLE_REFRESH_TOKEN = 'refresh'
  process.env.GOOGLE_CALENDAR_ID = 'cal@example.com'
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const body = String(url).includes('oauth2') ? { access_token: 't' } : { items: [] }
    return { ok: true, status: 200, json: async () => body } as Response
  }) as unknown as typeof fetch
})

const calendarReads = () => calls.filter(c => c.url.includes('googleapis.com/calendar') && !c.init?.method)

it.each([
  ['getCalendarEvents', () => getCalendarEvents('2026-11')],
  ['listCalendarEvents', () => listCalendarEvents({ timeMin: '2026-11-04T05:00:00.000Z', q: 'HH-PTY-X' })],
  ['getCalendarEvent', () => getCalendarEvent('ev1')],
])('%s reads with cache: no-store', async (_name, run) => {
  await run()
  expect(calendarReads()).toHaveLength(1)
  for (const c of calendarReads()) expect(c.init?.cache).toBe('no-store')
  // The access token too: a cached token expires after an hour and every call
  // then answers 401 (measured 2026-11-04, 14:23 UTC onwards).
  const token = calls.filter(c => c.url.includes('oauth2.googleapis.com/token'))
  expect(token).toHaveLength(1)
  expect(token[0].init?.cache).toBe('no-store')
})

it('reads a month as Eastern midnight to Eastern midnight', async () => {
  await getCalendarEvents('2026-11')
  const u = new URL(calendarReads()[0].url)
  expect(u.searchParams.get('timeMin')).toBe('2026-11-01T04:00:00.000Z') // EDT
  expect(u.searchParams.get('timeMax')).toBe('2026-12-01T05:00:00.000Z') // EST
})
