import { makeSendDb, sendRow, EVITE_ID, SEND_NOW } from '../../helpers/sendFixtures'
import { claimSend, finishSend, reclaimFailed, MAX_SEND_ATTEMPTS, STUCK_SENDING_MS, UNIQUE_SEND_INDEX } from '@/lib/evites/sends'
import { STUCK_SENDING_MS as ADMIN_STUCK_MS } from '@/lib/evites/adminView'

/** The send ledger (spec §1 `evite_sends`, §9.3): claim, reclaim, finish. */

const RSVP = '00000000-0000-4000-8000-0000000000aa'
const key = (over: Record<string, unknown> = {}) => ({ evite_id: EVITE_ID, rsvp_id: RSVP, send_type: 'new_rsvp' as const, ref_version: 1, ...over })
const minutesAgo = (m: number) => new Date(SEND_NOW.getTime() - m * 60_000).toISOString()

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('constants', () => {
  it('4 attempts and 15 minutes, and the admin card agrees about "stuck"', () => {
    expect(MAX_SEND_ATTEMPTS).toBe(4)
    expect(STUCK_SENDING_MS).toBe(15 * 60 * 1000)
    expect(STUCK_SENDING_MS).toBe(ADMIN_STUCK_MS)
  })
})

describe('claimSend', () => {
  it('the first caller owns the message: a `sending` row, attempt 1, channel email', async () => {
    const db = makeSendDb()
    const r = await claimSend(db.supabase, key(), SEND_NOW)
    expect(r.kind).toBe('claimed')
    if (r.kind !== 'claimed') return
    expect(r.id).toBe(r.send.id)
    expect(r.send).toMatchObject({ evite_id: EVITE_ID, rsvp_id: RSVP, send_type: 'new_rsvp', ref_version: 1, attempts: 1 })
    expect(db.tables.evite_sends).toHaveLength(1)
    expect(db.tables.evite_sends[0]).toMatchObject({ status: 'sending', channel: 'email', attempts: 1, claimed_at: SEND_NOW.toISOString() })
  })

  it('the same key again is a duplicate, and writes nothing', async () => {
    const db = makeSendDb()
    await claimSend(db.supabase, key())
    expect(await claimSend(db.supabase, key())).toEqual({ kind: 'duplicate' })
    expect(db.tables.evite_sends).toHaveLength(1)
  })

  it('a different ref_version, send_type or rsvp is a different message', async () => {
    const db = makeSendDb()
    expect((await claimSend(db.supabase, key())).kind).toBe('claimed')
    expect((await claimSend(db.supabase, key({ ref_version: 2 }))).kind).toBe('claimed')
    expect((await claimSend(db.supabase, key({ send_type: 'rsvp_changed' }))).kind).toBe('claimed')
    expect((await claimSend(db.supabase, key({ rsvp_id: '00000000-0000-4000-8000-0000000000bb' }))).kind).toBe('claimed')
    expect(db.tables.evite_sends).toHaveLength(4)
  })

  it('a party-level send (rsvp_id NULL) collides with itself: NULLS NOT DISTINCT', async () => {
    const db = makeSendDb()
    expect((await claimSend(db.supabase, key({ rsvp_id: null, send_type: 'invite_ready', ref_version: 0 }))).kind).toBe('claimed')
    expect(await claimSend(db.supabase, key({ rsvp_id: null, send_type: 'invite_ready', ref_version: 0 }))).toEqual({ kind: 'duplicate' })
  })

  it('any other failure is `unavailable`, never "duplicate" and never "claimed"', async () => {
    const db = makeSendDb()
    db.errors.push({ table: 'evite_sends', op: 'insert', message: 'connection reset' })
    expect(await claimSend(db.supabase, key())).toEqual({ kind: 'unavailable', error: 'connection reset' })
    expect(db.tables.evite_sends).toHaveLength(0)
  })

  it('a 23505 from some OTHER constraint is not read as "already sent"', async () => {
    const db = makeSendDb()
    const real = db.supabase as unknown as { from: (t: string) => unknown }
    const original = real.from.bind(real)
    real.from = (t: string) =>
      t === 'evite_sends'
        ? { insert: () => ({ select: async () => ({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "evite_sends_pkey"' } }) }) }
        : original(t)
    const r = await claimSend(db.supabase, key())
    expect(r.kind).toBe('unavailable')
    expect(UNIQUE_SEND_INDEX).toBe('uniq_evite_send_once')
  })
})

describe('reclaimFailed', () => {
  it('takes back a failed send with attempts left: sending again, attempts + 1, a fresh claimed_at', async () => {
    const db = makeSendDb({ sends: [sendRow({ id: 'f1', status: 'failed', attempts: 2, claimed_at: minutesAgo(60), last_error: 'x' })] })
    const r = await reclaimFailed(db.supabase, { limit: 10, now: SEND_NOW })
    expect(r.errors).toEqual([])
    expect(r.reclaimed.map((s) => [s.id, s.attempts])).toEqual([['f1', 3]])
    expect(db.tables.evite_sends[0]).toMatchObject({ status: 'sending', attempts: 3, claimed_at: SEND_NOW.toISOString() })
  })

  it('leaves a failed send that has used all 4 attempts', async () => {
    const db = makeSendDb({ sends: [sendRow({ id: 'f4', status: 'failed', attempts: 4, claimed_at: minutesAgo(60) })] })
    const r = await reclaimFailed(db.supabase, { limit: 10, now: SEND_NOW })
    expect(r.reclaimed).toEqual([])
    expect(db.tables.evite_sends[0]).toMatchObject({ status: 'failed', attempts: 4 })
  })

  it('leaves `sent` and `skipped` alone, and a `sending` row that is still young', async () => {
    const db = makeSendDb({
      sends: [
        sendRow({ id: 's', status: 'sent', send_type: 'new_rsvp' }),
        sendRow({ id: 'k', status: 'skipped', send_type: 'rsvp_changed' }),
        sendRow({ id: 'y', status: 'sending', send_type: 'rsvp_confirmed', claimed_at: minutesAgo(5) }),
      ],
    })
    const r = await reclaimFailed(db.supabase, { limit: 10, now: SEND_NOW })
    expect(r.reclaimed).toEqual([])
    expect(db.updates).toHaveLength(0)
  })

  it('reclaims a `sending` row older than 15 minutes (a worker that died), attempts + 1', async () => {
    const db = makeSendDb({ sends: [sendRow({ id: 'st', status: 'sending', attempts: 1, claimed_at: minutesAgo(16) })] })
    const r = await reclaimFailed(db.supabase, { limit: 10, now: SEND_NOW })
    expect(r.reclaimed.map((s) => [s.id, s.attempts])).toEqual([['st', 2]])
    expect(db.tables.evite_sends[0]).toMatchObject({ status: 'sending', attempts: 2, claimed_at: SEND_NOW.toISOString() })
  })

  it('a stuck `sending` row that is out of attempts is finished `failed`, not retried again', async () => {
    const db = makeSendDb({ sends: [sendRow({ id: 'x', status: 'sending', attempts: 4, claimed_at: minutesAgo(30) })] })
    const r = await reclaimFailed(db.supabase, { limit: 10, now: SEND_NOW })
    expect(r.reclaimed).toEqual([])
    expect(r.exhausted).toBe(1)
    expect(db.tables.evite_sends[0]).toMatchObject({ status: 'failed' })
    expect(String(db.tables.evite_sends[0].last_error)).toMatch(/out of attempts/)
  })

  it('honours the limit across both sweeps, oldest first', async () => {
    const db = makeSendDb({
      sends: [
        sendRow({ id: 'a', status: 'failed', attempts: 1, send_type: 'new_rsvp', claimed_at: minutesAgo(90) }),
        sendRow({ id: 'b', status: 'failed', attempts: 1, send_type: 'rsvp_changed', claimed_at: minutesAgo(80) }),
        sendRow({ id: 'c', status: 'sending', attempts: 1, send_type: 'rsvp_confirmed', claimed_at: minutesAgo(70) }),
      ],
    })
    const r = await reclaimFailed(db.supabase, { limit: 2, now: SEND_NOW })
    expect(r.reclaimed.map((s) => s.id)).toEqual(['a', 'b'])
    expect(db.tables.evite_sends.find((s) => s.id === 'c')).toMatchObject({ status: 'sending', attempts: 1 })
    expect((await reclaimFailed(db.supabase, { limit: 0, now: SEND_NOW })).reclaimed).toEqual([])
  })

  it('is conditional: a row somebody else moved between read and write is not reclaimed', async () => {
    const db = makeSendDb({ sends: [sendRow({ id: 'r', status: 'failed', attempts: 1, claimed_at: minutesAgo(60) })] })
    db.hooks.beforeUpdate = ({ table }, tables) => {
      if (table === 'evite_sends') tables.evite_sends[0].status = 'sent'
    }
    const r = await reclaimFailed(db.supabase, { limit: 10, now: SEND_NOW })
    expect(r.reclaimed).toEqual([])
    expect(db.tables.evite_sends[0].status).toBe('sent')
  })

  it('a failed read is reported, never "nothing to do"', async () => {
    const db = makeSendDb()
    db.errors.push({ table: 'evite_sends', op: 'select', message: 'boom' })
    const r = await reclaimFailed(db.supabase, { limit: 10, now: SEND_NOW })
    expect(r.errors.length).toBeGreaterThan(0)
    expect(r.reclaimed).toEqual([])
  })
})

describe('finishSend', () => {
  it('sent: provider id, sent_at, outcome', async () => {
    const db = makeSendDb({ sends: [sendRow({ id: 'a' })] })
    expect(await finishSend(db.supabase, 'a', { kind: 'sent', providerId: 're_123' }, SEND_NOW)).toEqual({ ok: true })
    expect(db.tables.evite_sends[0]).toMatchObject({ status: 'sent', outcome: 'sent', provider_id: 're_123', sent_at: SEND_NOW.toISOString(), last_error: null })
  })

  it('failed: the error is kept (and clipped), attempts untouched', async () => {
    const db = makeSendDb({ sends: [sendRow({ id: 'a', attempts: 2 })] })
    await finishSend(db.supabase, 'a', { kind: 'failed', error: 'x'.repeat(900) })
    expect(db.tables.evite_sends[0]).toMatchObject({ status: 'failed', outcome: 'failed', attempts: 2 })
    expect(String(db.tables.evite_sends[0].last_error).length).toBeLessThanOrEqual(500)
  })

  it('skipped: the reason is the outcome', async () => {
    const db = makeSendDb({ sends: [sendRow({ id: 'a' })] })
    await finishSend(db.supabase, 'a', { kind: 'skipped', reason: 'suppressed' })
    expect(db.tables.evite_sends[0]).toMatchObject({ status: 'skipped', outcome: 'suppressed' })
  })

  it('only a `sending` row can be finished: a late worker cannot overwrite the new owner', async () => {
    const db = makeSendDb({ sends: [sendRow({ id: 'a', status: 'sent', provider_id: 're_first' })] })
    expect(await finishSend(db.supabase, 'a', { kind: 'failed', error: 'late' })).toEqual({ ok: false, reason: 'not-sending' })
    expect(db.tables.evite_sends[0]).toMatchObject({ status: 'sent', provider_id: 're_first' })
  })

  it('reads its own {error}: one failed write is retried once, two are reported', async () => {
    const once = makeSendDb({ sends: [sendRow({ id: 'a' })] })
    once.errors.push({ table: 'evite_sends', op: 'update', times: 1, message: 'blip' })
    expect(await finishSend(once.supabase, 'a', { kind: 'sent', providerId: 're_1' })).toEqual({ ok: true })
    expect(once.tables.evite_sends[0].status).toBe('sent')

    const twice = makeSendDb({ sends: [sendRow({ id: 'a' })] })
    twice.errors.push({ table: 'evite_sends', op: 'update', message: 'down' })
    expect(await finishSend(twice.supabase, 'a', { kind: 'sent', providerId: 're_1' })).toEqual({ ok: false, reason: 'write-failed', error: 'down' })
    expect(twice.tables.evite_sends[0].status).toBe('sending')
  })
})
