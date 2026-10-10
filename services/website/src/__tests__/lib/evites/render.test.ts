import sharp from 'sharp'
import { renderEvite, renderViaQueue, queueRender, OG_MAX_BYTES, MAX_WAITING_RENDERS, CLAIM_STALE_MS } from '@/lib/evites/render'
import { inviteFacts } from '@/lib/evites/facts'
import { renderInputsHash } from '@/lib/evites/hash'
import { makeFakeEviteDb } from '../../helpers/fakeEviteDb'
import { bookingRow, evitesRow, LINE_ITEM_ROWS, NOW, tablesFor, THEME_ROWS } from '../../helpers/eviteFixtures'

// Each render is ~2-3 s of librsvg (spike: 2.8 s wall per portrait+OG pair).
jest.setTimeout(90_000)

type G = typeof globalThis & { fetch?: unknown; __eviteRenderQueue?: unknown }
const g = globalThis as G
const realFetch = g.fetch
let fetchSpy: jest.Mock
const savedEnv = { pages: process.env.EVITES_PAGES, pilot: process.env.EVITES_PILOT_REFS }

beforeEach(() => {
  process.env.EVITES_PAGES = 'on'
  delete process.env.EVITES_PILOT_REFS
  // Any network call at all fails the render AND is counted.
  fetchSpy = jest.fn(() => {
    throw new Error('NETWORK CALL BLOCKED')
  })
  g.fetch = fetchSpy
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled() // the whole point of spec principle 6
  g.fetch = realFetch
  jest.restoreAllMocks()
  if (savedEnv.pages === undefined) delete process.env.EVITES_PAGES
  else process.env.EVITES_PAGES = savedEnv.pages
  if (savedEnv.pilot === undefined) delete process.env.EVITES_PILOT_REFS
  else process.env.EVITES_PILOT_REFS = savedEnv.pilot
})

const eviteOf = (db: ReturnType<typeof makeFakeEviteDb>) => db.tables.evites[0] as Record<string, unknown>

