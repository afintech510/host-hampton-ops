import { cronDb } from '../../helpers/cronFixtures'
import { runEviteSendsTick } from '@/lib/evites/cronTick'
import { emptyClubRetryReport, retryClubLinks } from '@/lib/evites/club'

/**
 * Cron step 8b (spec §10): the Birthday Club retry runs inside the evite-sends tick, under the pages flag, and its
 * report is counts only. The retry's own selection and bounds are proved in club.test.ts; this proves the WIRING.
 */

jest.mock('@/lib/evites/club', () => {
  const actual = jest.requireActual('@/lib/evites/club')
  return { ...actual, retryClubLinks: jest.fn() }
})
jest.mock('@/lib/evites/render', () => ({ queueRender: jest.fn(), renderEvite: jest.fn() }))
jest.mock('@/lib/evites/mail')

const retry = retryClubLinks as jest.Mock
const ENV = ['EVITES_PAGES', 'EVITES_SENDS', 'EVITES_PILOT_REFS'] as const
const saved: Record<string, string | undefined> = {}
const NOW = new Date('2026-11-01T12:00:00Z')

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  delete process.env.EVITES_PILOT_REFS
  retry.mockReset()
  retry.mockResolvedValue({ ...emptyClubRetryReport(), candidates: 2, linked: 1, created: 1 })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.restoreAllMocks()
})

describe('cron step 8b: the club retry', () => {
  it('runs once a tick when pages are on, even with sends off, and reports counts only', async () => {
    process.env.EVITES_PAGES = 'on'
    process.env.EVITES_SENDS = 'off'
    const db = cronDb()
    const rep = await runEviteSendsTick(db.supabase, { now: NOW })
    expect(retry).toHaveBeenCalledTimes(1)
    expect(retry.mock.calls[0][1]).toEqual({ now: NOW })
    expect(rep.clubRetry).toEqual({ ...emptyClubRetryReport(), candidates: 2, linked: 1, created: 1 })
    expect(JSON.stringify(rep.clubRetry)).not.toMatch(/@|mia-glow|guest/i)
  })

  it('does not run when both flags are off (the idle tick reads nothing)', async () => {
    process.env.EVITES_PAGES = 'off'
    process.env.EVITES_SENDS = 'off'
    const rep = await runEviteSendsTick(cronDb().supabase, { now: NOW })
    expect(rep.idle).toBe(true)
    expect(retry).not.toHaveBeenCalled()
    expect(rep.clubRetry).toEqual(emptyClubRetryReport())
  })

  it('a retry that cannot read the table is an error on the report, not silence', async () => {
    process.env.EVITES_PAGES = 'on'
    process.env.EVITES_SENDS = 'off'
    retry.mockResolvedValue({ ...emptyClubRetryReport(), readFailed: true })
    const rep = await runEviteSendsTick(cronDb().supabase, { now: NOW })
    expect(rep.failedSteps).toContain('clubRetry')
    expect(rep.ok).toBe(false)
  })

  it('a retry that throws cannot stop the rest of the tick', async () => {
    process.env.EVITES_PAGES = 'on'
    process.env.EVITES_SENDS = 'off'
    retry.mockRejectedValue(new Error('boom'))
    const rep = await runEviteSendsTick(cronDb().supabase, { now: NOW })
    expect(rep.failedSteps).toContain('clubRetry')
    expect(rep.retention).not.toBeNull()
  })
})
