/**
 * GET /api/cron/evite-sends: the door (spec §9.3). The scheduler itself is exercised in
 * `lib/evites/cronTick.test.ts`; this file is the credential check, the status codes and the shape of the answer.
 */

import { NextRequest } from 'next/server'
import { cronDb } from '../helpers/cronFixtures'
import { guestRsvp, sendRow, uuid, type SendDb } from '../helpers/sendFixtures'

jest.mock('@/lib/evites/mail')
jest.mock('@/lib/evites/render', () => ({ queueRender: jest.fn(), renderEvite: jest.fn(), renderViaQueue: jest.fn() }))
let db: SendDb
jest.mock('@/lib/supabase', () => ({ getSupabase: () => db.supabase }))

import { sendEviteEmail } from '@/lib/evites/mail'
import { GET } from '@/app/api/cron/evite-sends/route'

const ENV = ['CRON_SECRET', 'EVITES_PAGES', 'EVITES_SENDS', 'EVITES_PILOT_REFS'] as const
const saved: Record<string, string | undefined> = {}
const mailMock = sendEviteEmail as jest.Mock

const req = (headers: Record<string, string> = {}, qs = '') => new NextRequest(`http://localhost/api/cron/evite-sends${qs}`, { headers })

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  process.env.CRON_SECRET = 'test-cron-secret'
  process.env.EVITES_PAGES = 'on'
  process.env.EVITES_SENDS = 'on'
  mailMock.mockReset()
  mailMock.mockResolvedValue({ kind: 'sent', providerId: 're_ok' })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  db = cronDb({ rsvps: [guestRsvp({ id: uuid(), reminder_email: 'someone@example.com' })] })
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.restoreAllMocks()
})

describe('authorization', () => {
  it('401 without a credential, and it does not touch the database', async () => {
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(db.selects).toHaveLength(0)
    expect(mailMock).not.toHaveBeenCalled()
  })

  it('401 with a wrong secret, in the header or in the query string', async () => {
    expect((await GET(req({ 'x-cron-secret': 'nope' }))).status).toBe(401)
    expect((await GET(req({}, '?secret=nope'))).status).toBe(401)
    expect(db.selects).toHaveLength(0)
  })

  it('401 for everybody while CRON_SECRET is unset (fail closed), even with an empty credential', async () => {
    delete process.env.CRON_SECRET
    expect((await GET(req({ 'x-cron-secret': '' }))).status).toBe(401)
    expect((await GET(req({}, '?secret='))).status).toBe(401)
    expect((await GET(req({ 'x-cron-secret': 'undefined' }))).status).toBe(401)
  })

  it('accepts the header and the query string', async () => {
    expect((await GET(req({ 'x-cron-secret': 'test-cron-secret' }))).status).toBe(200)
    expect((await GET(req({}, '?secret=test-cron-secret'))).status).toBe(200)
  })

  it('is a GET-only, force-dynamic route that uses the one credential check', () => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const src = fs.readFileSync(path.join(__dirname, '../../app/api/cron/evite-sends/route.ts'), 'utf8')
    expect(src).toMatch(/export const dynamic = 'force-dynamic'/)
    expect(src).toMatch(/export async function GET/)
    expect(src).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/)
    expect(src).toMatch(/isCronAuthorized\(req\)/)
    expect(src).not.toMatch(/process\.env\.CRON_SECRET/)
    // The credential check is the first statement of the handler.
    expect(src.indexOf('isCronAuthorized(req)')).toBeLessThan(src.indexOf('getSupabase()'))
  })
})

describe('the answer', () => {
  it('is counts only: no address, slug, booking ref or name, even when a send went out', async () => {
    db = cronDb({
      rsvps: [guestRsvp({ id: uuid(), reminder_email: 'someone@example.com', created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z' })],
      sends: [sendRow({ send_type: 'invite_ready', rsvp_id: null, ref_version: 0, status: 'sent' })],
      evite: { went_live_at: '2026-11-01T00:00:00Z' },
    })
    // Inside the week-before window so that a real send happens.
    jest.useFakeTimers({ now: new Date('2026-11-07T15:00:00Z'), doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance'] })
    try {
      const res = await GET(req({ 'x-cron-secret': 'test-cron-secret' }))
      expect(res.status).toBe(200)
      const text = JSON.stringify(await res.json())
      expect(mailMock).toHaveBeenCalled()
      expect(text).not.toMatch(/@/)
      expect(text).not.toContain('mia-glow')
      expect(text).not.toContain('HH-TEST-1')
      expect(text).not.toContain('Mia')
      expect(text).not.toContain('Pat')
      expect(text).toContain('"weekBefore"')
    } finally {
      jest.useRealTimers()
    }
  })

  it('both flags off: 200, idle, and nothing was read', async () => {
    process.env.EVITES_PAGES = 'off'
    process.env.EVITES_SENDS = 'off'
    const res = await GET(req({ 'x-cron-secret': 'test-cron-secret' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, idle: true })
    expect(db.selects).toHaveLength(0)
  })

  it('503 when the scan itself cannot be read, so a scheduler shows red', async () => {
    db.errors.push({ table: 'evites', op: 'select', times: 1000 })
    const res = await GET(req({ 'x-cron-secret': 'test-cron-secret' }))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ ok: false })
    expect(mailMock).not.toHaveBeenCalled()
  })

  it('a failure in one step is a 200 with ok:false and the step named, not a 500', async () => {
    // Retention cannot read: the sends still ran.
    db.errors.push({ table: 'evite_rsvps', op: 'select', times: 1000 })
    const res = await GET(req({ 'x-cron-secret': 'test-cron-secret' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.failedSteps.length).toBeGreaterThan(0)
  })

  it('an unexpected throw answers 500 with a generic body that does not echo the message', async () => {
    db = { supabase: { from: () => { throw new Error('secret@example.com exploded') } } } as unknown as SendDb
    const res = await GET(req({ 'x-cron-secret': 'test-cron-secret' }))
    expect([500, 503]).toContain(res.status)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('secret@example.com')
  })
})