describe('renderEvite - the happy path', () => {
  it('renders a 1085x1530 RGB portrait and a 1200x630 RGB OG card under 300 KB, and records them', async () => {
    const db = makeFakeEviteDb({ tables: tablesFor() })
    const out = await renderEvite(db.supabase, 'ev-1', { now: NOW })
    expect(out.kind).toBe('rendered')
    if (out.kind !== 'rendered') return

    expect(db.uploads).toHaveLength(2)
    const [inv, og] = db.uploads
    const invBuf = db.uploaded.get(`evites/${inv.path}`) as Buffer
    const ogBuf = db.uploaded.get(`evites/${og.path}`) as Buffer

    const im = await sharp(invBuf).metadata()
    expect([im.format, im.width, im.height, im.channels, im.space]).toEqual(['jpeg', 1085, 1530, 3, 'srgb'])
    const om = await sharp(ogBuf).metadata()
    expect([om.format, om.width, om.height, om.channels, om.space]).toEqual(['jpeg', 1200, 630, 3, 'srgb'])
    expect(ogBuf.length).toBeLessThan(OG_MAX_BYTES)
    expect(ogBuf.length).toBe(out.ogBytes)

    // names and paths: <32 hex>/invite-v1-<4 hex>.jpg
    expect(inv.path).toMatch(/^[0-9a-f]{32}\/invite-v1-[0-9a-f]{4}\.jpg$/)
    expect(og.path).toMatch(/^[0-9a-f]{32}\/og-v1-[0-9a-f]{4}\.jpg$/)
    expect(inv.path.split('/')[0]).toBe(og.path.split('/')[0])
    expect(inv.path.split('-v1-')[1]).toBe(og.path.split('-v1-')[1]) // one suffix per attempt
    for (const u of db.uploads) {
      expect(u.bucket).toBe('evites')
      expect(u.options).toEqual({ contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
    }

    // the row now says what was rendered, and holds no claim
    const row = eviteOf(db)
    expect(row.render_version).toBe(1)
    expect(row.image_key).toBe(inv.path.split('/')[0])
    expect(row.invite_object).toBe(inv.path.split('/')[1])
    expect(row.og_object).toBe(og.path.split('/')[1])
    expect(row.render_claim).toBeNull()
    expect(row.render_error).toBeNull()
    expect(typeof row.rendered_at).toBe('string')
    const facts = inviteFacts(bookingRow() as never, evitesRow() as never, LINE_ITEM_ROWS, THEME_ROWS, 'live')
    expect(row.render_inputs_hash).toBe(renderInputsHash(facts))
  })

  it('renders for a name, no name and a very long name, each inside the byte budget', async () => {
    for (const child_name of ['Mia', null, 'Alexandria-Rose', 'MMMMMMMMMMMMMMMMMMMM']) {
      const db = makeFakeEviteDb({ tables: tablesFor({ booking: { child_name } }) })
      const out = await renderEvite(db.supabase, 'ev-1', { now: NOW })
      expect(out.kind).toBe('rendered')
      if (out.kind === 'rendered') {
        expect(out.ogBytes).toBeLessThan(OG_MAX_BYTES)
        expect(out.inviteBytes).toBeGreaterThan(50_000)
      }
    }
  })

  it('the plain template renders too (a theme with no artwork of its own)', async () => {
    const db = makeFakeEviteDb({ tables: tablesFor({ booking: { package_type: 'Mystery Theme' } }) })
    db.tables.booking_line_items.length = 0
    const out = await renderEvite(db.supabase, 'ev-1', { now: NOW })
    expect(out.kind).toBe('rendered')
  })

  it('renders the preview state for a party that is not booked yet (and the hash says preview)', async () => {
    const tables = tablesFor({ booking: { status: 'awaiting_deposit' } })
    tables.booking_payments = []
    const db = makeFakeEviteDb({ tables })
    const out = await renderEvite(db.supabase, 'ev-1', { now: NOW })
    expect(out.kind).toBe('rendered')
    const book = bookingRow({ status: 'awaiting_deposit' }) as never
    const preview = renderInputsHash(inviteFacts(book, evitesRow() as never, LINE_ITEM_ROWS, THEME_ROWS, 'preview'))
    const live = renderInputsHash(inviteFacts(book, evitesRow() as never, LINE_ITEM_ROWS, THEME_ROWS, 'live'))
    expect(preview).not.toBe(live)
    expect(eviteOf(db).render_inputs_hash).toBe(preview)
  })
})

describe('renderEvite - fresh, force, busy', () => {
  it('a second render with nothing changed is `fresh`: no claim, no upload', async () => {
    const db = makeFakeEviteDb({ tables: tablesFor() })
    expect((await renderEvite(db.supabase, 'ev-1', { now: NOW })).kind).toBe('rendered')
    const updatesBefore = db.updates.length
    const out = await renderEvite(db.supabase, 'ev-1', { now: NOW })
    expect(out).toEqual({ kind: 'fresh' })
    expect(db.uploads).toHaveLength(2)
    expect(db.updates).toHaveLength(updatesBefore)
  })

  it('a change to what is printed re-renders, as version 2, under the SAME image key', async () => {
    const db = makeFakeEviteDb({ tables: tablesFor() })
    await renderEvite(db.supabase, 'ev-1', { now: NOW })
    const key = eviteOf(db).image_key
    ;(db.tables.bookings[0] as Record<string, unknown>).child_age = 8
    const out = await renderEvite(db.supabase, 'ev-1', { now: NOW })
    expect(out.kind).toBe('rendered')
    expect(eviteOf(db).render_version).toBe(2)
    expect(eviteOf(db).image_key).toBe(key)
    expect(db.uploads[2].path).toMatch(/\/invite-v2-[0-9a-f]{4}\.jpg$/)
  })

  it('`force` renders even when nothing changed, and never reuses an object name', async () => {
    const db = makeFakeEviteDb({ tables: tablesFor() })
    await renderEvite(db.supabase, 'ev-1', { now: NOW })
    const first = eviteOf(db).invite_object
    const out = await renderEvite(db.supabase, 'ev-1', { now: NOW, force: true })
    expect(out.kind).toBe('rendered')
    expect(eviteOf(db).render_version).toBe(2)
    expect(eviteOf(db).invite_object).not.toBe(first)
    expect(new Set(db.uploads.map((u) => u.path)).size).toBe(4)
  })

  it('`busy` when another worker holds a fresh claim: nothing written, nothing uploaded', async () => {
    const claimedAt = new Date(NOW.getTime() - 30_000).toISOString()
    const db = makeFakeEviteDb({ tables: tablesFor({ evite: { render_claim: 'other-token', render_claimed_at: claimedAt } }) })
    const out = await renderEvite(db.supabase, 'ev-1', { now: NOW })
    expect(out).toEqual({ kind: 'busy', reason: 'claimed' })
    expect(db.uploads).toHaveLength(0)
    expect(eviteOf(db).render_claim).toBe('other-token')
    expect(eviteOf(db).render_claimed_at).toBe(claimedAt)
  })

  it('a claim older than two minutes is taken over, and the render completes', async () => {
    const stale = new Date(NOW.getTime() - CLAIM_STALE_MS - 1000).toISOString()
    const db = makeFakeEviteDb({ tables: tablesFor({ evite: { render_claim: 'dead-worker', render_claimed_at: stale } }) })
    const out = await renderEvite(db.supabase, 'ev-1', { now: NOW })
    expect(out.kind).toBe('rendered')
    expect(eviteOf(db).render_claim).toBeNull()
  })

  it('two renders racing for one evite: exactly one renders, the other is busy', async () => {
    const db = makeFakeEviteDb({ tables: tablesFor() })
    const [a, b] = await Promise.all([renderEvite(db.supabase, 'ev-1', { now: NOW }), renderEvite(db.supabase, 'ev-1', { now: NOW })])
    expect([a.kind, b.kind].sort()).toEqual(['busy', 'rendered'])
    expect(db.uploads).toHaveLength(2)
    expect(eviteOf(db).render_version).toBe(1)
  })

  it('the claim is two conditional UPDATEs read back, with no interpolated filter', async () => {
    const db = makeFakeEviteDb({ tables: tablesFor() })
    await renderEvite(db.supabase, 'ev-1', { now: NOW })
    const claim = db.updates[0]
    expect(Object.keys(claim.patch).sort()).toEqual(['render_claim', 'render_claimed_at'])
    expect(claim.filters).toEqual([
      { kind: 'eq', col: 'id', val: 'ev-1' },
      { kind: 'is', col: 'render_claim', val: null },
    ])
    expect(claim.matched).toBe(1)
  })
})

describe('renderEvite - takeover and failure leave the right things alone', () => {
  it('the final UPDATE affects 0 rows -> someone took over: their result stands, ours is not recorded', async () => {
    const db = makeFakeEviteDb({ tables: tablesFor() })
    db.hooks.beforeUpdate = ({ patch }, tables) => {
      if ('render_version' in patch) Object.assign(tables.evites[0], { render_claim: 'other-worker', render_version: 7, invite_object: 'invite-v7-ffff.jpg' })
    }
    const out = await renderEvite(db.supabase, 'ev-1', { now: NOW })
    expect(out).toEqual({ kind: 'busy', reason: 'taken-over' })
    const row = eviteOf(db)
    expect(row.render_claim).toBe('other-worker') // not released: it is not ours
    expect(row.render_version).toBe(7)
    expect(row.invite_object).toBe('invite-v7-ffff.jpg')
    expect(row.render_error).toBeNull()
    const final = db.updates.find((u) => 'render_version' in u.patch)
    expect(final?.matched).toBe(0)
    expect(final?.filters).toContainEqual({ kind: 'eq', col: 'render_claim', val: expect.any(String) })
    // and nothing tried to clear the other worker's claim
    expect(db.updates.filter((u) => u.patch.render_claim === null && !('render_version' in u.patch))).toHaveLength(0)
  })

  it('an upload failure sets render_error and clears OUR claim; the old objects stay as they were', async () => {
    const db = makeFakeEviteDb({
      tables: tablesFor({
        evite: { render_version: 1, render_inputs_hash: 'stale-hash', image_key: 'a'.repeat(32), invite_object: 'invite-v1-aaaa.jpg', og_object: 'og-v1-aaaa.jpg' },
      }),
    })
    db.errors.push({ table: 'storage', op: 'upload', message: 'bucket not found' })
    const out = await renderEvite(db.supabase, 'ev-1', { now: NOW })
    expect(out.kind).toBe('failed')
    if (out.kind === 'failed') expect(out.reason).toMatch(/^upload-failed: bucket not found/)
    const row = eviteOf(db)
    expect(row.render_claim).toBeNull()
    expect(row.render_error).toMatch(/^upload-failed/)
    expect([row.render_version, row.invite_object, row.og_object, row.image_key, row.render_inputs_hash]).toEqual([
      1,
      'invite-v1-aaaa.jpg',
      'og-v1-aaaa.jpg',
      'a'.repeat(32),
      'stale-hash',
    ])
    expect(db.uploads).toHaveLength(0)
  })

  it('a failure on the SECOND upload leaves the row untouched too (the first object is a harmless orphan)', async () => {
    const db = makeFakeEviteDb({ tables: tablesFor() })
    db.errors.push({ table: 'storage', op: 'upload', when: ({ path }) => Boolean(path?.includes('/og-')) })
    const out = await renderEvite(db.supabase, 'ev-1', { now: NOW })
    expect(out.kind).toBe('failed')
    expect(db.uploads).toHaveLength(1)
    const row = eviteOf(db)
    expect([row.render_version, row.invite_object, row.og_object]).toEqual([0, null, null])
    expect(row.render_claim).toBeNull()
    expect(row.render_error).toMatch(/^upload-failed/)
  })

  it('a failed finalize UPDATE is a failure that releases the claim', async () => {
    const db = makeFakeEviteDb({ tables: tablesFor() })
    db.errors.push({ table: 'evites', op: 'update', when: ({ patch }) => Boolean(patch && 'render_version' in patch), message: 'db down' })
    const out = await renderEvite(db.supabase, 'ev-1', { now: NOW })
    expect(out.kind).toBe('failed')
    expect(eviteOf(db).render_claim).toBeNull()
    expect(eviteOf(db).render_error).toMatch(/^finalize-failed: db down/)
    expect(eviteOf(db).render_version).toBe(0)
  })

  it('an OG card over the byte limit is never stored: `og-too-large`, nothing uploaded, claim cleared', async () => {
    const db = makeFakeEviteDb({ tables: tablesFor() })
    const out = await renderEvite(db.supabase, 'ev-1', { now: NOW, ogMaxBytes: 1000 })
    expect(out).toEqual({ kind: 'failed', reason: 'og-too-large' })
    expect(db.uploads).toHaveLength(0)
    expect(eviteOf(db).render_error).toBe('og-too-large')
    expect(eviteOf(db).render_claim).toBeNull()
  })

  it('a FAILED payments read is `read-failed`, never a render of the preview state', async () => {
    const db = makeFakeEviteDb({ tables: tablesFor() })
    db.errors.push({ table: 'booking_payments', op: 'select', message: 'timeout' })
    const out = await renderEvite(db.supabase, 'ev-1', { now: NOW })
    expect(out).toEqual({ kind: 'failed', reason: 'read-failed' })
    expect(db.uploads).toHaveLength(0)
    expect(eviteOf(db).render_error).toBe('read-failed')
    expect(eviteOf(db).render_claim).toBeNull()
    expect(eviteOf(db).render_version).toBe(0)
  })

  it.each(['bookings', 'booking_line_items', 'party_themes'])('a failed %s read is `read-failed` too', async (table) => {
    const db = makeFakeEviteDb({ tables: tablesFor() })
    db.errors.push({ table, op: 'select' })
    const out = await renderEvite(db.supabase, 'ev-1', { now: NOW })
    expect(out).toEqual({ kind: 'failed', reason: 'read-failed' })
    expect(db.uploads).toHaveLength(0)
    expect(eviteOf(db).render_error).toBe('read-failed')
  })

  it('a failed claim UPDATE is `failed`, with nothing rendered', async () => {
    const db = makeFakeEviteDb({ tables: tablesFor() })
    db.errors.push({ table: 'evites', op: 'update', times: 1 })
    const out = await renderEvite(db.supabase, 'ev-1', { now: NOW })
    expect(out).toEqual({ kind: 'failed', reason: 'claim-failed' })
    expect(db.uploads).toHaveLength(0)
  })

  it('NEVER throws: a client that explodes is a `failed`', async () => {
    const boom = { from: () => { throw new Error('boom') } } as never
    await expect(renderEvite(boom, 'ev-1', { now: NOW })).resolves.toMatchObject({ kind: 'failed' })
  })

  it('an evite or booking that does not exist is a named failure, not a throw', async () => {
    const db = makeFakeEviteDb({ tables: tablesFor() })
    expect(await renderEvite(db.supabase, 'nope', { now: NOW })).toEqual({ kind: 'failed', reason: 'evite-missing' })
    db.tables.bookings.length = 0
    expect(await renderEvite(db.supabase, 'ev-1', { now: NOW })).toEqual({ kind: 'failed', reason: 'booking-missing' })
  })
})

describe('renderEvite - states it must not draw', () => {
  it('pages flag off: `state-disabled`, and not one write', async () => {
    process.env.EVITES_PAGES = 'off'
    const db = makeFakeEviteDb({ tables: tablesFor() })
    expect(await renderEvite(db.supabase, 'ev-1', { now: NOW })).toEqual({ kind: 'skipped', reason: 'state-disabled' })
    expect(db.updates).toHaveLength(0)
    expect(db.uploads).toHaveLength(0)
  })

  it('a cancelled party: `state-unavailable`, and not one write', async () => {
    const db = makeFakeEviteDb({ tables: tablesFor({ booking: { status: 'cancelled' } }) })
    expect(await renderEvite(db.supabase, 'ev-1', { now: NOW })).toEqual({ kind: 'skipped', reason: 'state-unavailable' })
    expect(db.updates).toHaveLength(0)
  })

  it('pilot mode renders a pilot booking and refuses the rest', async () => {
    process.env.EVITES_PAGES = 'pilot'
    process.env.EVITES_PILOT_REFS = 'HH-TEST-1'
    const ok = makeFakeEviteDb({ tables: tablesFor() })
    expect((await renderEvite(ok.supabase, 'ev-1', { now: NOW })).kind).toBe('rendered')
    const no = makeFakeEviteDb({ tables: tablesFor({ booking: { booking_ref: 'HH-OTHER' } }) })
    expect(await renderEvite(no.supabase, 'ev-1', { now: NOW })).toEqual({ kind: 'skipped', reason: 'state-disabled' })
  })
})

describe('queueRender', () => {
  beforeEach(() => {
    g.__eviteRenderQueue = undefined
  })

  /** A runner whose jobs finish only when the test says so. */
  function gate() {
    const started: string[] = []
    const finished: string[] = []
    const releases: Array<() => void> = []
    let active = 0
    let maxActive = 0
    const run = (id: string) => {
      started.push(id)
      active += 1
      maxActive = Math.max(maxActive, active)
      return new Promise<void>((resolve) => {
        releases.push(() => {
          active -= 1
          finished.push(id)
          resolve()
        })
      })
    }
    return { run, started, finished, releases, stats: () => ({ active, maxActive }) }
  }
  const tick = () => new Promise((r) => setTimeout(r, 0))
  async function drain(gt: ReturnType<typeof gate>, count: number) {
    for (let i = 0; i < count; i++) {
      while (gt.releases.length <= i) await tick()
      gt.releases[i]()
      await tick()
    }
  }

  it('runs one render at a time, in order', async () => {
    const gt = gate()
    for (const id of ['a', 'b', 'c']) expect(queueRender(id, { run: gt.run })).toBe('queued')
    await tick()
    expect(gt.started).toEqual(['a'])
    await drain(gt, 3)
    expect(gt.finished).toEqual(['a', 'b', 'c'])
    expect(gt.stats().maxActive).toBe(1)
  })

  it('holds at most 20 waiting: the 22nd (1 running + 20 waiting + 1) is dropped', async () => {
    const gt = gate()
    const results = Array.from({ length: MAX_WAITING_RENDERS + 2 }, (_, i) => queueRender(`e${i}`, { run: gt.run }))
    expect(results.filter((r) => r === 'queued')).toHaveLength(MAX_WAITING_RENDERS + 1)
    expect(results[results.length - 1]).toBe('dropped')
    await drain(gt, MAX_WAITING_RENDERS + 1)
    expect(gt.finished).toHaveLength(MAX_WAITING_RENDERS + 1)
    expect(gt.finished).not.toContain(`e${MAX_WAITING_RENDERS + 1}`)
    expect(gt.stats().maxActive).toBe(1)
  })

  it('the same evite waiting twice is one job', async () => {
    const gt = gate()
    queueRender('first', { run: gt.run })
    queueRender('dup', { run: gt.run })
    expect(queueRender('dup', { run: gt.run })).toBe('queued')
    await drain(gt, 2)
    expect(gt.started).toEqual(['first', 'dup'])
  })

  it('a job that throws does not stop the queue, and never rejects to the caller', async () => {
    const ran: string[] = []
    const run = (id: string) => {
      ran.push(id)
      return id === 'bad' ? Promise.reject(new Error('nope')) : Promise.resolve()
    }
    queueRender('bad', { run })
    queueRender('good', { run })
    await tick()
    await tick()
    expect(ran).toEqual(['bad', 'good'])
  })

  it('lives on globalThis.__eviteRenderQueue, so every route bundle shares one', () => {
    const gt = gate()
    queueRender('x', { run: gt.run })
    queueRender('y', { run: gt.run })
    const q = g.__eviteRenderQueue as { waiting: unknown[]; running: boolean }
    expect(q.running).toBe(true)
    expect(q.waiting).toHaveLength(1)
  })

  // v1.2 finding 4: the admin button and the cron used to call renderEvite directly, beside a queued render.
  describe('renderViaQueue - the awaitable path through the SAME queue', () => {
    // A cheap render: pilot mode refuses a booking that is not a pilot booking, with no drawing.
    beforeEach(() => {
      process.env.EVITES_PAGES = 'pilot'
      process.env.EVITES_PILOT_REFS = 'HH-TEST-1'
    })

    it('does not start while another render holds the queue, then runs and returns its outcome (a direct renderEvite would have read at once)', async () => {
      const gt = gate()
      queueRender('busy', { run: gt.run })
      await tick()
      expect(gt.started).toEqual(['busy'])

      const db = makeFakeEviteDb({ tables: tablesFor() })
      let settled = false
      const pending = renderViaQueue(db.supabase, 'ev-1', { now: NOW }).then((o) => ((settled = true), o))
      await tick()
      await tick()
      expect(db.selects).toHaveLength(0) // nothing was read: it is waiting its turn
      expect(settled).toBe(false)

      await drain(gt, 1) // the running render finishes
      const out = await pending
      expect(out.kind).toBe('rendered')
      expect(db.uploads).toHaveLength(2)
    })

    it('two awaited renders and a queued one never overlap', async () => {
      const gt = gate()
      queueRender('q1', { run: gt.run })
      const order: string[] = []
      const dbA = makeFakeEviteDb({ tables: tablesFor() })
      const dbB = makeFakeEviteDb({ tables: tablesFor() })
      const a = renderViaQueue(dbA.supabase, 'ev-1', { now: NOW }).then((o) => (order.push('a'), o))
      const b = renderViaQueue(dbB.supabase, 'ev-1', { now: NOW }).then((o) => (order.push('b'), o))
      await tick()
      expect(dbA.selects).toHaveLength(0)
      expect(dbB.selects).toHaveLength(0)
      await drain(gt, 1)
      expect((await a).kind).toBe('rendered')
      expect((await b).kind).toBe('rendered')
      expect(order).toEqual(['a', 'b'])
    })

    it('is never dropped by the 20-waiting cap, and does not use up a place in it', async () => {
      const gt = gate()
      const results = Array.from({ length: MAX_WAITING_RENDERS + 1 }, (_, i) => queueRender(`e${i}`, { run: gt.run }))
      expect(results.every((r) => r === 'queued')).toBe(true)
      expect(queueRender('overflow', { run: gt.run })).toBe('dropped')
      const db = makeFakeEviteDb({ tables: tablesFor({ booking: { booking_ref: 'HH-OTHER' } }) }) // renders as "skipped": cheap
      const awaited = renderViaQueue(db.supabase, 'ev-1', { now: NOW })
      // the queue is full for fire-and-forget callers, as before
      expect(queueRender('overflow-2', { run: gt.run })).toBe('dropped')
      await drain(gt, MAX_WAITING_RENDERS + 1)
      expect(await awaited).toEqual({ kind: 'skipped', reason: 'state-disabled' })
    })

    it('a render that throws is a failed outcome, never a rejection; the queue carries on', async () => {
      const boom = { from: () => { throw new Error('db exploded') } } as never
      const out = await renderViaQueue(boom, 'ev-1', { now: NOW })
      expect(out.kind).toBe('failed')
      const db = makeFakeEviteDb({ tables: tablesFor({ booking: { booking_ref: 'HH-OTHER' } }) })
      expect((await renderViaQueue(db.supabase, 'ev-1', { now: NOW })).kind).toBe('skipped')
    })

    it('a fire-and-forget render of the same evite is not swallowed by an awaited one (and the reverse)', async () => {
      const gt = gate()
      queueRender('busy', { run: gt.run })
      const db = makeFakeEviteDb({ tables: tablesFor({ booking: { booking_ref: 'HH-OTHER' } }) })
      void renderViaQueue(db.supabase, 'ev-1', { now: NOW, force: true })
      queueRender('ev-1', { run: gt.run })
      const q = g.__eviteRenderQueue as { waiting: Array<{ eviteId: string; awaited?: boolean }> }
      expect(q.waiting.map((w) => [w.eviteId, !!w.awaited])).toEqual([['ev-1', true], ['ev-1', false]])
      await drain(gt, 2)
    })
  })
})
